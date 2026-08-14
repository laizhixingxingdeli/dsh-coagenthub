import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { CoAgentHubSettingsStore, defaultConfigFilePath } from '../src/config.ts'
import { apply, SETTINGS_PATH, handleSettings } from '../src/proxy.ts'

interface FakeRes {
  statusCode: number
  headers: Record<string, string>
  body: string
  setHeader: (key: string, value: string) => void
  end: (text: string) => void
}

function makeRes(): FakeRes {
  const res = {
    statusCode: 200,
    headers: {} as Record<string, string>,
    body: '',
    setHeader(key: string, value: string) { this.headers[key] = value },
    end(text: string) { this.body = text },
  }
  return res
}

function makeReq(method: string, url: string, body = ''): IncomingMessage {
  return {
    method,
    url,
    on(event: string, cb: (chunk?: unknown) => void) {
      if (event === 'data' && body !== '') cb(Buffer.from(body))
      if (event === 'end') cb()
      return this
    },
  } as unknown as IncomingMessage
}

/** Capture the route handler registered by `apply` against a fake cordis ctx. */
function captureHandler(config: Parameters<typeof apply>[1] = {}, store?: CoAgentHubSettingsStore) {
  let route: { handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void> } | undefined
  const ctx = {
    effect(fn: () => unknown) { return fn() },
    inject(_deps: string[], cb: (webCtx: { webServer: { register: (r: typeof route) => () => void } }) => void) {
      cb({ webServer: { register: (r: typeof route) => { route = r; return () => {} } } })
      return () => {}
    },
  } as unknown as Context
  const dispose = apply(ctx, config, store)
  return { handler: route!.handler, dispose }
}

function jsonUpstream(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('CoAgentHubSettingsStore', () => {
  it('persists settings to disk and reloads them (restart survival)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'coagenthub-'))
    try {
      const file = join(dir, 'coagenthub-config.json')
      const store = new CoAgentHubSettingsStore(file)
      store.set({ apiBase: 'http://192.168.31.92:3001/api', participantId: 'win-1' })
      const reloaded = new CoAgentHubSettingsStore(file)
      expect(reloaded.get()).toEqual({ apiBase: 'http://192.168.31.92:3001/api', participantId: 'win-1' })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('resolves the config file under $DSH_HOME', () => {
    const previous = process.env.DSH_HOME
    process.env.DSH_HOME = '/tmp/dsh-home'
    try {
      expect(defaultConfigFilePath()).toBe(join('/tmp/dsh-home', 'coagenthub-config.json'))
    } finally {
      if (previous === undefined) delete process.env.DSH_HOME
      else process.env.DSH_HOME = previous
    }
  })

  it('clears a field when saved as empty string', () => {
    const store = new CoAgentHubSettingsStore(null)
    store.set({ apiBase: 'http://x:1/api', participantId: 'abc' })
    store.set({ apiBase: '', participantId: '' })
    expect(store.get()).toEqual({})
  })
})

describe('settings endpoints (host)', () => {
  it('GET returns the current settings and PUT saves + GET reflects', async () => {
    const store = new CoAgentHubSettingsStore(null)
    let res = makeRes()
    await handleSettings(makeReq('GET', SETTINGS_PATH), res as unknown as ServerResponse, store)
    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body)).toEqual({})

    res = makeRes()
    await handleSettings(
      makeReq('PUT', SETTINGS_PATH, JSON.stringify({ apiBase: 'http://192.168.31.92:3001/api', participantId: 'p-9' })),
      res as unknown as ServerResponse,
      store,
    )
    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body)).toEqual({
      ok: true,
      settings: { apiBase: 'http://192.168.31.92:3001/api', participantId: 'p-9' },
    })

    res = makeRes()
    await handleSettings(makeReq('GET', SETTINGS_PATH), res as unknown as ServerResponse, store)
    expect(JSON.parse(res.body)).toEqual({ apiBase: 'http://192.168.31.92:3001/api', participantId: 'p-9' })
  })

  it('rejects an invalid JSON body with 400', async () => {
    const store = new CoAgentHubSettingsStore(null)
    const res = makeRes()
    await handleSettings(makeReq('PUT', SETTINGS_PATH, '{not-json'), res as unknown as ServerResponse, store)
    expect(res.statusCode).toBe(400)
    expect(JSON.parse(res.body)).toMatchObject({ error: expect.stringContaining('invalid JSON') })
  })
})

