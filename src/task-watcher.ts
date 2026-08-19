/**
 * Background task-status monitoring (host half). Terminal (completion) events
 * are now sourced from the CoAgentHub core durable inbox via the
 * {@link CompletionConsumer}; the watcher only reacts to the lightweight
 * `task_completion_available` WS hint (triggers an immediate consume) and runs
 * a low-frequency timer to consume the inbox as a WS-loss / reconnect fallback.
 *
 * Non-terminal instant notifications (e.g. `task_stall_alert`) continue to use
 * the existing WS path and do NOT enter the completion inbox.
 *
 * The previous per-group task polling + in-memory `previousStatuses` baseline
 * inference is removed: completion events are durable and authoritative, so the
 * watcher no longer needs to guess terminal states from task snapshots.
 * @module @laizhixingxingdeli/dsh-coagenthub/task-watcher
 */

import type { CoAgentHubClient } from './client.ts'
import type { CoAgentHubNotification, CoAgentHubNotificationType } from './notification-queue.ts'
import type { NotificationDeliverer } from './notify.ts'
import type { CoAgentHubWsClient, WsEventFrame } from './ws-client.ts'
import type { CompletionConsumer } from './completion-consumer.ts'

/**
 * Fallback consume cadence: the inbox is polled at this interval as a reliable
 * backup when the WS hint is lost or the socket is reconnecting. 30s balances
 * latency against server load; each tick processes a bounded batch.
 */
export const DEFAULT_CONSUME_INTERVAL_MS = 30_000

/** Notification summary cap. */
export const WATCHER_SUMMARY_LIMIT = 200

export interface TaskWatcherOptions {
  /** HTTP client (identity-bearing) — passed through to the consumer. */
  client: CoAgentHubClient
  /** WebSocket client whose frames the watcher consumes. */
  ws: CoAgentHubWsClient
  /** Notification sink (queue + optional active push). */
  deliver: NotificationDeliverer
  /** Durable completion consumer driving claim→deliver→ack. */
  consumer: CompletionConsumer
  /** Fallback consume cadence; defaults to {@link DEFAULT_CONSUME_INTERVAL_MS}. */
  consumeIntervalMs?: number
}

/** Map a task status to the notification type. */
export function notificationTypeFor(status: string): CoAgentHubNotificationType {
  if (status === 'done') return 'task.completed'
  if (status === 'failed') return 'task.failed'
  if (status === 'stalled') return 'task.stalled'
  return 'task.status_changed'
}

function summarize(text: string | null | undefined): string | undefined {
  const value = (text ?? '').trim()
  if (value === '') return undefined
  return value.length > WATCHER_SUMMARY_LIMIT ? `${value.slice(0, WATCHER_SUMMARY_LIMIT)}…` : value
}

/**
 * 归一化 dispatcher 路由字段:null/undefined/空串都视为无(服务端字段可能尚不
 * 存在,一律容错)。
 */
function dispatcherField(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed
}

/**
 * One background monitor per plugin instance. `start()` wires the WS frame
 * handler, connects the socket, and begins the fallback consume timer; `stop()`
 * tears both down. Frame handling and consume are exposed as public methods so
 * unit tests can drive them without timers or a live socket.
 */
export class TaskWatcher {
  private readonly client: CoAgentHubClient
  private readonly ws: CoAgentHubWsClient
  private readonly deliver: NotificationDeliverer
  private readonly consumer: CompletionConsumer
  private readonly consumeIntervalMs: number
  private timer: ReturnType<typeof setInterval> | null = null

  constructor(options: TaskWatcherOptions) {
    this.client = options.client
    this.ws = options.ws
    this.deliver = options.deliver
    this.consumer = options.consumer
    this.consumeIntervalMs = options.consumeIntervalMs ?? DEFAULT_CONSUME_INTERVAL_MS
  }

  get running(): boolean {
    return this.timer !== null
  }

  /** Wire the WS handler, connect, and start the fallback consume timer. */
  start(): void {
    if (this.timer !== null) return
    this.ws.onEvent = (frame) => this.handleFrame(frame)
    this.ws.start()
    // 启动即消费一次:插件重启期间产生的 event 从 core inbox 恢复并注入原 session。
    void this.consumer.consume()
    this.timer = setInterval(() => {
      // 身份配置变化时自动重连(设置面板保存后生效)。
      this.ws.refreshIdentity()
      void this.consumer.consume()
    }, this.consumeIntervalMs)
  }

  /** Unsubscribe, disconnect the socket, and stop the timer. */
  stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer)
      this.timer = null
    }
    this.ws.stop()
  }

  /**
   * Route one WS frame. `task_completion_available` triggers an immediate inbox
   * consume (low-latency path); `task_stall_alert` is delivered directly as a
   * non-terminal instant notification. Other frame types are ignored.
   */
  handleFrame(frame: WsEventFrame): void {
    const groupId = typeof frame.groupId === 'string' ? frame.groupId : undefined
    if (groupId === undefined || groupId.trim() === '') return
    switch (frame.type) {
      case 'task_completion_available': {
        // 轻量提示帧:立即消费 inbox,可靠性来源始终是数据库。
        void this.consumer.consume()
        return
      }
      case 'task_stall_alert': {
        if (typeof frame.taskId !== 'string') return
        const time = new Date().toISOString()
        const dispatcherSessionId = dispatcherField(frame.dispatcherSessionId)
        const dispatcherParticipantId = dispatcherField(frame.dispatcherParticipantId)
        this.deliver.deliver({
          type: 'task.stalled',
          groupId,
          taskId: frame.taskId,
          status: 'stalled',
          executorName: typeof frame.executorName === 'string' && frame.executorName !== ''
            ? frame.executorName
            : undefined,
          summary: summarize(typeof frame.summary === 'string' ? frame.summary : undefined),
          dispatcherSessionId,
          dispatcherParticipantId,
          time,
        })
        return
      }
      default:
        return
    }
  }
}
