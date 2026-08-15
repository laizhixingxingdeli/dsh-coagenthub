import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildWsUrl, CoAgentHubWsClient, type WsEventFrame } from '../src/ws-client.ts'

/** Minimal fake WebSocket capturing listeners so tests can drive it. */
class FakeWebSocket {
  static instances: FakeWebSocket[] = []
  url: string
  listeners = new Map<string, Array<(event: Record<string, unknown>) => void>>()
  closeCount = 0

  constructor(url: string) {
    this.url = url
    FakeWebSocket.instances.push(this)
  }

  addEventListener(type: string, handler: (event: Record<string, unknown>) => void): void {
    const list = this.listeners.get(type) ?? []
    list.push(handler)
    this.listeners.set(type, list)
  }

  removeEventListener(_type: string, _handler: unknown): void {}

  emit(type: string, event: Record<string, unknown> = {}): void {
    for (const handler of this.listeners.get(type) ?? []) handler(event)
  }

  open(): void {
    this.emit('open', {})
  }

  message(data: string): void {
    this.emit('message', { data })
  }

  close(): void {
    this.closeCount += 1
    this.emit('close', {})
  }
}

afterEach(() => {
  FakeWebSocket.instances = []
  vi.useRealTimers()
})

describe('buildWsUrl', () => {
  it('converts http to ws and appends /ws with the participant id', () => {
    expect(buildWsUrl('http://localhost:3001/api', 'p1')).toBe('ws://localhost:3001/api/ws?participantId=p1')
  })

  it('converts https to wss', () => {
    expect(buildWsUrl('https://hub.example.com/api', 'p1')).toBe('wss://hub.example.com/api/ws?participantId=p1')
  })

  it('omits the participant query when the id is absent', () => {
    expect(buildWsUrl('http://localhost:3001/api', undefined)).toBe('ws://localhost:3001/api/ws')
    expect(buildWsUrl('http://localhost:3001/api/', '')).toBe('ws://localhost:3001/api/ws')
  })
})

describe('CoAgentHubWsClient', () => {
  function makeClient(overrides: Partial<{ onEvent: (f: WsEventFrame) => void; getParticipantId: () => string | undefined }> = {}) {
    const onEvent = overrides.onEvent ?? vi.fn()
    const getParticipantId = overrides.getParticipantId ?? (() => 'p1')
    const ws = new CoAgentHubWsClient({
      baseURL: 'http://localhost:3001/api',
      getParticipantId,
      onEvent,
      wsImpl: FakeWebSocket as unknown as typeof WebSocket,
      backoff: { initialMs: 100, maxMs: 400 },
    })
    return { ws, onEvent, getParticipantId }
  }

  it('connects to the derived ws url and forwards parsed frames', () => {
    const { ws, onEvent } = makeClient()
    ws.start()
    expect(FakeWebSocket.instances).toHaveLength(1)
    expect(FakeWebSocket.instances[0]!.url).toBe('ws://localhost:3001/api/ws?participantId=p1')

    FakeWebSocket.instances[0]!.open()
    FakeWebSocket.instances[0]!.message(JSON.stringify({ type: 'task_stall_alert', groupId: 'g1', taskId: 't1' }))
    FakeWebSocket.instances[0]!.message('not-json')
    expect(onEvent).toHaveBeenCalledTimes(1)
    expect(onEvent).toHaveBeenCalledWith({ type: 'task_stall_alert', groupId: 'g1', taskId: 't1' })
    ws.stop()
  })

  it('reconnects with exponential backoff after an unexpected close', () => {
    vi.useFakeTimers()
    const { ws } = makeClient()
    ws.start()
    FakeWebSocket.instances[0]!.open()

    FakeWebSocket.instances[0]!.close() // 断线
    expect(ws.currentStatus).toBe('reconnecting')

    vi.advanceTimersByTime(100) // 首次退避 100ms → 重连
    expect(FakeWebSocket.instances).toHaveLength(2)
    FakeWebSocket.instances[1]!.open() // 成功连接 → 退避重置回 initial

    FakeWebSocket.instances[1]!.close() // 再断
    vi.advanceTimersByTime(99) // 未到 100ms(重置后)
    expect(FakeWebSocket.instances).toHaveLength(2)
    vi.advanceTimersByTime(1)
    expect(FakeWebSocket.instances).toHaveLength(3)
    ws.stop()
  })

  it('doubles the backoff after consecutive failures without an open', () => {
    vi.useFakeTimers()
    const { ws } = makeClient()
    ws.start()
    // 未 open 直接 close:退避翻倍 100 → 200。
    FakeWebSocket.instances[0]!.close()
    vi.advanceTimersByTime(99)
    expect(FakeWebSocket.instances).toHaveLength(1)
    vi.advanceTimersByTime(1)
    expect(FakeWebSocket.instances).toHaveLength(2)
    FakeWebSocket.instances[1]!.close()
    vi.advanceTimersByTime(199) // 翻倍后 200ms
    expect(FakeWebSocket.instances).toHaveLength(2)
    vi.advanceTimersByTime(1)
    expect(FakeWebSocket.instances).toHaveLength(3)
    ws.stop()
  })

  it('caps the backoff at the maximum', () => {
    vi.useFakeTimers()
    const { ws } = makeClient()
    ws.start()
    // 连续断线 5 次,退避应封顶在 maxMs(400)。
    for (let i = 0; i < 5; i += 1) {
      FakeWebSocket.instances[i]!.open()
      FakeWebSocket.instances[i]!.close()
      vi.advanceTimersByTime(1000)
    }
    expect(FakeWebSocket.instances).toHaveLength(6)
    // 恢复后立即连上,退避重置回 initial。
    FakeWebSocket.instances[5]!.open()
    FakeWebSocket.instances[5]!.close()
    vi.advanceTimersByTime(100)
    expect(FakeWebSocket.instances).toHaveLength(7)
    ws.stop()
  })

  it('does not reconnect after stop()', () => {
    vi.useFakeTimers()
    const { ws } = makeClient()
    ws.start()
    FakeWebSocket.instances[0]!.open()
    ws.stop()
    FakeWebSocket.instances[0]!.close()
    vi.advanceTimersByTime(5000)
    expect(FakeWebSocket.instances).toHaveLength(1)
    expect(ws.currentStatus).toBe('closed')
  })

  it('refreshIdentity reconnects when the participant id changed', () => {
    vi.useFakeTimers()
    let id: string | undefined = 'p1'
    const { ws } = makeClient({ getParticipantId: () => id })
    ws.start()
    FakeWebSocket.instances[0]!.open()

    id = 'p2'
    ws.refreshIdentity()
    expect(FakeWebSocket.instances[0]!.closeCount).toBe(1)
    vi.advanceTimersByTime(100)
    expect(FakeWebSocket.instances).toHaveLength(2)
    expect(FakeWebSocket.instances[1]!.url).toBe('ws://localhost:3001/api/ws?participantId=p2')
    ws.stop()
  })

  it('refreshIdentity is a no-op when the identity is unchanged', () => {
    const { ws } = makeClient()
    ws.start()
    FakeWebSocket.instances[0]!.open()
    ws.refreshIdentity()
    expect(FakeWebSocket.instances[0]!.closeCount).toBe(0)
    ws.stop()
  })
})
