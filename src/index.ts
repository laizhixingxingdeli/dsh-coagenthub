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
 * 推送侧会话→群解析(纯函数,便于单测):cwd 非空时与拉取侧
 * `coagenthub_get_notifications`(tools.ts)一致——先用会话 cwd 调
 * findGroupByWorkspaceCwd 反查群,反查不到再回退 `settings.activeGroupId`。
 * 与拉取侧的刻意差异:cwd 为空(会话没有可用工作目录)时直接返回 null——按
 * 任务需求 3,拿不到 cwd 即回退"禁用主动推送、全部入队",由各会话按 cwd
 * 拉取;拉取侧还会继续兜底 process.cwd()/activeGroupId,但推送侧不确定归属
 * 群时宁可入队,也不把其他群的通知注入当前会话。
 */
export function resolveGroupIdForCwd(
  cwd: string | null | undefined,
  groups: readonly GroupWithPath[],
  settings: CoAgentHubSettings | undefined,
): string | null {
  if (cwd === null || cwd === undefined || cwd.trim() === '') return null
  const byCwd = findGroupByWorkspaceCwd(groups, cwd, settings?.mappingRule)
  if (byCwd !== null) return byCwd.id
  const activeGroupId = settings?.activeGroupId
  if (activeGroupId !== undefined && activeGroupId.trim() !== '') {
    return groups.find(group => group.id === activeGroupId)?.id ?? null
  }
  return null
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
  ctx.effect(() => registerCoAgentHubTools(ctx, client, settingsStore), 'coagenthub.tools()')

  // B 方案后台事件链路:WS 订阅 + 低频轮询兜底。通知走主动推送适配器:
  // dsh 运行时暴露 ctx.agents 注册表时,用 agent.followup 排队 next-turn
  // 消息并唤醒当前会话;否则回退 NullPushAdapter 入队,由
  // coagenthub_get_notifications 补读。
  const log = (message: string) => ctx.logger?.('coagenthub').info(message)
  const nullAdapter = () => new NullPushAdapter({
    reason: 'dsh 运行时未暴露 ctx.agents 注册表(无 agent.followup 唤醒能力)',
    log,
  })
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
    ctx.logger?.('coagenthub').info('dsh 运行时支持主动唤醒(agent.followup),通知将直接推送进会话并唤醒 driver')
    deliverer.setPushAdapter(new DshAgentPushAdapter({
      resolveAgent: () => registry.roots()[0],
      // 推送前按会话 cwd 反查群隔离:agent.session.header.cwd(dsh-session
      // SessionHeader)是会话创建时的绝对工作目录,旧结构回退 meta.cwd;用它
      // 反查当前会话对应的群,只把该群的通知 followup 推入本会话,其他群的
      // 通知由适配器入队隔离,避免 0.0.16 后 TaskWatcher 收集到的其他群通知
      // 被注入当前会话。
      // 会话→群反查结果按 agent 会话 + settings 缓存(TTL 内复用),避免每条
      // 通知都打一次 listGroups HTTP(接口慢/挂时最坏卡 10s,通知悬在"既未
      // 入队也未推送"状态);反查失败也缓存为 null,通知立即入队由
      // coagenthub_get_notifications 补读,网络恢复后 TTL 过期自动重查。
      resolveSessionGroupId: async () => {
        const agent = registry.roots()[0]
        const settings = settingsStore?.get()
        const cacheKey = [
          agent?.id ?? '',
          settings?.mappingRule?.macPrefix ?? '',
          settings?.mappingRule?.winPrefix ?? '',
          settings?.activeGroupId ?? '',
        ].join('|')
        const cached = sessionGroupCache.get(cacheKey)
        if (cached !== undefined && Date.now() - cached.at < SESSION_GROUP_CACHE_TTL_MS) {
          return cached.groupId
        }
        // 同一 key 的并发推送共享一次反查:突发终态通知不产生 N 个并发 listGroups。
        const inflight = sessionGroupInflight.get(cacheKey)
        if (inflight !== undefined) return inflight
        const pending = (async (): Promise<string | null> => {
          let groupId: string | null = null
          if (agent !== undefined) {
            // 与拉取侧 workspaceRootFromExec 一致:header.cwd 优先,旧结构 meta.cwd 兜底。
            const session = agent.session as { header?: { cwd?: string }; meta?: { cwd?: string } } | undefined
            const cwd = session?.header?.cwd ?? session?.meta?.cwd
            if (cwd !== undefined && cwd !== null && cwd.trim() !== '') {
              try {
                const groups = await withTimeout(client.listGroups(100), SESSION_GROUP_RESOLVE_TIMEOUT_MS)
                groupId = resolveGroupIdForCwd(cwd, groups.items, settings)
              } catch {
                groupId = null // 反查失败/超时:本轮全部入队,由 get_notifications 补读。
              }
            }
          }
          return groupId
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
