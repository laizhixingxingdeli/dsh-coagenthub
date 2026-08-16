/**
 * CoAgentHub tools plugin for DeepSeek Harness: lets the dsh agent operate
 * CoAgentHub (list participants / create groups / post messages / dispatch
 * tasks / query tasks) through six tools.
 * @module @laizhixingxingdeli/dsh-coagenthub
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { CoAgentHubClient } from './client.ts'
import type { CoAgentHubSettings } from './config.ts'
import { getCoAgentHubSettingsStore } from './config.ts'
import { DshAgentPushAdapter, NullPushAdapter, createNotificationDeliverer } from './notify.ts'
import { TaskWatcher } from './task-watcher.ts'
import { registerCoAgentHubTools } from './tools.ts'
import type { GroupWithPath } from './workspace.ts'
import { findGroupByWorkspaceCwd } from './workspace.ts'
import { CoAgentHubWsClient } from './ws-client.ts'

/** Cordis function-plugin name. */
export const name = 'coagenthub'

/** Services required before the CoAgentHub tools can register. */
export const inject = ['tools']

export interface CoAgentHubPluginConfig {
  /** CoAgentHub API base URL; defaults to `http://localhost:3001/api`. */
  apiBase?: string
  /** Participant identity sent as `X-Participant-Id`; falls back to the environment. */
  participantId?: string
}

/**
 * 推送侧会话→群解析(纯函数,便于单测):与拉取侧
 * `coagenthub_get_notifications`(tools.ts)一致——有 sessionId 时先查该会话的
 * per-session 映射 `settings.sessionActiveGroups[sessionId]`:非空且能在 groups
 * 中找到时直接使用(面板按会话保存的工作区优先生效),否则按会话 cwd 调
 * findGroupByWorkspaceCwd 反查群;有 sessionId 时绝不回退全局 activeGroupId
 * (避免跨会话污染)。无 sessionId 时保留全局 activeGroupId 兼容兜底,再按 cwd
 * 反查;反查不到再返回 null。
 * 与拉取侧的刻意差异:映射与 cwd 都拿不到归属群时直接返回 null——按任务需求
 * 3,不确定归属群时回退"禁用主动推送、全部入队",由各会话按需拉取;绝不把
 * 其他群的通知注入当前会话。
 */
export function resolveGroupIdForCwd(
  cwd: string | null | undefined,
  groups: readonly GroupWithPath[],
  settings: CoAgentHubSettings | undefined,
  sessionId?: string | null,
): string | null {
  if (sessionId !== null && sessionId !== undefined && sessionId.trim() !== '') {
    const perSession = settings?.sessionActiveGroups?.[sessionId]
    if (perSession !== undefined && perSession.trim() !== '') {
      const active = groups.find(group => group.id === perSession)
      if (active !== undefined) return active.id
    }
    // per-session 未命中/已失效:直接按 cwd 反查,不回退全局 activeGroupId。
  } else {
    const activeGroupId = settings?.activeGroupId
    if (activeGroupId !== undefined && activeGroupId.trim() !== '') {
      const active = groups.find(group => group.id === activeGroupId)
      if (active !== undefined) return active.id
    }
  }
  if (cwd === null || cwd === undefined || cwd.trim() === '') return null
  return findGroupByWorkspaceCwd(groups, cwd, settings?.mappingRule)?.id ?? null
}

/** 会话→群反查结果缓存条目。 */
interface SessionGroupCacheEntry {
  groupId: string | null
  /** Cache fill time (epoch ms), for TTL expiry. */
  at: number
}

/** 会话→群反查缓存 TTL:群/映射规则低频变化,30s 内复用即可。 */
const SESSION_GROUP_CACHE_TTL_MS = 30_000

/** 反查群单次 HTTP 超时:接口慢/挂时及时回退入队,不让通知悬在推送中。 */
const SESSION_GROUP_RESOLVE_TIMEOUT_MS = 2_000

/** Race a promise against a deadline; rejects when the timeout elapses first. */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`session group resolve timed out after ${ms}ms`)), ms)
    promise.then(
      (value) => { clearTimeout(timer); resolve(value) },
      (error) => { clearTimeout(timer); reject(error) },
    )
  })
}

