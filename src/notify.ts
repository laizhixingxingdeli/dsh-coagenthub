/**
 * Notification delivery to the dsh agent (host half). The dsh runtime exposes
 * `agent.inject(UserMessage)` as the injection capability, but a background
 * plugin context has no stable agent handle (and fabricating a valid
 * `UserMessage` id/source outside the session store is not safe), so the
 * default delivery path is the shared in-memory queue drained by the
 * `coagenthub_get_notifications` tool. The push interface is kept so a future
 * runtime wiring can attach an active pusher without changing callers.
 * @module @laizhixingxingdeli/dsh-coagenthub/notify
 */

import { notificationQueue } from './notification-queue.ts'
import type { CoAgentHubNotification, CoAgentHubNotificationType } from './notification-queue.ts'

/** Active-push signature: push one notification into the agent's context. */
export type NotificationPush = (notification: CoAgentHubNotification) => void

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

/** Notification delivery entry point: push when wired, else queue (fallback). */
export interface NotificationDeliverer {
  /** Queue the notification for the `coagenthub_get_notifications` tool. */
  enqueue(notification: CoAgentHubNotification): void
  /** Push first when an active pusher is wired; on any failure, queue. */
  deliver(notification: CoAgentHubNotification): void
  /** Return and clear the pending queue. */
  drain(): CoAgentHubNotification[]
}

/** Build a deliverer; `push` may be undefined (queue-only fallback mode). */
export function createNotificationDeliverer(push?: NotificationPush): NotificationDeliverer {
  return {
    enqueue(notification) {
      notificationQueue.enqueue(notification)
    },
    deliver(notification) {
      if (push !== undefined) {
        try {
          push(notification)
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
export const notificationDeliverer = createNotificationDeliverer()
