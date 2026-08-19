import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CoAgentHubClient } from '../src/client.ts'
import {
  CompletionConsumer,
  notificationFromEvent,
  notificationTypeForCompletionStatus,
} from '../src/completion-consumer.ts'
import { DedupeStore } from '../src/dedupe-store.ts'
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

/** Typed fake inbox event used across consumer tests (envelope + delivery state). */
interface FakeInboxEvent {
  schemaVersion: 1
  type: 'coagenthub.task.completed'
  eventId: string
  dispatcherParticipantId: string | null
  dispatcherSessionId: string | null
  callbackRef: Record<string, unknown> | null
  task: {
    groupId: string
    taskId: string
    status: string
    specRef: string | null
    specHash: string | null
    diffSummary: { summary?: string; error?: string } | null
    outputTail: unknown
  }
  state: string
  attempts: number
  nextAttemptAt: string | null
}

function fakeEvent(id: string, status = 'done'): FakeInboxEvent {
  return {
    schemaVersion: 1,
    type: 'coagenthub.task.completed',
    eventId: id,
    dispatcherParticipantId: null,
    dispatcherSessionId: null,
    callbackRef: null,
    task: { groupId: 'g1', taskId: `task-${id}`, status, specRef: null, specHash: null, diffSummary: { summary: 's' }, outputTail: null },
    state: 'pending',
    attempts: 0,
    nextAttemptAt: null,
  }
}

/** Completion-consumer stub: the watcher only drives `consume()`. */
function consumerStub() {
  const consumed = vi.fn<() => Promise<number>>().mockResolvedValue(0)
  return { consumed, consumer: { consume: consumed } as unknown as CompletionConsumer }
}

function makeWatcher(overrides: Partial<{
  ws: CoAgentHubWsClient
  consumeIntervalMs: number
}> = {}) {
  const delivered: CoAgentHubNotification[] = []
  const deliverer = createNotificationDeliverer((notification) => {
    delivered.push(notification)
  })
  const ws = overrides.ws ?? wsStub()
  const { consumed, consumer } = consumerStub()
  const watcher = new TaskWatcher({
    client: clientStub(),
    ws,
    deliver: deliverer,
    consumer,
    consumeIntervalMs: overrides.consumeIntervalMs ?? 4_000,
  })
  return { watcher, ws, consumer, consumed, delivered }
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
  it('triggers an immediate inbox consume on task_completion_available frames', () => {
    const { watcher, consumed } = makeWatcher()
    watcher.handleFrame({ type: 'task_completion_available', groupId: 'g1' })
    expect(consumed).toHaveBeenCalledTimes(1)
  })

  it('does not deliver a notification for task_completion_available (durable inbox is authoritative)', () => {
    const { watcher, delivered } = makeWatcher()
    watcher.handleFrame({ type: 'task_completion_available', groupId: 'g1' })
    expect(delivered).toHaveLength(0)
  })

  it('delivers a task.stalled notification for task_stall_alert frames', () => {
    const { watcher, delivered } = makeWatcher()
    watcher.handleFrame({ type: 'task_stall_alert', groupId: 'g1', taskId: 't1', executorName: 'AtomCode 执行器' })
    expect(delivered).toHaveLength(1)
    expect(delivered[0]).toMatchObject({ type: 'task.stalled', groupId: 'g1', taskId: 't1', status: 'stalled' })
    expect(delivered[0]!.executorName).toBe('AtomCode 执行器')
    expect(delivered[0]!.summary).toBeUndefined()
  })

  it('passes dispatcher fields from task_stall_alert into the notification', () => {
    const { watcher, delivered } = makeWatcher()
    watcher.handleFrame({ type: 'task_stall_alert', groupId: 'g1', taskId: 't1', dispatcherSessionId: 's', dispatcherParticipantId: 'p' })
    expect(delivered).toHaveLength(1)
    expect(delivered[0]).toMatchObject({ type: 'task.stalled', dispatcherSessionId: 's', dispatcherParticipantId: 'p' })
  })

  it('tolerates missing/null/empty dispatcher fields on stall frames (treated as absent)', () => {
    const { watcher, delivered } = makeWatcher()
    watcher.handleFrame({ type: 'task_stall_alert', groupId: 'g1', taskId: 't1' })
    watcher.handleFrame({ type: 'task_stall_alert', groupId: 'g1', taskId: 't2', dispatcherSessionId: null, dispatcherParticipantId: '  ' })
    expect(delivered).toHaveLength(2)
    for (const notification of delivered) {
      expect(notification.dispatcherSessionId).toBeUndefined()
      expect(notification.dispatcherParticipantId).toBeUndefined()
    }
  })

  it('ignores legacy frame types (task_status_changed / task_output / group_message): completion is inbox-authoritative', () => {
    const { watcher, delivered, consumed } = makeWatcher()
    watcher.handleFrame({ type: 'task_status_changed', groupId: 'g1', taskId: 't1', status: 'done' })
    watcher.handleFrame({ type: 'task_output', groupId: 'g1', taskId: 't1', status: 'done' })
    watcher.handleFrame({ type: 'group_message', groupId: 'g1' })
    expect(delivered).toHaveLength(0)
    expect(consumed).not.toHaveBeenCalled()
  })

  it('ignores frames without a groupId', () => {
    const { watcher, delivered } = makeWatcher()
    watcher.handleFrame({ type: 'task_stall_alert', taskId: 't1' })
    watcher.handleFrame({ type: 'task_completion_available' })
    watcher.handleFrame({ type: 'group_message' })
    expect(delivered).toHaveLength(0)
  })

  it('ignores task_stall_alert frames without a taskId', () => {
    const { watcher, delivered } = makeWatcher()
    watcher.handleFrame({ type: 'task_stall_alert', groupId: 'g1' })
    expect(delivered).toHaveLength(0)
  })
})

