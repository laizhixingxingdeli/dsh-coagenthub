/**
 * Notification delivery to the dsh agent (host half).
 *
 * 调研结论(dsh-agent 0.1.0-rc.6 / dsh-llm 0.1.0-rc.6):
 * - dsh 运行时暴露主动唤醒 API:`Agent.followup(UserMessage)`(dsh-agent
 *   runtime-types.d.ts),把一条普通 next-turn 消息排队并唤醒 driver——正是
 *   "后台任务完成后向 agent 汇报并唤醒会话"所需的语义。dsh-llm 的
 *   `createUserMessage({ content, source })` 可构造合法 UserMessage(自动生成
 *   稳定 id);`source: { kind: 'plugin', plugin }` 是官方 MessageSourceMap 的
 *   plugin 来源,无需伪造会话存储里的 id/source。
 * - 后台插件上下文(`apply` 的根 ctx)上 `ctx.agent` 为 undefined,没有稳定 agent
 *   句柄;但 `ctx.agents`(AgentRegistry)可 `roots()`/`list()` 解析 live agent,
 *   因此推送时现查即可。
 * - 本模块因此提供 `PushAdapter` 抽象:有唤醒能力时用 `DshAgentPushAdapter`
 *   (`agent.followup` 真正唤醒会话),否则保留 `NullPushAdapter` 回退——通知入队,
 *   由 `coagenthub_get_notifications` 工具补读,并在日志中说明原因。
 * @module @laizhixingxingdeli/dsh-coagenthub/notify
 */

import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { notificationQueue } from './notification-queue.ts'
import type { CoAgentHubNotification, CoAgentHubNotificationType } from './notification-queue.ts'

/** Plugin 来源标记,用于注入消息的 source(MessageSourceMap.plugin)。 */
export const NOTIFICATION_PLUGIN_NAME = 'coagenthub'

/** Active-push signature: push one notification into the agent's next turn. */
export type NotificationPush = (notification: CoAgentHubNotification) => void

/**
 * 主动推送适配器:把一条通知送进 dsh 会话(followup 唤醒)或队列(回退)。
 * 实现方应保证:推送失败(无 agent 句柄 / followup 抛错 / 拒绝)时通知不丢,
 * 由 deliverer 回落队列。
 */
export interface PushAdapter {
  push(notification: CoAgentHubNotification): Promise<void> | void
}

/** Summary cap so a notification line stays small. */
export const NOTIFICATION_SUMMARY_LIMIT = 200

/** One-line human-readable form of a notification (push content / debug). */
export function formatNotification(notification: CoAgentHubNotification): string {
  const parts = [
    notificationTypeLabel(notification.type),
    notification.groupId !== undefined && notification.groupId !== '' ? `群 ${notification.groupId}` : null,
    notification.taskId !== undefined && notification.taskId !== '' ? `任务 ${notification.taskId}` : null,
    notification.status !== undefined && notification.status !== '' ? `状态 ${notification.status}` : null,
    notification.executorName !== undefined && notification.executorName !== '' ? `执行器 ${notification.executorName}` : null,
  ].filter((part): part is string => part !== null)
  const head = parts.join(' / ')
  if (notification.summary === undefined || notification.summary === '') return head
  const summary = notification.summary.length > NOTIFICATION_SUMMARY_LIMIT
    ? `${notification.summary.slice(0, NOTIFICATION_SUMMARY_LIMIT)}…`
    : notification.summary
  return `${head}\n${summary}`
}

function notificationTypeLabel(type: CoAgentHubNotificationType): string {
  switch (type) {
    case 'task.completed': return '任务完成'
    case 'task.failed': return '任务失败'
    case 'task.stalled': return '任务停滞'
    case 'task.status_changed': return '任务状态变化'
    case 'message.received': return '收到新消息'
  }
}

/** Options for {@link DshAgentPushAdapter}. */
export interface DshAgentPushAdapterOptions {
  /** 推送时解析可注入的 agent;后台上下文无稳定句柄,每次推送现查。 */
  resolveAgent: () => Agent | undefined
  /** 可选日志回调(推送成功 / 回退说明)。 */
  log?: (message: string) => void
}

