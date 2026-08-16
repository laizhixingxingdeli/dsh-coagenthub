import { afterEach, describe, expect, it, vi } from 'vitest'
import { CoAgentHubClient } from '../src/client.ts'
import { notificationQueue, type CoAgentHubNotification } from '../src/notification-queue.ts'
import { createNotificationDeliverer, formatNotification } from '../src/notify.ts'
import { TaskWatcher, notificationTypeFor } from '../src/task-watcher.ts'
import type { CoAgentHubWsClient } from '../src/ws-client.ts'

/** Minimal ws stub exposing just what the watcher touches. */
function wsStub() {
  return {
    onEvent: undefined as ((frame: Record<string, unknown>) => void) | undefined,
    start: vi.fn(),
    stop: vi.fn(),
    refreshIdentity: vi.fn(),
  } as unknown as CoAgentHubWsClient
}

function clientStub(overrides: Partial<{
  groups: unknown[]
  tasks: unknown[]
  tasksByGroup: Record<string, unknown[]>
  participants: unknown[]
}> = {}) {
  const groups = overrides.groups ?? [{ id: 'g1' }]
  const client = {
    listGroups: vi.fn().mockResolvedValue({ items: groups, total: groups.length }),
    listTasks: vi.fn().mockImplementation(async (groupId: string) =>
      overrides.tasksByGroup?.[groupId] ?? overrides.tasks ?? []),
    listParticipants: vi.fn().mockResolvedValue(overrides.participants ?? []),
  } as unknown as CoAgentHubClient
  return client
}