describe('notificationTypeForCompletionStatus', () => {
  it('maps completion statuses to notification types (cancelled is a terminal failure)', () => {
    expect(notificationTypeForCompletionStatus('done')).toBe('task.completed')
    expect(notificationTypeForCompletionStatus('failed')).toBe('task.failed')
    expect(notificationTypeForCompletionStatus('cancelled')).toBe('task.failed')
    expect(notificationTypeForCompletionStatus('stalled')).toBe('task.stalled')
    expect(notificationTypeForCompletionStatus(null)).toBe('task.status_changed')
  })
})

describe('notificationFromEvent', () => {
  it('builds a routable notification and carries eventId/dispatcher fields', () => {
    const n = notificationFromEvent({
      schemaVersion: 1,
      type: 'coagenthub.task.completed',
      eventId: 'evt-1',
      dispatcherParticipantId: 'p1',
      dispatcherSessionId: 'session-x',
      callbackRef: null,
      task: {
        groupId: 'g1',
        taskId: 't1',
        status: 'done',
        specRef: null,
        specHash: null,
        diffSummary: { summary: '完成' },
        outputTail: null,
      },
    })
    expect(n).toMatchObject({
      type: 'task.completed',
      groupId: 'g1',
      taskId: 't1',
      status: 'done',
      summary: '完成',
      dispatcherSessionId: 'session-x',
      dispatcherParticipantId: 'p1',
      eventId: 'evt-1',
    })
    expect(typeof n.time).toBe('string')
  })

  it('falls back to diffSummary.error and tolerates missing fields', () => {
    const n = notificationFromEvent({
      schemaVersion: 1,
      type: 'coagenthub.task.completed',
      eventId: 'evt-2',
      dispatcherParticipantId: null,
      dispatcherSessionId: null,
      callbackRef: null,
      task: { groupId: 'g1', taskId: 't2', status: 'failed', specRef: null, specHash: null, diffSummary: { error: 'boom' }, outputTail: null },
    })
    expect(n).toMatchObject({ type: 'task.failed', summary: 'boom' })
    expect(n.dispatcherSessionId).toBeUndefined()
    expect(n.dispatcherParticipantId).toBeUndefined()
    expect(n.eventId).toBe('evt-2')
  })
})

