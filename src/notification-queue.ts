/**
 * In-memory notification queue for background CoAgentHub events (task
 * completed / failed / stalled / status changed, new messages). The task
 * watcher enqueues, and the agent drains via the `coagenthub_get_notifications`
 * tool (or a future runtime push). Bounded FIFO: the oldest entries are
 * dropped past capacity so memory stays flat.
 * @module @laizhixingxingdeli/dsh-coagenthub/notification-queue
 */

export type CoAgentHubNotificationType =
  | 'task.completed'
  | 'task.failed'
  | 'task.stalled'
  | 'task.status_changed'
  | 'message.received'

export interface CoAgentHubNotification {
  type: CoAgentHubNotificationType
  /** Group the event belongs to. */
  groupId: string
  /** Task id when the event is task-related. */
  taskId?: string
  /** Task status when the event is task-related. */
  status?: string
  /** Executor display name when resolvable. */
  executorName?: string
  /** 汇报摘要:diffSummary.summary / brief tail,截断。 */
  summary?: string
  /** ISO 8601 timestamp of the event. */
  time: string
}

/** Hard cap so a backlogged queue cannot grow unbounded. */
export const NOTIFICATION_QUEUE_CAPACITY = 200

/** Thread-safe enough for a single-threaded Node host: enqueue/drain only. */
export class NotificationQueue {
  private items: CoAgentHubNotification[] = []

  /** Current pending count. */
  get size(): number {
    return this.items.length
  }

  /** Append one notification, dropping the oldest past capacity. */
  enqueue(notification: CoAgentHubNotification): void {
    this.items.push(notification)
    if (this.items.length > NOTIFICATION_QUEUE_CAPACITY) {
      this.items.splice(0, this.items.length - NOTIFICATION_QUEUE_CAPACITY)
    }
  }

  /** Return all pending notifications and clear the queue. */
  drain(): CoAgentHubNotification[] {
    const pending = this.items
    this.items = []
    return pending
  }

  /**
   * Return pending notifications for one group and remove only those; other
   * groups' notifications stay queued in place (通知按当前工作区隔离,不同群的
   * 事件不会串到当前会话,也不会因 drain 而丢失)。
   */
  drainByGroup(groupId: string): CoAgentHubNotification[] {
    const matched: CoAgentHubNotification[] = []
    const kept: CoAgentHubNotification[] = []
    for (const item of this.items) {
      if (item.groupId === groupId) matched.push(item)
      else kept.push(item)
    }
    this.items = kept
    return matched
  }

  /** Read without clearing (用于补读/调试)。 */
  peek(): CoAgentHubNotification[] {
    return [...this.items]
  }
}

/** Shared singleton consumed by the task watcher and the tools layer. */
export const notificationQueue = new NotificationQueue()
