/**
 * CoAgentHub tools plugin for DeepSeek Harness: lets the dsh agent operate
 * CoAgentHub (list participants / create groups / post messages / dispatch
 * tasks / query tasks) through six tools.
 * @module @laizhixingxingdeli/dsh-coagenthub
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { CoAgentHubClient } from './client.ts'
import { getCoAgentHubSettingsStore } from './config.ts'
import { DshAgentPushAdapter, NullPushAdapter, createNotificationDeliverer, type PushAdapter } from './notify.ts'
import { TaskWatcher } from './task-watcher.ts'
import { registerCoAgentHubTools } from './tools.ts'
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
  // dsh 运行时暴露 ctx.agents 注册表时,用 agent.inject 注入当前会话;
  // 否则回退 NullPushAdapter 入队,由 coagenthub_get_notifications 补读。
  const adapter = buildPushAdapter(ctx)
  const deliverer = createNotificationDeliverer(adapter)
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
    getActiveGroupId: () => settingsStore.get().activeGroupId,
  })
  ctx.effect(
    () => {
      watcher.start()
      return () => watcher.stop()
    },
    'coagenthub.task-watcher()',
  )
}

/**
 * 探测 dsh 运行时注入能力并选择推送适配器。后台插件上下文没有稳定 agent
 * 句柄(`ctx.agent` 仅在 agent 作用域上下文中存在),因此通过 `ctx.agents`
 * 注册表在每次推送时解析 live agent(root)。运行时未暴露注册表时回退
 * NullPushAdapter(入队 + 日志说明原因)。
 */
function buildPushAdapter(ctx: Context): PushAdapter {
  const log = (message: string) => ctx.logger?.('coagenthub').info(message)
  // cordis 4 要求服务先声明注入才能读取;后台插件上下文未注入 agents 服务时,
  // 直接读 ctx.agents 会抛 "cannot get property "agents" without inject",
  // 导致 dsh web 重启后插件启动失败。因此 try/catch 安全探测:注册表可用则
  // 主动推送,否则回退 NullPushAdapter 入队,由 get_notifications 补读。
  let probed: { roots(): Agent[] } | undefined
  try {
    probed = (ctx as Context & { agents?: { roots(): Agent[] } }).agents
  } catch {
    probed = undefined
  }
  const registry = probed
  if (registry !== undefined && typeof registry.roots === 'function') {
    ctx.logger?.('coagenthub').info('dsh 运行时支持主动注入(agent.inject),通知将直接推送进会话')
    return new DshAgentPushAdapter({
      resolveAgent: () => registry.roots()[0],
      log,
    })
  }
  ctx.logger?.('coagenthub').warn('dsh 运行时未暴露 ctx.agents 注册表,主动推送不可用;通知入队由 coagenthub_get_notifications 补读')
  return new NullPushAdapter({
    reason: 'dsh 运行时未暴露 ctx.agents 注册表(无 agent.inject 注入能力)',
    log,
  })
}