describe('CompletionConsumer.consume', () => {
  function makeConsumer({
    client = {},
    deliverer,
  }: {
    client?: Partial<CoAgentHubClient>
    deliverer: ReturnType<typeof createNotificationDeliverer>
  }) {
    const merge: Partial<CoAgentHubClient> = {
      listCompletionEvents: vi.fn().mockResolvedValue({ events: [] }),
      claimCompletionEvent: vi.fn().mockRejectedValue(new Error('not claimable')),
      ackCompletionEvent: vi.fn().mockResolvedValue({ success: true, eventId: '' }),
      failCompletionEvent: vi.fn().mockResolvedValue({ success: true, eventId: '', attempts: 1, state: 'failed', nextAttemptAt: null }),
      ...client,
    }
    const consumer = new CompletionConsumer({
      client: merge as unknown as CoAgentHubClient,
      consumerId: 'consumer-test',
      participantId: 'me',
      deliverer,
      dedupe: new DedupeStore(100, null),
      leaseMs: 30_000,
      retryAfterMs: 60_000,
    })
    return { consumer, merge }
  }

  it('claims, delivers, records dedupe, and acks each listed event', async () => {
    const delivered: CoAgentHubNotification[] = []
    const deliverer = createNotificationDeliverer((n) => delivered.push(n))
    const listed: FakeInboxEvent[] = [fakeEvent('evt-1'), fakeEvent('evt-2', 'failed')]
    const { consumer, merge } = makeConsumer({
      deliverer,
      client: {
        listCompletionEvents: vi.fn().mockResolvedValue({ events: listed }),
        claimCompletionEvent: vi.fn().mockImplementation(async (_p, eventId) => {
          const hit = listed.find((e) => e.eventId === eventId)!
          return { leaseToken: `lease-${eventId}`, event: { ...hit, state: 'claimed', attempts: 1, nextAttemptAt: null } }
        }),
      },
    })
    const acked = await consumer.consume()
    expect(acked).toBe(2)
    expect(merge.claimCompletionEvent).toHaveBeenCalledTimes(2)
    expect(merge.ackCompletionEvent).toHaveBeenCalledTimes(2)
    expect(delivered.map(n => n.eventId)).toEqual(['evt-1', 'evt-2'])
    expect(delivered[0]).toMatchObject({ type: 'task.completed', taskId: 'task-evt-1' })
    expect(delivered[1]).toMatchObject({ type: 'task.failed', taskId: 'task-evt-2' })
  })

  it('records the eventId in the dedupe store after a successful followup but before ack', async () => {
    const delivered: CoAgentHubNotification[] = []
    const deliverer = createNotificationDeliverer((n) => delivered.push(n))
    const dedupe = new DedupeStore(100, null)
    const { merge } = makeConsumer({
      deliverer,
      client: {
        listCompletionEvents: vi.fn().mockResolvedValue({ events: [{ ...fakeEvent('evt-1'), state: 'pending' }] }),
        claimCompletionEvent: vi.fn().mockResolvedValue({ leaseToken: 'lease', event: { ...fakeEvent('evt-1'), state: 'claimed', attempts: 1, nextAttemptAt: null } }),
        ackCompletionEvent: vi.fn().mockRejectedValue(new Error('ack transient')),
      },
    })
    const consumer = new CompletionConsumer({
      client: merge as unknown as CoAgentHubClient,
      consumerId: 'consumer-test',
      participantId: 'me',
      deliverer,
      dedupe,
      leaseMs: 30_000,
      retryAfterMs: 60_000,
    })
    expect(await consumer.consume()).toBe(0) // ack failed → not counted as acked
    expect(delivered).toHaveLength(1) // followup ran once
    expect(dedupe.has('evt-1')).toBe(true) // recorded before the failed ack
  })

  it('does not followup again for an already-deduped event; only retries the ack', async () => {
    const delivered: CoAgentHubNotification[] = []
    const deliverer = createNotificationDeliverer((n) => delivered.push(n))
    const dedupe = new DedupeStore(100, null)
    dedupe.add('evt-1')
    const { merge } = makeConsumer({
      deliverer,
      client: {
        listCompletionEvents: vi.fn().mockResolvedValue({ events: [{ ...fakeEvent('evt-1'), state: 'pending' }] }),
        claimCompletionEvent: vi.fn().mockResolvedValue({ leaseToken: 'lease', event: { ...fakeEvent('evt-1'), state: 'claimed', attempts: 1, nextAttemptAt: null } }),
        ackCompletionEvent: vi.fn().mockResolvedValue({ success: true, eventId: 'evt-1' }),
      },
    })
    const rebuiltConsumer = new CompletionConsumer({
      client: merge as unknown as CoAgentHubClient,
      consumerId: 'consumer-test',
      participantId: 'me',
      deliverer,
      dedupe,
      leaseMs: 30_000,
      retryAfterMs: 60_000,
    })
    expect(await rebuiltConsumer.consume()).toBe(1)
    expect(delivered).toHaveLength(0) // not followup'd again
    expect(merge.claimCompletionEvent).toHaveBeenCalledTimes(1) // re-claim for fresh lease
    expect(merge.ackCompletionEvent).toHaveBeenCalledTimes(1)
  })

  it('fails the event back (no ack, no dedupe) when the deliverer throws synchronously', async () => {
    const boom = new Error('no agent')
    const deliverer = { deliver: vi.fn(() => { throw boom }) } as unknown as ReturnType<typeof createNotificationDeliverer>
    const { consumer, merge } = makeConsumer({
      deliverer,
      client: {
        listCompletionEvents: vi.fn().mockResolvedValue({ events: [{ ...fakeEvent('evt-1'), state: 'pending' }] }),
        claimCompletionEvent: vi.fn().mockResolvedValue({ leaseToken: 'lease', event: { ...fakeEvent('evt-1'), state: 'claimed', attempts: 1, nextAttemptAt: null } }),
      },
    })
    // re-claim will be rejected since claim is called again? It is called once here.
    // consume() swallows the per-event delivery error and keeps the pass alive.
    expect(await consumer.consume()).toBe(0)
    expect(merge.ackCompletionEvent).not.toHaveBeenCalled()
    expect(merge.failCompletionEvent).toHaveBeenCalledTimes(1)
  })

  it('skips an event (no ack) when the claim fails, keeping the pass alive', async () => {
    const delivered: CoAgentHubNotification[] = []
    const deliverer = createNotificationDeliverer((n) => delivered.push(n))
    const { consumer, merge } = makeConsumer({
      deliverer,
      client: {
        listCompletionEvents: vi.fn().mockResolvedValue({ events: [{ ...fakeEvent('evt-1'), state: 'pending' }, { ...fakeEvent('evt-2'), state: 'pending' }] }),
        claimCompletionEvent: vi.fn().mockImplementation(async (_p, eventId) => {
          if (eventId === 'evt-1') throw new Error('409')
          return { leaseToken: 'lease-2', event: { ...fakeEvent(eventId), state: 'claimed', attempts: 1, nextAttemptAt: null } }
        }),
      },
    })
    expect(await consumer.consume()).toBe(1)
    expect(delivered).toHaveLength(1)
    expect(delivered[0]!.eventId).toBe('evt-2')
    expect(merge.ackCompletionEvent).toHaveBeenCalledTimes(1)
  })

  it('returns 0 and swallows when the inbox API is unavailable (old server / network)', async () => {
    const delivered: CoAgentHubNotification[] = []
    const deliverer = createNotificationDeliverer((n) => delivered.push(n))
    const { consumer, merge } = makeConsumer({
      deliverer,
      client: {
        listCompletionEvents: vi.fn().mockRejectedValue(new Error('boom')),
      },
    })
    void merge
    expect(await consumer.consume()).toBe(0)
    expect(delivered).toHaveLength(0)
  })

  it('passes the batchLimit to the server inbox list call', async () => {
    const delivered: CoAgentHubNotification[] = []
    const deliverer = createNotificationDeliverer((n) => delivered.push(n))
    const { merge } = makeConsumer({ deliverer })
    const events = Array.from({ length: 3 }, (_, i) => fakeEvent(`evt-${i}`))
    const consumer = new CompletionConsumer({
      client: merge as unknown as CoAgentHubClient,
      consumerId: 'consumer-test',
      participantId: 'me',
      deliverer,
      dedupe: new DedupeStore(100, null),
      leaseMs: 30_000,
      retryAfterMs: 60_000,
      batchLimit: 3,
    })
    merge.listCompletionEvents = vi.fn().mockResolvedValue({ events })
    merge.claimCompletionEvent = vi.fn().mockImplementation(async (_p, eventId) => ({ leaseToken: 'lease', event: { ...fakeEvent(eventId), state: 'claimed', attempts: 1, nextAttemptAt: null } }))
    expect(await consumer.consume()).toBe(3) // server honors limit; consumer trusts the returned count
    expect(merge.listCompletionEvents).toHaveBeenCalledWith('me', undefined, 3)
    expect(delivered).toHaveLength(3)
  })
})

