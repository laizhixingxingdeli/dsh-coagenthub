/**
 * Background task-status monitoring (host half). Subscribes to CoAgentHub WS
 * frames (`group_message` / `task_output` / `task_stall_alert`, plus
 * `task_status_changed` when the server emits it) and, as a fallback, polls
 * every group's tasks at a low frequency to catch queued→running→done/failed
 * transitions. Frames and polls are NOT filtered by the active group: all
 * groups' terminal events are enqueued, and per-session isolation happens at
 * drain time (`coagenthub_get_notifications` resolves the group from the
 * session cwd and drains only that group). Every detected event is delivered
 * as a notification through the {@link NotificationDeliverer} (queue-backed by
 * default).
 * @module @laizhixingxingdeli/dsh-coagenthub/task-watcher
 */

import type { CoAgentHubClient, Group, Task } from './client.ts'
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
 * 归一化 dispatcher 路由字段:null/undefined/空串都视为无(服务端字段可能尚不
 * 存在,一律容错)。frame 与 task 载荷同用。
 */
function dispatcherField(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed
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
  private readonly pollIntervalMs: number
  private timer: ReturnType<typeof setInterval> | null = null
  /** Last observed status per task id (keyed by `groupId/taskId`); baseline on first sight. */
  private previousStatuses = new Map<string, string>()
  private nameById = new Map<string, string>()

  constructor(options: TaskWatcherOptions) {
    this.client = options.client
    this.ws = options.ws
    this.deliver = options.deliver
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

  /**
   * Route one WS frame to the matching notification type. Frames are NOT
   * filtered by the active group: every group's terminal event is enqueued so
   * any session (identified by cwd) can later drain its own group's
   * notifications without cross-group leakage.
   */
  handleFrame(frame: WsEventFrame): void {
    const groupId = typeof frame.groupId === 'string' ? frame.groupId : undefined
    // 无群归属的帧无法定位,直接忽略。
    if (groupId === undefined || groupId.trim() === '') return
    const time = new Date().toISOString()
    // dispatcher 路由字段:服务端回显后用于定向推送,缺失时走群级兜底。
    const dispatcherSessionId = dispatcherField(frame.dispatcherSessionId)
    const dispatcherParticipantId = dispatcherField(frame.dispatcherParticipantId)
    switch (frame.type) {
      case 'group_message': {
        // 群消息不属于需要 agent 处理的终态事件,不再投递 message.received。
        return
      }
      case 'task_stall_alert': {
        if (typeof frame.taskId !== 'string') return
        this.deliver.deliver({
          type: 'task.stalled',
          groupId,
          taskId: frame.taskId,
          status: 'stalled',
          executorName: executorNameFromFrame(frame, this.nameById),
          summary: summarize(typeof frame.summary === 'string' ? frame.summary : undefined),
          dispatcherSessionId,
          dispatcherParticipantId,
          time,
        })
        return
      }
      case 'task_status_changed':
      case 'task_output': {
        if (typeof frame.taskId !== 'string') return
        const status = typeof frame.status === 'string' ? frame.status : undefined
        if (status === undefined) return
        // 只对终态(done/failed/stalled)投递通知;queued/running 等中间状态与
        // task_output 流式输出无信息量,直接跳过。
        if (status !== 'done' && status !== 'failed' && status !== 'stalled') return
        this.deliver.deliver({
          type: notificationTypeFor(status),
          groupId,
          taskId: frame.taskId,
          status,
          executorName: executorNameFromFrame(frame, this.nameById),
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

  /**
   * Poll every group's tasks once (群数量少,逐群拉取成本可接受); notify on
   * terminal status transitions. One group's failure does not affect the others.
   */
  async pollOnce(): Promise<void> {
    let groups: Group[]
    try {
      const [groupList, participants] = await Promise.all([
        this.client.listGroups(100),
        this.client.listParticipants(),
      ])
      groups = groupList.items
      this.nameById = new Map(participants.map(participant => [participant.id, participant.name]))
    } catch {
      return // 轮询失败静默,下一轮再试。
    }
    const time = new Date().toISOString()
    await Promise.all(groups.map(async (group) => {
      let tasks: Task[]
      try {
        tasks = await this.client.listTasks(group.id)
      } catch {
        return // 单个群拉取失败不影响其他群。
      }
      for (const task of tasks) {
        const key = `${group.id}/${task.id}`
        const prev = this.previousStatuses.get(key)
        if (prev === task.status) continue
        this.previousStatuses.set(key, task.status)
        if (prev === undefined) continue // 首次见到:仅记录基线,不通知。
        // 只对终态(done/failed/stalled)变化投递通知;queued/running 等中间状态
        // 只更新基线,不投递。
        if (task.status !== 'done' && task.status !== 'failed' && task.status !== 'stalled') continue
        const summary = task.diffSummary?.summary ?? task.diffSummary?.error
        this.deliver.deliver({
          type: notificationTypeFor(task.status),
          groupId: group.id,
          taskId: task.id,
          status: task.status,
          executorName: this.nameById.get(task.executorParticipantId),
          summary: summarize(summary),
          // 服务端回显的 dispatcher 路由字段:容错读取,缺失时走群级兜底。
          dispatcherSessionId: dispatcherField(task.dispatcherSessionId),
          dispatcherParticipantId: dispatcherField(task.dispatcherParticipantId),
          time,
        })
      }
    }))
  }
}
