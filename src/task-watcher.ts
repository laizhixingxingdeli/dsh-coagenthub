/**
 * Background task-status monitoring (host half). Subscribes to CoAgentHub WS
 * frames (`group_message` / `task_output` / `task_stall_alert`, plus
 * `task_status_changed` when the server emits it) and, as a fallback, polls the
 * active group's tasks at a low frequency to catch queued→running→done/failed
 * transitions. Every detected event is delivered as a notification through the
 * {@link NotificationDeliverer} (queue-backed by default).
 * @module @laizhixingxingdeli/dsh-coagenthub/task-watcher
 */

import type { CoAgentHubClient, Task } from './client.ts'
import type { CoAgentHubNotification, CoAgentHubNotificationType } from './notification-queue.ts'
import type { NotificationDeliverer } from './notify.ts'
import type { CoAgentHubWsClient, WsEventFrame } from './ws-client.ts'

/** Polling fallback cadence (ticket: 3~5s). */
export const DEFAULT_POLL_INTERVAL_MS = 4_000

/** Notification summary cap. */
export const WATCHER_SUMMARY_LIMIT = 200

export interface TaskWatcherOptions {
  /** HTTP client used for the polling fallback. */
  client: CoAgentHubClient
  /** WebSocket client whose frames the watcher consumes. */
  ws: CoAgentHubWsClient
  /** Notification sink (queue + optional active push). */
  deliver: NotificationDeliverer
  /** Resolve the currently active group id (settings store). */
  getActiveGroupId: () => string | undefined
  /** Polling fallback cadence; defaults to {@link DEFAULT_POLL_INTERVAL_MS}. */
  pollIntervalMs?: number
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

/** Frame → executor display name (executorName, else resolved participant id). */
function executorNameFromFrame(frame: WsEventFrame, nameById: Map<string, string>): string | undefined {
  if (typeof frame.executorName === 'string' && frame.executorName !== '') return frame.executorName
  if (typeof frame.executorParticipantId === 'string' && frame.executorParticipantId !== '') {
    return nameById.get(frame.executorParticipantId) ?? frame.executorParticipantId
  }
  return undefined
}

/**
 * One background monitor per plugin instance. `start()` wires the WS frame
 * handler, connects the socket, and begins the fallback poller; `stop()` tears
 * both down. Frames and polls are also exposed as public methods so unit tests
 * can drive them without timers or a live socket.
 */
export class TaskWatcher {
  private readonly client: CoAgentHubClient
  private readonly ws: CoAgentHubWsClient
  private readonly deliver: NotificationDeliverer
  private readonly getActiveGroupId: () => string | undefined
  private readonly pollIntervalMs: number
  private timer: ReturnType<typeof setInterval> | null = null
  /** Last observed status per task id; baseline on first sight. */
  private previousStatuses = new Map<string, string>()
  private nameById = new Map<string, string>()

  constructor(options: TaskWatcherOptions) {
    this.client = options.client
    this.ws = options.ws
    this.deliver = options.deliver
    this.getActiveGroupId = options.getActiveGroupId
    this.pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS
  }

  get running(): boolean {
    return this.timer !== null
  }

  /** Wire the WS handler, connect, and start the fallback poller. */
  start(): void {
    if (this.timer !== null) return
    this.ws.onEvent = (frame) => this.handleFrame(frame)
    this.ws.start()
    this.timer = setInterval(() => {
      // 身份配置变化时自动重连(设置面板保存后生效)。
      this.ws.refreshIdentity()
      void this.pollOnce()
    }, this.pollIntervalMs)
  }

  /** Unsubscribe, disconnect the socket, and stop the poller. */
  stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer)
      this.timer = null
    }
    this.ws.stop()
  }

  /** Route one WS frame to the matching notification type. */
  handleFrame(frame: WsEventFrame): void {
    const groupId = typeof frame.groupId === 'string' ? frame.groupId : undefined
    const time = new Date().toISOString()
    switch (frame.type) {
      case 'group_message': {
        if (groupId === undefined) return
        this.deliver.deliver({ type: 'message.received', groupId, time })
        return
      }
      case 'task_stall_alert': {
        if (groupId === undefined || typeof frame.taskId !== 'string') return
        this.deliver.deliver({
          type: 'task.stalled',
          groupId,
          taskId: frame.taskId,
          status: 'stalled',
          executorName: executorNameFromFrame(frame, this.nameById),
          summary: summarize(typeof frame.summary === 'string' ? frame.summary : undefined),
          time,
        })
        return
      }
      case 'task_status_changed':
      case 'task_output': {
        if (groupId === undefined || typeof frame.taskId !== 'string') return
        const status = typeof frame.status === 'string' ? frame.status : undefined
        // task_output 帧多为流式输出,仅对终态/停滞变化发通知,避免刷屏。
        if (status === undefined) return
        if (frame.type === 'task_output' && !['done', 'failed', 'stalled', 'cancelled'].includes(status)) return
        this.deliver.deliver({
          type: notificationTypeFor(status),
          groupId,
          taskId: frame.taskId,
          status,
          executorName: executorNameFromFrame(frame, this.nameById),
          summary: summarize(typeof frame.summary === 'string' ? frame.summary : undefined),
          time,
        })
        return
      }
      default:
        return
    }
  }

  /** Poll the active group's tasks once; notify on status transitions. */
  async pollOnce(): Promise<void> {
    const groupId = this.getActiveGroupId()
    if (groupId === undefined || groupId.trim() === '') return
    let tasks: Task[]
    try {
      const [taskList, participants] = await Promise.all([
        this.client.listTasks(groupId),
        this.client.listParticipants(),
      ])
      tasks = taskList
      this.nameById = new Map(participants.map(participant => [participant.id, participant.name]))
    } catch {
      return // 轮询失败静默,下一轮再试。
    }
    const time = new Date().toISOString()
    for (const task of tasks) {
      const prev = this.previousStatuses.get(task.id)
      if (prev === task.status) continue
      this.previousStatuses.set(task.id, task.status)
      if (prev === undefined) continue // 首次见到:仅记录基线,不通知。
      const summary = task.diffSummary?.summary ?? task.diffSummary?.error
      this.deliver.deliver({
        type: notificationTypeFor(task.status),
        groupId,
        taskId: task.id,
        status: task.status,
        executorName: this.nameById.get(task.executorParticipantId),
        summary: summarize(summary),
        time,
      })
    }
  }
}
