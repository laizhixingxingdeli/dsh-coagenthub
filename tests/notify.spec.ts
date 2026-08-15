import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { notificationQueue, type CoAgentHubNotification } from '../src/notification-queue.ts'
import {
  DshAgentPushAdapter,
  NullPushAdapter,
  createNotificationDeliverer,
  formatNotification,
} from '../src/notify.ts'

/** Minimal dsh Agent stub exposing just the inject surface the adapter uses. */
function agentStub(id = 'agent-1') {
  return {
    id,
    inject: vi.fn(),
  }
}

/** Cast a stub to the dsh Agent type at the adapter boundary. */
function asAgent(agent: { id: string; inject: ReturnType<typeof vi.fn> }): Agent {
  return agent as unknown as Agent
}

function makeNotification(overrides: Partial<CoAgentHubNotification> = {}): CoAgentHubNotification {
  return {
    type: 'task.completed',
    groupId: 'g1',
    taskId: 't1',
    status: 'done',
    executorName: 'AtomCode 执行器',
    summary: '完成登录页',
    time: '2026-08-15T00:00:00.000Z',
    ...overrides,
  }
}

beforeEach(() => {
  notificationQueue.drain()
})

afterEach(() => {
  notificationQueue.drain()
  vi.restoreAllMocks()
})

describe('DshAgentPushAdapter', () => {
  it('injects a plugin-sourced user message into the resolved agent', () => {
    const agent = agentStub('agent-1')
    const adapter = new DshAgentPushAdapter({ resolveAgent: () => asAgent(agent) })
    const notification = makeNotification()

    adapter.push(notification)

    expect(agent.inject).toHaveBeenCalledTimes(1)
    const message = agent.inject.mock.calls[0]![0] as { role: string; content: Array<{ type: string; text: string }>; source: { kind: string; plugin: string } }
    expect(message.role).toBe('user')
    expect(message.content[0]).toMatchObject({ type: 'text', text: formatNotification(notification) })
    // 插件来源:无需伪造会话存储里的 id/source。
    expect(message.source).toMatchObject({ kind: 'plugin', plugin: 'coagenthub' })
  })

  it('throws when no live agent can be resolved', () => {
    const adapter = new DshAgentPushAdapter({ resolveAgent: () => undefined })
    expect(() => adapter.push(makeNotification())).toThrow('no live dsh agent')
  })
})

describe('NullPushAdapter', () => {
  it('enqueues the notification for coagenthub_get_notifications', () => {
    const adapter = new NullPushAdapter()
    const notification = makeNotification()

    adapter.push(notification)

    expect(notificationQueue.size).toBe(1)
    expect(notificationQueue.drain()[0]).toEqual(notification)
  })
})

describe('createNotificationDeliverer', () => {
  it('pushes via the adapter when dsh injection is wired, leaving the queue empty', () => {
    const agent = agentStub('agent-1')
    const deliverer = createNotificationDeliverer(new DshAgentPushAdapter({ resolveAgent: () => asAgent(agent) }))

    deliverer.deliver(makeNotification())

    expect(agent.inject).toHaveBeenCalledTimes(1)
    expect(notificationQueue.size).toBe(0)
  })

  it('falls back to the queue when there is no dsh injection service (NullPushAdapter)', () => {
    const deliverer = createNotificationDeliverer(new NullPushAdapter({ reason: 'runtime 不支持注入' }))

    deliverer.deliver(makeNotification())

    expect(notificationQueue.size).toBe(1)
  })

  it('falls back to the queue when the active push throws', () => {
    const agent = agentStub('agent-1')
    agent.inject.mockImplementation(() => {
      throw new Error('inject failed')
    })
    const deliverer = createNotificationDeliverer(new DshAgentPushAdapter({ resolveAgent: () => asAgent(agent) }))

    deliverer.deliver(makeNotification())

    // 推送失败不丢通知:入队,agent 可用 get_notifications 补读。
    expect(notificationQueue.size).toBe(1)
    expect(notificationQueue.drain()[0]).toMatchObject({ taskId: 't1' })
  })

  it('falls back to the queue when the active push rejects asynchronously', async () => {
    const deliverer = createNotificationDeliverer((notification) => Promise.reject(new Error('async push failed')) as never)

    deliverer.deliver(makeNotification())
    await vi.waitFor(() => expect(notificationQueue.size).toBe(1))
  })

  it('enqueues directly when no adapter is provided (queue-only mode)', () => {
    const deliverer = createNotificationDeliverer()

    deliverer.deliver(makeNotification())

    expect(notificationQueue.size).toBe(1)
  })

  it('drain returns and clears pending notifications', () => {
    const deliverer = createNotificationDeliverer(new NullPushAdapter())
    deliverer.deliver(makeNotification({ type: 'task.failed' }))
    deliverer.deliver(makeNotification({ type: 'task.stalled' }))

    const drained = deliverer.drain()

    expect(drained).toHaveLength(2)
    expect(notificationQueue.size).toBe(0)
  })

  it('still accepts the legacy bare push-function call shape', () => {
    const pushed: CoAgentHubNotification[] = []
    const deliverer = createNotificationDeliverer((notification) => {
      pushed.push(notification)
    })

    deliverer.deliver(makeNotification())

    expect(pushed).toHaveLength(1)
    expect(notificationQueue.size).toBe(0)
  })
})