function makeWatcher(overrides: Partial<{
  client: CoAgentHubClient
  ws: CoAgentHubWsClient
  pollIntervalMs: number
}> = {}) {
  const delivered: CoAgentHubNotification[] = []
  const deliverer = createNotificationDeliverer((notification) => {
    delivered.push(notification)
  })
  const ws = overrides.ws ?? wsStub()
  const watcher = new TaskWatcher({
    client: overrides.client ?? clientStub(),
    ws,
    deliver: deliverer,
    pollIntervalMs: overrides.pollIntervalMs ?? 4_000,
  })
  return { watcher, ws, delivered }
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('notificationTypeFor', () => {
  it('maps terminal statuses to the notification types', () => {
    expect(notificationTypeFor('done')).toBe('task.completed')
    expect(notificationTypeFor('failed')).toBe('task.failed')
    expect(notificationTypeFor('stalled')).toBe('task.stalled')
    expect(notificationTypeFor('running')).toBe('task.status_changed')
    expect(notificationTypeFor('queued')).toBe('task.status_changed')
  })
})

describe('formatNotification', () => {
  it('renders a one-line summary with the executor and status', () => {
    const text = formatNotification({
      type: 'task.completed',
      groupId: 'g1',
      taskId: 't1',
      status: 'done',
      executorName: 'AtomCode 执行器',
      summary: '完成登录页',
      time: '2026-08-15T00:00:00.000Z',
    })
    expect(text).toContain('任务完成')
    expect(text).toContain('群 g1')
    expect(text).toContain('任务 t1')
    expect(text).toContain('执行器 AtomCode 执行器')
    expect(text).toContain('完成登录页')
  })

  it('caps a long summary', () => {
    const text = formatNotification({
      type: 'task.failed',
      groupId: 'g1',
      taskId: 't1',
      status: 'failed',
      summary: 'x'.repeat(500),
      time: 't',
    })
    expect(text.length).toBeLessThan(300)
    expect(text.endsWith('…')).toBe(true)
  })
})

describe('TaskWatcher.handleFrame', () => {
  it('does not deliver a notification for group_message frames', () => {
    const { watcher, delivered } = makeWatcher()
    watcher.handleFrame({ type: 'group_message', groupId: 'g1' })
    expect(delivered).toHaveLength(0)
  })

  it('delivers a task.stalled notification for task_stall_alert frames', () => {
    const { watcher, delivered } = makeWatcher()
    watcher.handleFrame({ type: 'task_stall_alert', groupId: 'g1', taskId: 't1', executorName: 'AtomCode 执行器' })
    expect(delivered).toHaveLength(1)
    expect(delivered[0]).toMatchObject({ type: 'task.stalled', groupId: 'g1', taskId: 't1', status: 'stalled' })
    expect(delivered[0]!.executorName).toBe('AtomCode 执行器')
  })

  it('delivers only terminal statuses on task_status_changed frames', () => {
    const { watcher, delivered } = makeWatcher()
    watcher.handleFrame({ type: 'task_status_changed', groupId: 'g1', taskId: 't1', status: 'done', summary: '完成' })
    watcher.handleFrame({ type: 'task_status_changed', groupId: 'g1', taskId: 't2', status: 'failed' })
    watcher.handleFrame({ type: 'task_status_changed', groupId: 'g1', taskId: 't3', status: 'stalled' })
    watcher.handleFrame({ type: 'task_status_changed', groupId: 'g1', taskId: 't4', status: 'running' })
    expect(delivered.map(notification => notification.type)).toEqual([
      'task.completed',
      'task.failed',
      'task.stalled',
    ])
    expect(delivered[0]!.summary).toBe('完成')
  })

  it('ignores task_output frames without a terminal status (streaming noise)', () => {
    const { watcher, delivered } = makeWatcher()
    watcher.handleFrame({ type: 'task_output', groupId: 'g1', taskId: 't1', status: 'running' })
    watcher.handleFrame({ type: 'task_output', groupId: 'g1', taskId: 't1', output: 'progress…' })
    expect(delivered).toHaveLength(0)
    watcher.handleFrame({ type: 'task_output', groupId: 'g1', taskId: 't1', status: 'done' })
    expect(delivered).toHaveLength(1)
    expect(delivered[0]!.type).toBe('task.completed')
  })

  it('ignores frames without a groupId', () => {
    const { watcher, delivered } = makeWatcher()
    watcher.handleFrame({ type: 'group_message' })
    watcher.handleFrame({ type: 'task_stall_alert', taskId: 't1' })
    expect(delivered).toHaveLength(0)
  })

  it('delivers terminal frames from every group (isolation happens at drain time)', () => {
    const { watcher, delivered } = makeWatcher()
    watcher.handleFrame({ type: 'task_status_changed', groupId: 'g2', taskId: 't1', status: 'done' })
    watcher.handleFrame({ type: 'task_stall_alert', groupId: 'g2', taskId: 't2', status: 'stalled' })
    expect(delivered).toHaveLength(2)
    expect(delivered.map(notification => notification.groupId)).toEqual(['g2', 'g2'])
    watcher.handleFrame({ type: 'task_status_changed', groupId: 'g1', taskId: 't3', status: 'done' })
    expect(delivered).toHaveLength(3)
    expect(delivered[2]!.groupId).toBe('g1')
  })

  it('ignores frames without a groupId (cannot attribute)', () => {
    const { watcher, delivered } = makeWatcher()
    watcher.handleFrame({ type: 'task_status_changed', taskId: 't1', status: 'done' })
    watcher.handleFrame({ type: 'task_stall_alert', taskId: 't2', status: 'stalled' })
    expect(delivered).toHaveLength(0)
  })

  it('skips queued/running status on task_status_changed frames but delivers done', () => {
    const { watcher, delivered } = makeWatcher()
    watcher.handleFrame({ type: 'task_status_changed', groupId: 'g1', taskId: 't1', status: 'queued' })
    watcher.handleFrame({ type: 'task_status_changed', groupId: 'g1', taskId: 't2', status: 'running' })
    expect(delivered).toHaveLength(0)
    watcher.handleFrame({ type: 'task_status_changed', groupId: 'g1', taskId: 't3', status: 'done' })
    expect(delivered.map(notification => notification.type)).toEqual(['task.completed'])
  })

  it('skips queued status on task_output frames', () => {
    const { watcher, delivered } = makeWatcher()
    watcher.handleFrame({ type: 'task_output', groupId: 'g1', taskId: 't1', status: 'queued', output: '排队中…' })
    expect(delivered).toHaveLength(0)
  })
})

describe('TaskWatcher.pollOnce', () => {
  it('records a baseline on first poll and notifies only on terminal transitions', async () => {
    const tasks: Array<Record<string, unknown>> = [
      { id: 't1', groupId: 'g1', status: 'queued', executorParticipantId: 'e1', brief: 'b', diffSummary: null, createdAt: 'c', updatedAt: 'u' },
    ]
    const client = clientStub({ tasks, participants: [{ id: 'e1', name: 'AtomCode 执行器' }] })
    const { watcher, delivered } = makeWatcher({ client })

    await watcher.pollOnce() // 基线:不通知
    expect(delivered).toHaveLength(0)

    tasks[0] = { ...tasks[0]!, status: 'running' }
    await watcher.pollOnce() // 中间态:只更新基线,不通知
    expect(delivered).toHaveLength(0)

    tasks[0] = { ...tasks[0]!, status: 'done', diffSummary: { summary: '完成', hash: 'h', error: null } }
    await watcher.pollOnce()
    expect(delivered).toHaveLength(1)
    expect(delivered[0]).toMatchObject({ type: 'task.completed', groupId: 'g1', taskId: 't1', status: 'done' })
    expect(delivered[0]!.summary).toBe('完成')

    // 状态不变:不再通知
    await watcher.pollOnce()
    expect(delivered).toHaveLength(1)
  })

  it('does nothing when there are no groups', async () => {
    const client = clientStub({ groups: [] })
    const { watcher, delivered } = makeWatcher({ client })
    await watcher.pollOnce()
    expect(client.listTasks).not.toHaveBeenCalled()
    expect(delivered).toHaveLength(0)
  })

  it('polls every group and notifies per group with the right groupId', async () => {
    const tasksByGroup: Record<string, Array<Record<string, unknown>>> = {
      g1: [{ id: 't1', groupId: 'g1', status: 'queued', executorParticipantId: 'e1', brief: 'b', diffSummary: null, createdAt: 'c', updatedAt: 'u' }],
      g2: [{ id: 't2', groupId: 'g2', status: 'running', executorParticipantId: 'e1', brief: 'b', diffSummary: null, createdAt: 'c', updatedAt: 'u' }],
    }
    const client = clientStub({
      groups: [{ id: 'g1' }, { id: 'g2' }],
      tasksByGroup,
      participants: [{ id: 'e1', name: 'AtomCode 执行器' }],
    })
    const { watcher, delivered } = makeWatcher({ client })

    await watcher.pollOnce() // 基线:两个群各一个任务,不通知
    expect(delivered).toHaveLength(0)
    expect(client.listTasks).toHaveBeenCalledTimes(2)

    tasksByGroup.g1![0] = { ...tasksByGroup.g1![0]!, status: 'done', diffSummary: { summary: '完成', hash: 'h', error: null } }
    tasksByGroup.g2![0] = { ...tasksByGroup.g2![0]!, status: 'failed', diffSummary: { summary: '报错', hash: null, error: 'x' } }
    await watcher.pollOnce()
    expect(delivered).toHaveLength(2)
    expect(delivered[0]).toMatchObject({ type: 'task.completed', groupId: 'g1', taskId: 't1', status: 'done' })
    expect(delivered[1]).toMatchObject({ type: 'task.failed', groupId: 'g2', taskId: 't2', status: 'failed' })
  })

  it('keeps per-group baselines independent (same task id in two groups)', async () => {
    const tasksByGroup: Record<string, Array<Record<string, unknown>>> = {
      g1: [{ id: 't1', groupId: 'g1', status: 'running', executorParticipantId: 'e1', brief: 'b', diffSummary: null, createdAt: 'c', updatedAt: 'u' }],
      g2: [{ id: 't1', groupId: 'g2', status: 'running', executorParticipantId: 'e1', brief: 'b', diffSummary: null, createdAt: 'c', updatedAt: 'u' }],
    }
    const client = clientStub({
      groups: [{ id: 'g1' }, { id: 'g2' }],
      tasksByGroup,
      participants: [{ id: 'e1', name: 'AtomCode 执行器' }],
    })
    const { watcher, delivered } = makeWatcher({ client })

    await watcher.pollOnce() // 基线
    tasksByGroup.g2![0] = { ...tasksByGroup.g2![0]!, status: 'done', diffSummary: { summary: 's', hash: 'h', error: null } }
    await watcher.pollOnce()
    expect(delivered).toHaveLength(1)
    expect(delivered[0]).toMatchObject({ type: 'task.completed', groupId: 'g2', taskId: 't1' })
  })

  it('swallows client failures silently', async () => {
    const client = {
      listGroups: vi.fn().mockRejectedValue(new Error('boom')),
      listTasks: vi.fn(),
      listParticipants: vi.fn(),
    } as unknown as CoAgentHubClient
    const { watcher, delivered } = makeWatcher({ client })
    await expect(watcher.pollOnce()).resolves.toBeUndefined()
    expect(delivered).toHaveLength(0)
  })

  it('isolates a failing group without dropping other groups', async () => {
    const listTasks = vi.fn().mockImplementation(async (groupId: string) => {
      if (groupId === 'g1') throw new Error('boom')
      return [{ id: 't2', groupId: 'g2', status: 'running', executorParticipantId: 'e1', brief: 'b', diffSummary: null, createdAt: 'c', updatedAt: 'u' }]
    })
    const client = {
      listGroups: vi.fn().mockResolvedValue({ items: [{ id: 'g1' }, { id: 'g2' }], total: 2 }),
      listTasks,
      listParticipants: vi.fn().mockResolvedValue([]),
    } as unknown as CoAgentHubClient
    const { watcher, delivered } = makeWatcher({ client })

    await watcher.pollOnce() // 基线:g1 失败, g2 记录基线
    expect(delivered).toHaveLength(0)

    listTasks.mockImplementation(async (groupId: string) => {
      if (groupId === 'g1') throw new Error('boom')
      return [{ id: 't2', groupId: 'g2', status: 'done', executorParticipantId: 'e1', brief: 'b', diffSummary: { summary: 's', hash: 'h', error: null }, createdAt: 'c', updatedAt: 'u' }]
    })
    await watcher.pollOnce()
    expect(delivered).toHaveLength(1)
    expect(delivered[0]).toMatchObject({ type: 'task.completed', groupId: 'g2', taskId: 't2' })
  })

  it('does not notify on intermediate status changes (running/queued) but notifies on terminal ones', async () => {
    const tasks: Array<Record<string, unknown>> = [
      { id: 't1', groupId: 'g1', status: 'running', executorParticipantId: 'e1', brief: 'b', diffSummary: null, createdAt: 'c', updatedAt: 'u' },
    ]
    const client = clientStub({ tasks, participants: [{ id: 'e1', name: 'AtomCode 执行器' }] })
    const { watcher, delivered } = makeWatcher({ client })

    await watcher.pollOnce() // 基线:running,不通知
    expect(delivered).toHaveLength(0)

    tasks[0] = { ...tasks[0]!, status: 'queued' }
    await watcher.pollOnce() // running→queued:不通知
    expect(delivered).toHaveLength(0)

    tasks[0] = { ...tasks[0]!, status: 'running' }
    await watcher.pollOnce() // queued→running:不通知
    expect(delivered).toHaveLength(0)

    tasks[0] = { ...tasks[0]!, status: 'failed' }
    await watcher.pollOnce() // running→failed:终态,通知
    expect(delivered).toHaveLength(1)
    expect(delivered[0]).toMatchObject({ type: 'task.failed', groupId: 'g1', taskId: 't1', status: 'failed' })
  })

  it('notifies on stalled transitions', async () => {
    const tasks: Array<Record<string, unknown>> = [
      { id: 't1', groupId: 'g1', status: 'running', executorParticipantId: 'e1', brief: 'b', diffSummary: null, createdAt: 'c', updatedAt: 'u' },
    ]
    const client = clientStub({ tasks, participants: [{ id: 'e1', name: 'AtomCode 执行器' }] })
    const { watcher, delivered } = makeWatcher({ client })

    await watcher.pollOnce() // 基线:running,不通知
    expect(delivered).toHaveLength(0)

    tasks[0] = { ...tasks[0]!, status: 'stalled' }
    await watcher.pollOnce() // running→stalled:终态,通知
    expect(delivered).toHaveLength(1)
    expect(delivered[0]).toMatchObject({ type: 'task.stalled', groupId: 'g1', taskId: 't1', status: 'stalled' })
  })
})

describe('TaskWatcher.start/stop', () => {
  it('wires the ws frame handler, starts the socket, and polls on an interval', () => {
    vi.useFakeTimers()
    const { watcher, ws, delivered } = makeWatcher()
    expect(watcher.running).toBe(false)

    watcher.start()
    expect(watcher.running).toBe(true)
    expect(ws.start).toHaveBeenCalledTimes(1)
    expect(typeof ws.onEvent).toBe('function')

    // WS 帧直接走 handleFrame
    ws.onEvent?.({ type: 'task_stall_alert', groupId: 'g1', taskId: 't1' })
    expect(delivered).toHaveLength(1)
    expect(delivered[0]!.type).toBe('task.stalled')

    // 轮询 tick 刷新身份并 poll 一次(无任务,不通知)
    vi.advanceTimersByTime(4_000)
    expect(ws.refreshIdentity).toHaveBeenCalledTimes(1)

    watcher.stop()
    expect(watcher.running).toBe(false)
    expect(ws.stop).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(8_000)
    expect(ws.refreshIdentity).toHaveBeenCalledTimes(1) // 停止后不再 tick
  })

  it('start is idempotent while running', () => {
    const { watcher, ws } = makeWatcher()
    watcher.start()
    watcher.start()
    expect(ws.start).toHaveBeenCalledTimes(1)
    watcher.stop()
  })
})

describe('notificationQueue', () => {
  it('bounds the queue to capacity, dropping the oldest', () => {
    notificationQueue.drain()
    for (let i = 0; i < 205; i += 1) {
      notificationQueue.enqueue({ type: 'task.status_changed', groupId: 'g', taskId: `t${i}`, status: 'running', time: String(i) })
    }
    expect(notificationQueue.size).toBe(200)
    const drained = notificationQueue.drain()
    expect(drained[0]!.taskId).toBe('t5')
    expect(drained[drained.length - 1]!.taskId).toBe('t204')
    expect(notificationQueue.size).toBe(0)
  })

  it('peek reads without clearing', () => {
    notificationQueue.drain()
    notificationQueue.enqueue({ type: 'message.received', groupId: 'g', time: 't' })
    expect(notificationQueue.peek()).toHaveLength(1)
    expect(notificationQueue.size).toBe(1)
    notificationQueue.drain()
  })
})
