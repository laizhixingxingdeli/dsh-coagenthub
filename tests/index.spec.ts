import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context, type LoggerService } from '@deepseek-ai/cordis'
import { apply, inject, name } from '../src/index.ts'

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

  it('still uses active push when the agents registry is available', async () => {
    vi.stubGlobal('WebSocket', FakeWebSocket)
    const ctx = new Context()
    ctx.provide('tools', toolsStub())
    ctx.provide('agents', { roots: () => [{ id: 'agent-1' }], list: () => [] })
    const logs = captureLogs(ctx)

    const fiber = ctx.plugin({ name, inject, apply }, { apiBase: 'http://127.0.0.1:9/api' })
    await expect(fiber).resolves.toBeDefined()
    await fiber.dispose()

    const info = logs.find(log => log.type === 'info' && String(log.args[0]).includes('支持主动唤醒'))
    expect(info).toBeTruthy()
  })
})
