import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { notificationQueue, type CoAgentHubNotification } from '../src/notification-queue.ts'
import {
  DshAgentPushAdapter,
  NullPushAdapter,
  createNotificationDeliverer,
  formatNotification,
} from '../src/notify.ts'

/** Minimal dsh Agent stub exposing just the followup surface the adapter uses. */
function agentStub(id = 'agent-1') {
  return {
    id,
    followup: vi.fn(),
  }
}

/** Cast a stub to the dsh Agent type at the adapter boundary. */
function asAgent(agent: { id: string; followup: ReturnType<typeof vi.fn> }): Agent {
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
  it('queues a plugin-sourced user message via followup on the resolved agent', async () => {
    const agent = agentStub('agent-1')
    const adapter = new DshAgentPushAdapter({ resolveAgent: () => asAgent(agent) })
    const notification = makeNotification()

    await adapter.push(notification)

    expect(agent.followup).toHaveBeenCalledTimes(1)
    const message = agent.followup.mock.calls[0]![0] as { role: string; content: Array<{ type: string; text: string }>; source: { kind: string; plugin: string } }
    expect(message.role).toBe('user')
    expect(message.content[0]).toMatchObject({ type: 'text', text: formatNotification(notification) })
    // 插件来源:无需伪造会话存储里的 id/source。
    expect(message.source).toMatchObject({ kind: 'plugin', plugin: 'coagenthub' })
  })

  it('rejects when no live agent can be resolved', async () => {
    const adapter = new DshAgentPushAdapter({ resolveAgent: () => undefined })
    await expect(adapter.push(makeNotification())).rejects.toThrow('no live dsh agent to followup')
  })

  it('pushes a notification when its group matches the resolved session group', async () => {
    const agent = agentStub('agent-1')
    const adapter = new DshAgentPushAdapter({
      resolveAgent: () => asAgent(agent),
      resolveSessionGroupId: () => 'g1',
    })

    await adapter.push(makeNotification({ groupId: 'g1' }))

    expect(agent.followup).toHaveBeenCalledTimes(1)
    expect(notificationQueue.size).toBe(0)
  })

  it('enqueues a notification from another group without pushing it', async () => {
    const agent = agentStub('agent-1')
    const adapter = new DshAgentPushAdapter({
      resolveAgent: () => asAgent(agent),
      resolveSessionGroupId: () => 'g1',
    })

    await adapter.push(makeNotification({ groupId: 'g2' }))

    expect(agent.followup).not.toHaveBeenCalled()
    expect(notificationQueue.size).toBe(1)
    expect(notificationQueue.drain()[0]).toMatchObject({ groupId: 'g2' })
  })

  it('enqueues everything when the session cwd cannot be resolved (no group id)', async () => {
    const agent = agentStub('agent-1')
    const adapter = new DshAgentPushAdapter({
      resolveAgent: () => asAgent(agent),
      resolveSessionGroupId: () => null,
    })

    await adapter.push(makeNotification())

    expect(agent.followup).not.toHaveBeenCalled()
    expect(notificationQueue.size).toBe(1)
    expect(notificationQueue.drain()[0]).toMatchObject({ taskId: 't1' })
  })

  it('enqueues everything when the session-group resolver throws', async () => {
    const agent = agentStub('agent-1')
    const adapter = new DshAgentPushAdapter({
      resolveAgent: () => asAgent(agent),
      resolveSessionGroupId: () => {
        throw new Error('listGroups failed')
      },
    })

    await adapter.push(makeNotification())

    expect(agent.followup).not.toHaveBeenCalled()
    expect(notificationQueue.size).toBe(1)
    expect(notificationQueue.drain()[0]).toMatchObject({ taskId: 't1' })
  })

  it('routes by dispatcherSessionId to the matching live agent without enqueueing', async () => {
    const dispatcher = agentStub('agent-dispatcher')
    const root = agentStub('agent-root')
    const adapter = new DshAgentPushAdapter({
      resolveAgent: () => asAgent(root),
      resolveAgentBySessionId: sessionId => (sessionId === 'session-x' ? asAgent(dispatcher) : undefined),
    })

    await adapter.push(makeNotification({ dispatcherSessionId: 'session-x' }))

    // 定向命中:推送到下发会话,root agent 不参与,队列为空(推送成功不入队)。
    expect(dispatcher.followup).toHaveBeenCalledTimes(1)
    expect(root.followup).not.toHaveBeenCalled()
    expect(notificationQueue.size).toBe(0)
    const message = dispatcher.followup.mock.calls[0]![0] as { content: Array<{ text: string }> }
    expect(message.content[0]!.text).toContain('任务完成')
  })

  it('dispatcher-session routing bypasses session-group filtering', async () => {
    const dispatcher = agentStub('agent-dispatcher')
    const adapter = new DshAgentPushAdapter({
      resolveAgent: () => undefined,
      resolveSessionGroupId: () => 'other-group', // 群级过滤会说"不属于本会话"
      resolveAgentBySessionId: () => asAgent(dispatcher),
    })

    await adapter.push(makeNotification({ groupId: 'g1', dispatcherSessionId: 'session-x' }))

    // dispatcherSessionId 是权威目标:即使群级过滤不匹配也直接推送,不入队。
    expect(dispatcher.followup).toHaveBeenCalledTimes(1)
    expect(notificationQueue.size).toBe(0)
  })

  it('falls back to participant+group routing when dispatcherSessionId cannot be resolved', async () => {
    const byParticipant = agentStub('agent-by-participant')
    const adapter = new DshAgentPushAdapter({
      resolveAgent: () => undefined,
      resolveAgentBySessionId: () => undefined, // dispatcherSessionId 找不到
      resolveAgentByParticipantId: (participantId, groupId) =>
        participantId === 'p1' && groupId === 'g1' ? asAgent(byParticipant) : undefined,
    })

    await adapter.push(makeNotification({ dispatcherSessionId: 'session-x', dispatcherParticipantId: 'p1' }))

    expect(byParticipant.followup).toHaveBeenCalledTimes(1)
    expect(notificationQueue.size).toBe(0)
  })

  it('awaits an async participant resolver before falling back', async () => {
    const byParticipant = agentStub('agent-async')
    const adapter = new DshAgentPushAdapter({
      resolveAgent: () => undefined,
      resolveAgentBySessionId: () => undefined,
      resolveAgentByParticipantId: async (participantId, groupId) => {
        if (participantId === 'p1' && groupId === 'g1') return asAgent(byParticipant)
        return undefined
      },
    })

    await adapter.push(makeNotification({ dispatcherSessionId: 's1', dispatcherParticipantId: 'p1' }))

    expect(byParticipant.followup).toHaveBeenCalledTimes(1)
    expect(notificationQueue.size).toBe(0)
  })

  it('treats a rejecting participant resolver as not-found and falls back to the group path', async () => {
    const root = agentStub('agent-root')
    const adapter = new DshAgentPushAdapter({
      resolveAgent: () => asAgent(root),
      resolveAgentBySessionId: () => undefined,
      resolveAgentByParticipantId: () => Promise.reject(new Error('registry down')),
    })

    // participant 解析抛错视为找不到:回退群级路径(root 命中 → 推送成功)。
    await adapter.push(makeNotification({ dispatcherSessionId: 's1', dispatcherParticipantId: 'p1' }))

    expect(root.followup).toHaveBeenCalledTimes(1)
    expect(notificationQueue.size).toBe(0)
  })

  it('enqueues when dispatcher routes miss and the group fallback has no live agent', async () => {
    const deliverer = createNotificationDeliverer(new DshAgentPushAdapter({
      resolveAgent: () => undefined, // 群级 fallback 也无 live agent
      resolveAgentBySessionId: () => undefined,
      resolveAgentByParticipantId: () => undefined,
    }))

    deliverer.deliver(makeNotification({ dispatcherSessionId: 's1', dispatcherParticipantId: 'p1' }))

    // 三层路由全部落空:push 抛错 → deliverer 入队,由 get_notifications 补读。
    await vi.waitFor(() => expect(notificationQueue.size).toBe(1))
    expect(notificationQueue.drain()[0]).toMatchObject({ dispatcherSessionId: 's1', dispatcherParticipantId: 'p1' })
  })

  it('deliverer does not enqueue when a dispatcher-session push succeeds', async () => {
    const dispatcher = agentStub('agent-dispatcher')
    const deliverer = createNotificationDeliverer(new DshAgentPushAdapter({
      resolveAgent: () => undefined,
      resolveAgentBySessionId: sessionId => (sessionId === 'session-x' ? asAgent(dispatcher) : undefined),
    }))

    deliverer.deliver(makeNotification({ dispatcherSessionId: 'session-x' }))

    expect(dispatcher.followup).toHaveBeenCalledTimes(1)
    expect(notificationQueue.size).toBe(0)
  })

  it('treats an empty dispatcherSessionId as absent (group-level routing applies)', async () => {
    const root = agentStub('agent-root')
    const resolveBySession = vi.fn()
    const adapter = new DshAgentPushAdapter({
      resolveAgent: () => asAgent(root),
      resolveAgentBySessionId: resolveBySession,
    })

    await adapter.push(makeNotification({ dispatcherSessionId: '  ' }))

    // 空白 dispatcherSessionId 视为无:不进入定向路由,走群级路径推送。
    expect(resolveBySession).not.toHaveBeenCalled()
    expect(root.followup).toHaveBeenCalledTimes(1)
    expect(notificationQueue.size).toBe(0)
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
  it('pushes via followup when dsh wake-up is wired, leaving the queue empty', () => {
    const agent = agentStub('agent-1')
    const deliverer = createNotificationDeliverer(new DshAgentPushAdapter({ resolveAgent: () => asAgent(agent) }))

    deliverer.deliver(makeNotification())

    expect(agent.followup).toHaveBeenCalledTimes(1)
    expect(notificationQueue.size).toBe(0)
  })

  it('falls back to the queue when no live agent can be resolved', async () => {
    const deliverer = createNotificationDeliverer(new DshAgentPushAdapter({ resolveAgent: () => undefined }))

    deliverer.deliver(makeNotification())

    // 无 live agent 时不丢通知:入队,agent 可用 get_notifications 补读。
    await vi.waitFor(() => expect(notificationQueue.size).toBe(1))
    expect(notificationQueue.drain()[0]).toMatchObject({ taskId: 't1' })
  })

  it('falls back to the queue when there is no dsh wake-up service (NullPushAdapter)', () => {
    const deliverer = createNotificationDeliverer(new NullPushAdapter({ reason: 'runtime 不支持 followup' }))

    deliverer.deliver(makeNotification())

    expect(notificationQueue.size).toBe(1)
  })

  it('falls back to the queue when followup throws', async () => {
    const agent = agentStub('agent-1')
    agent.followup.mockImplementation(() => {
      throw new Error('followup failed')
    })
    const deliverer = createNotificationDeliverer(new DshAgentPushAdapter({ resolveAgent: () => asAgent(agent) }))

    deliverer.deliver(makeNotification())

    // 推送失败不丢通知:入队,agent 可用 get_notifications 补读。
    await vi.waitFor(() => expect(notificationQueue.size).toBe(1))
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

  it('switches to followup push at runtime via setPushAdapter', () => {
    // 起步为队列回退;agents 服务出现后运行时切换到 DshAgentPushAdapter。
    const deliverer = createNotificationDeliverer()
    deliverer.deliver(makeNotification())
    expect(notificationQueue.size).toBe(1)

    const agent = agentStub('agent-1')
    deliverer.setPushAdapter(new DshAgentPushAdapter({ resolveAgent: () => asAgent(agent) }))
    deliverer.deliver(makeNotification({ taskId: 't2' }))

    // 切换后走 followup,不再入队。
    expect(agent.followup).toHaveBeenCalledTimes(1)
    expect(notificationQueue.size).toBe(1)
  })

  it('falls back to the queue when the runtime-switched adapter throws', async () => {
    const agent = agentStub('agent-1')
    agent.followup.mockImplementation(() => {
      throw new Error('followup failed')
    })
    const deliverer = createNotificationDeliverer()
    deliverer.setPushAdapter(new DshAgentPushAdapter({ resolveAgent: () => asAgent(agent) }))

    deliverer.deliver(makeNotification())

    // 切换后的适配器抛错:不丢通知,回落队列补读。
    await vi.waitFor(() => expect(notificationQueue.size).toBe(1))
    expect(notificationQueue.drain()[0]).toMatchObject({ taskId: 't1' })
  })

  it('switches back to queue-only mode via setPushAdapter(undefined)', () => {
    const agent = agentStub('agent-1')
    const deliverer = createNotificationDeliverer(new DshAgentPushAdapter({ resolveAgent: () => asAgent(agent) }))
    deliverer.deliver(makeNotification())
    expect(agent.followup).toHaveBeenCalledTimes(1)

    deliverer.setPushAdapter(undefined)
    deliverer.deliver(makeNotification())

    expect(notificationQueue.size).toBe(1)
  })

  it('accepts a bare push function via setPushAdapter (legacy call shape)', () => {
    const pushed: CoAgentHubNotification[] = []
    const deliverer = createNotificationDeliverer()
    deliverer.setPushAdapter((notification) => {
      pushed.push(notification)
    })

    deliverer.deliver(makeNotification())

    expect(pushed).toHaveLength(1)
    expect(notificationQueue.size).toBe(0)
  })
})