/**
 * 基于 dsh `Agent.followup(UserMessage)` 的主动推送适配器。通知被包装成
 * plugin 来源的用户消息,排队为当前 agent 的 next-turn 消息并唤醒 driver;
 * 解析不到 agent 时抛出,由 deliverer 回退队列。
 */
export class DshAgentPushAdapter implements PushAdapter {
  private readonly resolveAgent: () => Agent | undefined
  private readonly log?: (message: string) => void

  constructor(options: DshAgentPushAdapterOptions) {
    this.resolveAgent = options.resolveAgent
    this.log = options.log
  }

  push(notification: CoAgentHubNotification): void {
    const agent = this.resolveAgent()
    if (agent === undefined) {
      throw new Error('no live dsh agent to followup')
    }
    agent.followup(createUserMessage({
      content: [{ type: 'text', text: formatNotification(notification) }],
      source: { kind: 'plugin', plugin: NOTIFICATION_PLUGIN_NAME },
    }))
    this.log?.(`[coagenthub] 主动推送(唤醒) → ${agent.id}: ${formatNotification(notification)}`)
  }
}

/** Options for {@link NullPushAdapter}. */
export interface NullPushAdapterOptions {
  /** 回退原因说明,写入日志。 */
  reason?: string
  /** 可选日志回调。 */
  log?: (message: string) => void
}

/**
 * 纯回退适配器:dsh 运行时未接入主动注入(或未接线)时,通知直接入队供
 * `coagenthub_get_notifications` 补读,并记录原因。
 */
export class NullPushAdapter implements PushAdapter {
  private readonly reason: string
  private readonly log?: (message: string) => void

  constructor(options: NullPushAdapterOptions = {}) {
    this.reason = options.reason ?? 'dsh 运行时未接入 agent.followup'
    this.log = options.log
  }

  push(notification: CoAgentHubNotification): void {
    notificationQueue.enqueue(notification)
    this.log?.(`[coagenthub] 主动推送不可用(${this.reason}),通知入队待 coagenthub_get_notifications 补读`)
  }
}

/** Notification delivery entry point: push when wired, else queue (fallback). */
export interface NotificationDeliverer {
  /** Queue the notification for the `coagenthub_get_notifications` tool. */
  enqueue(notification: CoAgentHubNotification): void
  /** Push first when an active pusher is wired; on any failure, queue. */
  deliver(notification: CoAgentHubNotification): void
  /** Return and clear the pending queue. */
  drain(): CoAgentHubNotification[]
}

/**
 * Build a deliverer; `adapter` may be a {@link PushAdapter} (preferred) or a
 * bare push function (legacy call shape). When absent, delivery is
 * queue-only fallback mode.
 */
export function createNotificationDeliverer(adapter?: PushAdapter | NotificationPush): NotificationDeliverer {
  const push: NotificationPush | undefined = typeof adapter === 'function'
    ? adapter
    : adapter?.push.bind(adapter)
  return {
    enqueue(notification) {
      notificationQueue.enqueue(notification)
    },
    deliver(notification) {
      if (push !== undefined) {
        try {
          const result = push(notification)
          if (result !== undefined && typeof (result as Promise<void>).catch === 'function') {
            void (result as Promise<void>).catch(() => {
              // 异步推送失败不丢通知:回落队列,agent 可用 get_notifications 补读。
              notificationQueue.enqueue(notification)
            })
            return
          }
          return
        } catch {
          // 推送失败不丢通知:回落队列,agent 可用 get_notifications 补读。
        }
      }
      notificationQueue.enqueue(notification)
    },
    drain() {
      return notificationQueue.drain()
    },
  }
}

/** Shared deliverer used by the task watcher; queue-backed by default. */
export const notificationDeliverer = createNotificationDeliverer(new NullPushAdapter({
  reason: '未接线主动推送(运行时接入后在 index.ts 覆写)',
}))