describe('proxy forward target (dynamic settings)', () => {
  it('forwards to the configured base, then to the saved settings base per request', async () => {
    const store = new CoAgentHubSettingsStore(null)
    const upstream = vi.fn().mockResolvedValue(jsonUpstream({ ok: true }))
    vi.stubGlobal('fetch', upstream)

    const { handler } = captureHandler({}, store)
    let res = makeRes()
    await handler(makeReq('GET', '/coagenthub-api/groups?limit=1'), res as unknown as ServerResponse)
    expect(upstream).toHaveBeenLastCalledWith('http://localhost:3001/api/groups?limit=1', expect.anything())

    // 保存新地址 → 下一请求转发到新 base + 携带 participantId
    // (settings 端点现为独立 exact 路由,不走 proxy handler;这里直接调 handleSettings)
    res = makeRes()
    await handleSettings(
      makeReq('PUT', SETTINGS_PATH, JSON.stringify({ apiBase: 'http://192.168.31.92:3001/api', participantId: 'p-9' })),
      res as unknown as ServerResponse,
      store,
    )
    expect(JSON.parse(res.body).ok).toBe(true)

    res = makeRes()
    await handler(makeReq('GET', '/coagenthub-api/groups?limit=1'), res as unknown as ServerResponse)
    expect(upstream).toHaveBeenLastCalledWith(
      'http://192.168.31.92:3001/api/groups?limit=1',
      expect.objectContaining({ headers: expect.objectContaining({ 'x-participant-id': 'p-9' }) }),
    )

    // 改回(模拟实测中的「不可达地址改回」) → 目标随之切换
    res = makeRes()
    await handleSettings(
      makeReq('PUT', SETTINGS_PATH, JSON.stringify({ apiBase: 'http://127.0.0.1:3999/api' })),
      res as unknown as ServerResponse,
      store,
    )
    res = makeRes()
    await handler(makeReq('GET', '/coagenthub-api/participants'), res as unknown as ServerResponse)
    expect(upstream).toHaveBeenLastCalledWith('http://127.0.0.1:3999/api/participants', expect.anything())
  })

  it('plugin config still wins over the default when no settings are saved', async () => {
    const store = new CoAgentHubSettingsStore(null)
    const upstream = vi.fn().mockResolvedValue(jsonUpstream([]))
    vi.stubGlobal('fetch', upstream)

    const { handler } = captureHandler({ apiBase: 'http://config.test:8080/api', participantId: 'from-config' }, store)
    const res = makeRes()
    await handler(makeReq('GET', '/coagenthub-api/participants'), res as unknown as ServerResponse)
    expect(upstream).toHaveBeenLastCalledWith(
      'http://config.test:8080/api/participants',
      expect.objectContaining({ headers: expect.objectContaining({ 'x-participant-id': 'from-config' }) }),
    )
  })
})

describe('raw task output endpoint (host)', () => {
  it('returns the task outputTail as text/plain', async () => {
    const store = new CoAgentHubSettingsStore(null)
    vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string) => {
      if (url.includes('/groups?')) return Promise.resolve(jsonUpstream({ items: [{ id: 'g1' }], total: 1 }))
      if (url.includes('/tasks?includeOutput=1')) {
        return Promise.resolve(jsonUpstream([{
          id: 't42',
          diffSummary: { summary: null, hash: null, error: null, outputTail: 'line1\nline2' },
        }]))
      }
      return Promise.resolve(jsonUpstream([]))
    }))

    const { handler } = captureHandler({}, store)
    const res = makeRes()
    await handler(makeReq('GET', '/coagenthub-api/raw/t42'), res as unknown as ServerResponse)
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toContain('text/plain')
    expect(res.body).toBe('line1\nline2')
  })

  it('404s with a hint when the task is unknown', async () => {
    const store = new CoAgentHubSettingsStore(null)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonUpstream({ items: [], total: 0 })))

    const { handler } = captureHandler({}, store)
    const res = makeRes()
    await handler(makeReq('GET', '/coagenthub-api/raw/ghost'), res as unknown as ServerResponse)
    expect(res.statusCode).toBe(404)
    expect(res.body).toContain('未找到任务')
  })

  it('404s when the task has no buffered output yet', async () => {
    const store = new CoAgentHubSettingsStore(null)
    vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string) => {
      if (url.includes('/groups?')) return Promise.resolve(jsonUpstream({ items: [{ id: 'g1' }], total: 1 }))
      return Promise.resolve(jsonUpstream([{ id: 't1', diffSummary: { outputTail: null } }]))
    }))

    const { handler } = captureHandler({}, store)
    const res = makeRes()
    await handler(makeReq('GET', '/coagenthub-api/raw/t1'), res as unknown as ServerResponse)
    expect(res.statusCode).toBe(404)
    expect(res.body).toContain('暂无完整输出')
  })
})
