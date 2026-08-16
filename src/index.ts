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
import { DshAgentPushAdapter, NullPushAdapter, createNotificationDeliverer } from './notify.ts'
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
