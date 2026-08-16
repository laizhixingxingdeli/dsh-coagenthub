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
  /**
   * 推送前按会话隔离:反查当前会话 cwd 对应的群 id(通常用
   * findGroupByWorkspaceCwd)。返回该群 id 时,只有 `notification.groupId`
   * 与之相等的通知才会 followup 推送;返回 null/undefined/空串(无法解析
   * cwd 或反查不到群)或解析抛错时,通知只入队不推送,由对应会话的
   * `coagenthub_get_notifications` 按 cwd 拉取,不丢失、不串群。
   */
  resolveSessionGroupId?: () => string | null | undefined | Promise<string | null | undefined>
  /**
   * 按会话 id 定向解析 live agent(dispatcherSessionId 路由,优先级最高)。
   * 命中时通知直接 followup 到该会话,不再走群级过滤(下发会话即权威目标);
   * 未配置或返回 undefined 时继续回退到 participant+group、群级兜底。
   */
  resolveAgentBySessionId?: (sessionId: string) => Agent | undefined
  /**
   * 按 下发者 participant id + 通知群 id 解析 live agent(dispatcherParticipantId
   * 兜底路由)。返回该 participant 下归属群等于通知群的那个会话;返回
   * undefined(身份不属于本实例 / 无匹配会话)时继续回退到群级兜底。解析抛错
   * 视为找不到,通知最终入队由 get_notifications 补读,不丢通知。
   */
  resolveAgentByParticipantId?: (
    participantId: string,
    groupId: string,
  ) => Agent | undefined | Promise<Agent | undefined>
  /** 可选日志回调(推送成功 / 回退说明)。 */
  log?: (message: string) => void
}

/** 判断通知上的 dispatcher 路由字段是否可用(非空字符串)。 */
function isUsableDispatcherField(value: string | undefined): value is string {
  return value !== undefined && value.trim() !== ''
}

/**
 * 基于 dsh `Agent.followup(UserMessage)` 的主动推送适配器。通知被包装成
 * plugin 来源的用户消息,排队为指定 agent 的 next-turn 消息并唤醒 driver。
 * 路由优先级(下发者必收):① dispatcherSessionId 定向到对应 live 会话 →
 * ② dispatcherParticipantId + groupId 兜底 → ③ 现有群级过滤(当前会话 cwd
 * 反查群,相等才推送) → 全部找不到时抛出,由 deliverer 回落队列。任何一层
 * 推送成功都不入队;失败/找不到才入队,避免重复。
 */
export class DshAgentPushAdapter implements PushAdapter {
  private readonly resolveAgent: () => Agent | undefined
  private readonly resolveSessionGroupId?: () => string | null | undefined | Promise<string | null | undefined>
  private readonly resolveAgentBySessionId?: (sessionId: string) => Agent | undefined
  private readonly resolveAgentByParticipantId?: (
    participantId: string,
    groupId: string,
  ) => Agent | undefined | Promise<Agent | undefined>
  private readonly log?: (message: string) => void

  constructor(options: DshAgentPushAdapterOptions) {
    this.resolveAgent = options.resolveAgent
    this.resolveSessionGroupId = options.resolveSessionGroupId
    this.resolveAgentBySessionId = options.resolveAgentBySessionId
    this.resolveAgentByParticipantId = options.resolveAgentByParticipantId
    this.log = options.log
  }

  /** followup 推送 + 日志;抛错由 deliverer 捕获并入队,不丢通知。 */
  private followup(agent: Agent, notification: CoAgentHubNotification): void {
    agent.followup(createUserMessage({
      content: [{ type: 'text', text: formatNotification(notification) }],
      source: { kind: 'plugin', plugin: NOTIFICATION_PLUGIN_NAME },
    }))
    this.log?.(`[coagenthub] 主动推送(唤醒) → ${agent.id}: ${formatNotification(notification)}`)
  }

  async push(notification: CoAgentHubNotification): Promise<void> {
    // ① dispatcherSessionId 定向:命中即推送到该会话,不走群级过滤。
    if (isUsableDispatcherField(notification.dispatcherSessionId) && this.resolveAgentBySessionId !== undefined) {
      const agent = this.resolveAgentBySessionId(notification.dispatcherSessionId)
      if (agent !== undefined) {
        this.followup(agent, notification)
        return
      }
    }
    // ② dispatcherParticipantId + groupId 兜底:找到下发者身份下归属该群的会话。
    if (isUsableDispatcherField(notification.dispatcherParticipantId) && this.resolveAgentByParticipantId !== undefined) {
      let agent: Agent | undefined
      try {
        agent = await this.resolveAgentByParticipantId(notification.dispatcherParticipantId, notification.groupId)
      } catch {
        agent = undefined // 解析失败视为找不到,继续回退/入队。
      }
      if (agent !== undefined) {
        this.followup(agent, notification)
        return
      }
    }
    // ③ 群级 fallback:当前会话 cwd 反查群过滤(保留既有行为)。
    const agent = this.resolveAgent()
    if (agent === undefined) {
      throw new Error('no live dsh agent to followup')
    }
    if (this.resolveSessionGroupId !== undefined) {
      let sessionGroupId: string | null | undefined
      try {
        sessionGroupId = await this.resolveSessionGroupId()
      } catch {
        sessionGroupId = null // 反查失败视为无法解析:全部入队,不丢通知。
      }
      const resolved = typeof sessionGroupId === 'string' && sessionGroupId.trim() !== ''
      if (!resolved || notification.groupId !== sessionGroupId) {
        // 会话 cwd 不可解析,或通知属于其他群:只入队,由对应会话按 cwd 拉取,
        // 不注入当前会话上下文(会话隔离)。
        notificationQueue.enqueue(notification)
        const where = resolved ? `当前会话群 ${sessionGroupId} 不匹配` : '无法解析会话 cwd 对应群'
        this.log?.(`[coagenthub] ${where},通知(群 ${notification.groupId})入队待 coagenthub_get_notifications 补读: ${formatNotification(notification)}`)
        return
      }
    }
    this.followup(agent, notification)
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
  /** Switch the active push adapter at runtime (wake-up capability may appear later). */
  setPushAdapter(adapter?: PushAdapter | NotificationPush): void
  /** Return and clear the pending queue. */
  drain(): CoAgentHubNotification[]
}

/** Derive the push function from an adapter instance or a legacy bare function. */
function toPush(adapter?: PushAdapter | NotificationPush): NotificationPush | undefined {
  return typeof adapter === 'function'
    ? adapter
    : adapter?.push.bind(adapter)
}

/**
 * Build a deliverer; `adapter` may be a {@link PushAdapter} (preferred) or a
 * bare push function (legacy call shape). When absent, delivery is
 * queue-only fallback mode. The active adapter can be swapped at runtime via
 * {@link NotificationDeliverer.setPushAdapter} — e.g. when the dsh `agents`
 * service becomes available after plugin load — without losing queued state.
 */
export function createNotificationDeliverer(adapter?: PushAdapter | NotificationPush): NotificationDeliverer {
  let push: NotificationPush | undefined = toPush(adapter)
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
    setPushAdapter(adapter?: PushAdapter | NotificationPush) {
      push = toPush(adapter)
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