describe('DedupeStore', () => {
  it('records ids, detects membership, and never duplicates', () => {
    const dedupe = new DedupeStore(100, null)
    expect(dedupe.has('a')).toBe(false)
    dedupe.add('a')
    dedupe.add('a')
    expect(dedupe.has('a')).toBe(true)
    expect(dedupe.size).toBe(1)
  })

  it('evicts the oldest ids past its capacity (bounded FIFO)', () => {
    const dedupe = new DedupeStore(3, null)
    dedupe.add('a')
    dedupe.add('b')
    dedupe.add('c')
    dedupe.add('d')
    expect(dedupe.peek()).toEqual(['b', 'c', 'd'])
    expect(dedupe.has('a')).toBe(false)
  })

  it('persists and reloads from a JSON file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'coagenthub-dedupe-'))
    const file = join(dir, 'dedupe.json')
    try {
      const dedupe = new DedupeStore(1000, file)
      dedupe.add('evt-1')
      dedupe.add('evt-2')
      const reloaded = new DedupeStore(1000, file)
      expect(reloaded.peek()).toEqual(['evt-1', 'evt-2'])
      expect(reloaded.has('evt-2')).toBe(true)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('starts empty on a missing/corrupt file (memory fallback)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'coagenthub-dedupe-'))
    const file = join(dir, 'missing.json')
    try {
      expect(new DedupeStore(100, file).size).toBe(0)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('TaskWatcher.start/stop', () => {
  it('wires the ws handler, connects, consumes once on startup, and consumes on the fallback timer', () => {
    vi.useFakeTimers()
    const { watcher, ws, consumed } = makeWatcher()
    expect(watcher.running).toBe(false)

    watcher.start()
    expect(watcher.running).toBe(true)
    expect(ws.start).toHaveBeenCalledTimes(1)
    expect(typeof ws.onEvent).toBe('function')
    // 启动即消费一次:插件重启期间产生的 event 从 durable inbox 恢复。
    expect(consumed).toHaveBeenCalledTimes(1)

    // WS 提示帧直接触发一次即时消费。
    ws.onEvent?.({ type: 'task_completion_available', groupId: 'g1' })
    expect(consumed).toHaveBeenCalledTimes(2)

    // 兜底定时器:每次 tick 刷新身份并再消费一次。
    vi.advanceTimersByTime(4_000)
    expect(ws.refreshIdentity).toHaveBeenCalledTimes(1)
    expect(consumed).toHaveBeenCalledTimes(3)

    watcher.stop()
    expect(watcher.running).toBe(false)
    expect(ws.stop).toHaveBeenCalledTimes(1)
    const callsAtStop = consumed.mock.calls.length
    vi.advanceTimersByTime(8_000)
    expect(ws.refreshIdentity).toHaveBeenCalledTimes(1) // 停止后不再 tick
    expect(consumed).toHaveBeenCalledTimes(callsAtStop)
  })

  it('start is idempotent while running', () => {
    const { watcher, ws, consumed } = makeWatcher()
    watcher.start()
    watcher.start()
    expect(ws.start).toHaveBeenCalledTimes(1)
    expect(consumed).toHaveBeenCalledTimes(1)
    watcher.stop()
  })
})

describe('notificationQueue', () => {
  beforeEach(() => {
    notificationQueue.drain()
  })

  it('bounds the queue to capacity, dropping the oldest', () => {
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
    notificationQueue.enqueue({ type: 'message.received', groupId: 'g', time: 't' })
    expect(notificationQueue.peek()).toHaveLength(1)
    expect(notificationQueue.size).toBe(1)
  })

  it('drainByGroup removes only the matched group and keeps others in place', () => {
    notificationQueue.enqueue({ type: 'task.completed', groupId: 'g1', taskId: 't1', status: 'done', time: 'a' })
    notificationQueue.enqueue({ type: 'task.completed', groupId: 'g2', taskId: 't2', status: 'done', time: 'b' })
    notificationQueue.enqueue({ type: 'task.failed', groupId: 'g1', taskId: 't3', status: 'failed', time: 'c' })
    const matched = notificationQueue.drainByGroup('g1')
    expect(matched.map(n => n.taskId)).toEqual(['t1', 't3'])
    expect(notificationQueue.peek().map(n => n.taskId)).toEqual(['t2'])
  })
})

/** Placeholder to satisfy the clientStub import pattern used previously. */
function clientStub(): CoAgentHubClient {
  return {} as CoAgentHubClient
}