/** Register the CoAgentHub tools against a shared client + background watcher. */
export function apply(ctx: Context, config: CoAgentHubPluginConfig = {}): void {
  const settingsStore = getCoAgentHubSettingsStore()
  const client = new CoAgentHubClient({
    baseURL: config.apiBase,
    participantId: config.participantId,
    // Share the proxy's settings store so panel saves also steer the tools.
    settingsStore,
  })
  ctx.effect(() => {
    // 工具的 live root agent cwd 回退解析器:晚绑定 agentsRegistry(由下方
    // ctx.inject(['agents']) 接线后赋值),解析器只在被调用时现查
    // registry.roots()[0] 的会话目录;agents 服务未接线/已下线时返回 null。
    // 工具层解析群时优先当前会话 per-session 映射(面板按会话保存的工作区),
    // 无 sessionId 时才回退全局 activeGroupId 兼容兜底,再按 cwd 反查,
    // 绝不误用 process.cwd()。
    return registerCoAgentHubTools(ctx, client, settingsStore, () => {
      const agent = agentsRegistry?.roots()[0]
      // 与推送侧 resolveSessionGroupId 一致:header.cwd 优先,旧结构 meta.cwd 兜底。
      const session = agent?.session as { header?: { cwd?: string }; meta?: { cwd?: string } } | undefined
      const cwd = session?.header?.cwd ?? session?.meta?.cwd
      return cwd !== undefined && cwd !== null && cwd.trim() !== '' ? cwd : null
    }, () => {
      // 会话 id 回退解析器:exec 未携带 agent 时,用 root agent 的会话 id 查
      // per-session 映射,与 cwd 回退同源(agent.session.id)。
      const agent = agentsRegistry?.roots()[0]
      const sessionId = agent?.session?.id
      return sessionId !== undefined && sessionId !== null && sessionId.trim() !== '' ? sessionId : null
    })
  }, 'coagenthub.tools()')

  // B 方案后台事件链路:WS 订阅 + 低频轮询兜底。通知走主动推送适配器:
  // dsh 运行时暴露 ctx.agents 注册表时,用 agent.followup 排队 next-turn
  // 消息并唤醒当前会话;否则回退 NullPushAdapter 入队,由
  // coagenthub_get_notifications 补读。
  const log = (message: string) => ctx.logger?.('coagenthub').info(message)
  const nullAdapter = () => new NullPushAdapter({
    reason: 'dsh 运行时未暴露 ctx.agents 注册表(无 agent.followup 唤醒能力)',
    log,
  })
  // 晚绑定的 agents 注册表:inject 接线后赋值,供工具层 live-agent cwd 回退
  // 解析器与通知推送共用;agents 服务下线时清空,回退到无 live agent 状态。
  let agentsRegistry: { roots(): Agent[] } | undefined
  // 通知 deliverer 起步为队列回退;agents 服务可用后动态切到主动推送。
  const deliverer = createNotificationDeliverer(nullAdapter())
  // 会话→群反查缓存(推送隔离用),按插件实例隔离。TTL 后既不读也不保留:
  // 填充新条目时顺带驱逐过期条目,避免会话/设置变化产生的 key 无限累积。
  const sessionGroupCache = new Map<string, SessionGroupCacheEntry>()
  /** 同一 key 的 in-flight 反查 promise 去重:突发通知只打一次 listGroups。 */
  const sessionGroupInflight = new Map<string, Promise<string | null>>()

  // 动态注入 agents 服务:插件静态 inject 仅声明 ['tools'](避免没有该服务的
  // profile 启动失败),而 cordis 4 对未注入属性访问会抛 "cannot get property
  // "agents" without inject",不能直接读 ctx.agents。参考 proxy.ts 对
  // webServer 的 ctx.inject([...], cb) 用法:agents 服务可用(启动时已提供或
  // 后续出现)时,把通知 deliverer 切换到 DshAgentPushAdapter——每次推送经
  // registry.roots()[0] 现查 live agent 并 agent.followup 唤醒;不可用时保持
  // NullPushAdapter 回退并打 warn 说明原因。
  if (ctx.reflect.get('agents', false) === undefined) {
    ctx.logger?.('coagenthub').warn('dsh 运行时未暴露 ctx.agents 注册表,主动推送不可用;通知入队由 coagenthub_get_notifications 补读')
  }
  // ctx.inject 创建的注入 fiber 会自注册为插件 fiber 的子 effect(cordis Fiber
  // 构造时 parent.fiber.effect),插件卸载时级联卸载,无需额外清理。
  void ctx.inject(['agents'], (agentsCtx) => {
    const registry = (agentsCtx as Context & { agents: { roots(): Agent[] } }).agents
    agentsRegistry = registry
    ctx.logger?.('coagenthub').info('dsh 运行时支持主动唤醒(agent.followup),通知将直接推送进会话并唤醒 driver')
    deliverer.setPushAdapter(new DshAgentPushAdapter({
      resolveAgent: () => registry.roots()[0],
      // 推送前按 当前会话 per-session 映射 → 会话 cwd 反查 的顺序解析群隔离:
      // 面板按会话保存的工作区(非空且存在于群列表)优先生效;否则用
      // agent.session.header.cwd(dsh-session SessionHeader)反查——它是会话创建
      // 时的绝对工作目录,旧结构回退 meta.cwd。只把该群的通知 followup 推入
      // 本会话,其他群的通知由适配器入队隔离,避免 0.0.16 后 TaskWatcher 收集
      // 到的其他群通知被注入当前会话。
      // 会话→群反查结果按 agent 会话 + 该会话 per-session 映射 + settings 缓存
      // (TTL 内复用),避免每条通知都打一次 listGroups HTTP(接口慢/挂时最坏卡
      // 10s,通知悬在"既未入队也未推送"状态);反查失败也缓存为 null,通知立即
      // 入队由 coagenthub_get_notifications 补读,网络恢复后 TTL 过期自动重查。
      resolveSessionGroupId: async () => {
        const agent = registry.roots()[0]
        const settings = settingsStore?.get()
        const session = agent?.session as { id?: string; header?: { cwd?: string }; meta?: { cwd?: string } } | undefined
        const sessionId = session?.id
        const cwd = session?.header?.cwd ?? session?.meta?.cwd
        const cacheKey = [
          agent?.id ?? '',
          sessionId ?? '',
          settings?.sessionActiveGroups?.[sessionId ?? ''] ?? '',
          settings?.activeGroupId ?? '',
          settings?.mappingRule?.macPrefix ?? '',
          settings?.mappingRule?.winPrefix ?? '',
        ].join('|')
        const cached = sessionGroupCache.get(cacheKey)
        if (cached !== undefined && Date.now() - cached.at < SESSION_GROUP_CACHE_TTL_MS) {
          return cached.groupId
        }
        // 同一 key 的并发推送共享一次反查:突发终态通知不产生 N 个并发 listGroups。
        const inflight = sessionGroupInflight.get(cacheKey)
        if (inflight !== undefined) return inflight
        const pending = (async (): Promise<string | null> => {
          if (agent === undefined) return null
          try {
            const groups = await withTimeout(client.listGroups(100), SESSION_GROUP_RESOLVE_TIMEOUT_MS)
            return resolveGroupIdForCwd(cwd, groups.items, settings, sessionId)
          } catch {
            return null // 反查失败/超时:本轮全部入队,由 get_notifications 补读。
          }
        })().then((groupId) => {
          // 填充新条目时顺带驱逐过期条目,避免会话/设置变化产生的 key 无限累积。
          const now = Date.now()
          for (const [key, entry] of sessionGroupCache) {
            if (now - entry.at >= SESSION_GROUP_CACHE_TTL_MS) sessionGroupCache.delete(key)
          }
          sessionGroupCache.set(cacheKey, { groupId, at: now })
          return groupId
        })
        sessionGroupInflight.set(cacheKey, pending)
        pending.then(
          () => sessionGroupInflight.delete(cacheKey),
          () => sessionGroupInflight.delete(cacheKey),
        )
        return pending
      },
      log,
    }))
    // 作为注入 fiber 的清理函数返回:agents 服务下线(而非仅插件卸载)时,
    // cordis 会卸载该 fiber 并调用它,把 deliverer 回退到队列模式,避免继续
    // 使用已失效的注册表;服务重新出现时 fiber 重载,重新切换回 followup。
    return () => {
      agentsRegistry = undefined
      ctx.logger?.('coagenthub').warn('dsh 运行时 agents 服务已下线,主动推送回退队列;通知由 coagenthub_get_notifications 补读')
      deliverer.setPushAdapter(nullAdapter())
    }
  })

  const ws = new CoAgentHubWsClient({
    baseURL: client.baseURL,
    // 每次(重)连时重新解析 apiBase,设置面板改地址后即时生效。
    getBaseURL: () => client.baseURL,
    getParticipantId: () => client.participantId,
  })
  const watcher = new TaskWatcher({
    client,
    ws,
    deliver: deliverer,
  })
  ctx.effect(
    () => {
      watcher.start()
      return () => watcher.stop()
    },
    'coagenthub.task-watcher()',
  )
}
