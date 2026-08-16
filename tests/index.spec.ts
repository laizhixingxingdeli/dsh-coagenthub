import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context, type LoggerService } from '@deepseek-ai/cordis'
import { apply, inject, name, resolveGroupIdForCwd } from '../src/index.ts'

/** Fake WebSocket: never connects, so no real network or reconnect timers. */
class FakeWebSocket {
  addEventListener(): void {}
  removeEventListener(): void {}
  close(): void {}
}

/** Minimal tools service: register returns a no-op disposer. */
function toolsStub() {
  return { register: () => () => {} }
}

/** Collect structured log messages via a cordis logger exporter. */
function captureLogs(ctx: Context) {
  const messages: Array<{ name: string; type: string; args: unknown[] }> = []
  ;(ctx.logger as unknown as LoggerService).exporter({
    // cordis 4 默认 exporter 级别是 INFO,会过滤 warn;调到 WARN(2) 以便断言降级日志。
    levels: { default: 2 },
    export: (message) => messages.push({ name: message.name, type: message.type, args: message.args }),
  })
  return messages
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('plugin startup', () => {
  it('loads without an agents service (queue fallback, no "without inject" crash)', async () => {
    vi.stubGlobal('WebSocket', FakeWebSocket)
    const ctx = new Context()
    ctx.provide('tools', toolsStub())
    // 不提供 agents 服务:修复前 buildPushAdapter 直接读 ctx.agents 会抛
    // `cannot get property "agents" without inject`,插件启动失败、dsh web 重启阻断。
    const logs = captureLogs(ctx)

    const fiber = ctx.plugin({ name, inject, apply }, { apiBase: 'http://127.0.0.1:9/api' })
    await expect(fiber).resolves.toBeDefined() // 加载完成且不抛错
    await fiber.dispose()

    // 主动推送不可用,明确降级为队列(由 coagenthub_get_notifications 补读)。
    const warn = logs.find(log => log.type === 'warn' && String(log.args[0]).includes('未暴露 ctx.agents 注册表'))
    expect(warn).toBeTruthy()
  })

  it('dynamically injects agents and enables followup push when the registry is available', async () => {
    vi.stubGlobal('WebSocket', FakeWebSocket)
    const ctx = new Context()
    ctx.provide('tools', toolsStub())
    ctx.provide('agents', { roots: () => [{ id: 'agent-1' }], list: () => [] })
    const logs = captureLogs(ctx)

    const fiber = ctx.plugin({ name, inject, apply }, { apiBase: 'http://127.0.0.1:9/api' })
    await expect(fiber).resolves.toBeDefined()

    // 动态注入(ctx.inject)是异步回调:等待 agents 服务接线后切到 followup 推送。
    await vi.waitFor(() => {
      expect(logs.some(log => log.type === 'info' && String(log.args[0]).includes('支持主动唤醒'))).toBe(true)
    })
    await fiber.dispose()

    // agents 可用时不应出现降级 warn。
    const warn = logs.find(log => log.type === 'warn' && String(log.args[0]).includes('未暴露 ctx.agents 注册表'))
    expect(warn).toBeUndefined()
  })

  it('falls back to queue delivery when the agents service is removed after wiring', async () => {
    vi.stubGlobal('WebSocket', FakeWebSocket)
    const ctx = new Context()
    ctx.provide('tools', toolsStub())
    const disposeAgents = ctx.provide('agents', { roots: () => [{ id: 'agent-1' }], list: () => [] })
    const logs = captureLogs(ctx)

    const fiber = ctx.plugin({ name, inject, apply }, { apiBase: 'http://127.0.0.1:9/api' })
    await expect(fiber).resolves.toBeDefined()
    await vi.waitFor(() => {
      expect(logs.some(log => log.type === 'info' && String(log.args[0]).includes('支持主动唤醒'))).toBe(true)
    })

    // agents 服务下线:注入 fiber 卸载,通知回退队列(插件保持存活、不丢通知)。
    await disposeAgents()
    await vi.waitFor(() => {
      expect(logs.some(log => log.type === 'warn' && String(log.args[0]).includes('agents 服务已下线'))).toBe(true)
    })
    await fiber.dispose()
  })
})

describe('resolveGroupIdForCwd', () => {
  const groups = [
    { id: 'g1', title: '项目A', projectPath: '/Users/apple/Desktop/Projects/dsh-coagenthub' },
    { id: 'g2', title: '项目B', projectPath: '/Users/apple/Desktop/Projects/other-repo' },
  ]

  it('resolves the group whose projectPath matches the session cwd', () => {
    expect(resolveGroupIdForCwd('/Users/apple/Desktop/Projects/dsh-coagenthub', groups, undefined)).toBe('g1')
  })

  it('prefers the stored activeGroupId over the cwd-matched group', () => {
    const settings = { activeGroupId: 'g1' }
    expect(resolveGroupIdForCwd('/Users/apple/Desktop/Projects/other-repo', groups, settings)).toBe('g1')
  })

  it('resolves the stored activeGroupId even when the session has no usable cwd', () => {
    const settings = { activeGroupId: 'g2' }
    expect(resolveGroupIdForCwd(undefined, groups, settings)).toBe('g2')
    expect(resolveGroupIdForCwd(null, groups, settings)).toBe('g2')
    expect(resolveGroupIdForCwd('   ', groups, settings)).toBe('g2')
  })

  it('falls back to the active group setting when cwd matches no group', () => {
    const settings = { activeGroupId: 'g2' }
    expect(resolveGroupIdForCwd('/Users/apple/Desktop/Projects/unmapped', groups, settings)).toBe('g2')
  })

  it('falls back to the cwd-matched group when the stored activeGroupId no longer exists', () => {
    const settings = { activeGroupId: 'ghost' }
    expect(resolveGroupIdForCwd('/Users/apple/Desktop/Projects/dsh-coagenthub', groups, settings)).toBe('g1')
  })

  it('returns null when cwd matches no group and no active group is set', () => {
    expect(resolveGroupIdForCwd('/Users/apple/Desktop/Projects/unmapped', groups, undefined)).toBeNull()
  })

  it('returns null when the activeGroupId is set but missing from groups and cwd is unusable', () => {
    const settings = { activeGroupId: 'ghost' }
    expect(resolveGroupIdForCwd(undefined, groups, settings)).toBeNull()
  })

  it('returns null when the session has no usable cwd', () => {
    expect(resolveGroupIdForCwd(undefined, groups, undefined)).toBeNull()
    expect(resolveGroupIdForCwd(null, groups, undefined)).toBeNull()
    expect(resolveGroupIdForCwd('   ', groups, undefined)).toBeNull()
  })
})
