import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { CoAgentHubSettingsStore, defaultConfigFilePath } from '../src/config.ts'
import {
  apply,
  handleWorkspaceRoute,
  SETTINGS_PATH,
  WORKSPACE_SETUP_PATH,
  WORKSPACE_STATUS_PATH,
  handleSettings,
} from '../src/proxy.ts'
import type { WorkspaceRegistryLike, WorkspaceRouteDeps } from '../src/workspace.ts'

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

  it('drops malformed mappingRule / activeGroupId values instead of throwing', () => {
    const store = new CoAgentHubSettingsStore(null)
    const malformed = { apiBase: 'http://x:1/api' } as unknown as Record<string, unknown>
    store.set({ ...malformed, mappingRule: null } as never)
    store.set({ ...malformed, mappingRule: {} } as never)
    store.set({ ...malformed, mappingRule: { macPrefix: 123, winPrefix: 'Z:\\' } } as never)
    store.set({ ...malformed, activeGroupId: null } as never)
    expect(store.get()).toEqual({ apiBase: 'http://x:1/api' })
  })

  it('persists mappingRule and activeGroupId and reloads them', () => {
    const store = new CoAgentHubSettingsStore(null)
    store.set({ mappingRule: { macPrefix: '/Users/apple/Desktop/Projects/', winPrefix: 'Z:\\' }, activeGroupId: 'g1' })
    expect(store.get()).toEqual({
      mappingRule: { macPrefix: '/Users/apple/Desktop/Projects/', winPrefix: 'Z:\\' },
      activeGroupId: 'g1',
    })
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

  it('PUT passes through sessionActiveGroups and merges per session', async () => {
    const store = new CoAgentHubSettingsStore(null)
    let res = makeRes()
    await handleSettings(
      makeReq('PUT', SETTINGS_PATH, JSON.stringify({ sessionActiveGroups: { 'session-a': 'g1' } })),
      res as unknown as ServerResponse,
      store,
    )
    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body)).toEqual({
      ok: true,
      settings: { sessionActiveGroups: { 'session-a': 'g1' } },
    })

    // 第二次 PUT 只更新 session-b,不影响 session-a。
    res = makeRes()
    await handleSettings(
      makeReq('PUT', SETTINGS_PATH, JSON.stringify({ sessionActiveGroups: { 'session-b': 'g2' } })),
      res as unknown as ServerResponse,
      store,
    )
    expect(JSON.parse(res.body).settings).toEqual({
      sessionActiveGroups: { 'session-a': 'g1', 'session-b': 'g2' },
    })

    // 空串清除该会话项,其他会话保留。
    res = makeRes()
    await handleSettings(
      makeReq('PUT', SETTINGS_PATH, JSON.stringify({ sessionActiveGroups: { 'session-a': '' } })),
      res as unknown as ServerResponse,
      store,
    )
    expect(JSON.parse(res.body).settings).toEqual({ sessionActiveGroups: { 'session-b': 'g2' } })

    res = makeRes()
    await handleSettings(makeReq('GET', SETTINGS_PATH), res as unknown as ServerResponse, store)
    expect(JSON.parse(res.body)).toEqual({ sessionActiveGroups: { 'session-b': 'g2' } })
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

  it('returns the top-level task outputTail when diffSummary has none (post-refactor payload)', async () => {
    const store = new CoAgentHubSettingsStore(null)
    vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string) => {
      if (url.includes('/groups?')) return Promise.resolve(jsonUpstream({ items: [{ id: 'g1' }], total: 1 }))
      if (url.includes('/tasks?includeOutput=1')) {
        return Promise.resolve(jsonUpstream([{
          id: 't43',
          diffSummary: { summary: null, hash: null, error: null, outputTail: null },
          outputTail: 'top1\ntop2',
        }]))
      }
      return Promise.resolve(jsonUpstream([]))
    }))

    const { handler } = captureHandler({}, store)
    const res = makeRes()
    await handler(makeReq('GET', '/coagenthub-api/raw/t43'), res as unknown as ServerResponse)
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toContain('text/plain')
    expect(res.body).toBe('top1\ntop2')
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

function workspaceDeps(overrides: Partial<WorkspaceRouteDeps> = {}): WorkspaceRouteDeps {
  const store = new CoAgentHubSettingsStore(null)
  const registry: WorkspaceRegistryLike = {
    create: vi.fn().mockResolvedValue({ id: 'w1', path: 'Z:\\dsh-coagenthub', title: 'x' }),
    list: vi.fn().mockReturnValue([]),
  }
  return {
    getPlatform: () => 'win32',
    getApiBase: () => 'http://192.168.31.92:3001/api',
    runNetUse: vi.fn().mockResolvedValue('ok'),
    pathExists: async path => path === 'Z:\\dsh-coagenthub',
    getRegistry: () => registry,
    store,
    listGroups: async () => [
      { id: 'g1', title: 'dsh-coagenthub 插件开发', projectPath: '/Users/apple/Desktop/Projects/dsh-coagenthub' },
      { id: 'g2', title: '无目录', projectPath: '/Users/apple/Desktop/Projects/ghost' },
    ],
    ...overrides,
  }
}

describe('workspace endpoints (host)', () => {
  it('POST workspace-setup runs the full flow: rule persisted, mapped + failures', async () => {
    const deps = workspaceDeps()
    const res = makeRes()
    await handleWorkspaceRoute(
      makeReq('POST', WORKSPACE_SETUP_PATH, JSON.stringify({ shareName: 'Projects' })),
      res as unknown as ServerResponse,
      deps,
    )

    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body).toEqual({
      ok: true,
      mappingRule: { macPrefix: '/Users/apple/Desktop/Projects/', winPrefix: 'Z:\\' },
      mapped: [{ groupTitle: 'dsh-coagenthub 插件开发', winPath: 'Z:\\dsh-coagenthub', registered: true }],
      failures: [{ groupTitle: '无目录', winPath: 'Z:\\ghost', reason: '路径不存在或不可访问' }],
    })
    expect(deps.runNetUse).toHaveBeenCalledWith(['use', 'Z:', '\\\\192.168.31.92\\Projects', '/persistent:yes'])
    expect(deps.store.get().mappingRule).toEqual({ macPrefix: '/Users/apple/Desktop/Projects/', winPrefix: 'Z:\\' })
  })

  it('is idempotent through the handler: repeated setup does not re-register', async () => {
    const setTitle = vi.fn().mockResolvedValue(undefined)
    const deps = workspaceDeps({
      getRegistry: () => ({
        create: vi.fn(),
        list: vi.fn().mockReturnValue([{ id: 'w1', path: 'Z:\\dsh-coagenthub', title: '旧标题', setTitle }]),
      }),
    })
    const res = makeRes()
    await handleWorkspaceRoute(
      makeReq('POST', WORKSPACE_SETUP_PATH, JSON.stringify({ shareName: 'Projects' })),
      res as unknown as ServerResponse,
      deps,
    )
    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body).mapped).toHaveLength(1)
    expect(JSON.parse(res.body).failures).toHaveLength(1)
    expect(deps.getRegistry()!.create).not.toHaveBeenCalled()
    expect(setTitle).toHaveBeenCalledWith('dsh-coagenthub 插件开发')
  })

  it('rejects workspace-setup on non-Windows with 400', async () => {
    const deps = workspaceDeps({ getPlatform: () => 'darwin' })
    const res = makeRes()
    await handleWorkspaceRoute(
      makeReq('POST', WORKSPACE_SETUP_PATH, JSON.stringify({ shareName: 'Projects' })),
      res as unknown as ServerResponse,
      deps,
    )
    expect(res.statusCode).toBe(400)
    expect(JSON.parse(res.body)).toMatchObject({ error: expect.stringContaining('仅 Windows') })
  })

  it('rejects a non-POST workspace-setup with 405', async () => {
    const deps = workspaceDeps()
    const res = makeRes()
    await handleWorkspaceRoute(makeReq('GET', WORKSPACE_SETUP_PATH), res as unknown as ServerResponse, deps)
    expect(res.statusCode).toBe(405)
  })

  it('rejects an invalid workspace-setup body with 400', async () => {
    const deps = workspaceDeps()
    const res = makeRes()
    await handleWorkspaceRoute(
      makeReq('POST', WORKSPACE_SETUP_PATH, '{not-json'),
      res as unknown as ServerResponse,
      deps,
    )
    expect(res.statusCode).toBe(400)
    expect(JSON.parse(res.body)).toMatchObject({ error: expect.stringContaining('invalid JSON') })
  })

  it('GET workspace-status reports the rule and per-group state', async () => {
    const store = new CoAgentHubSettingsStore(null)
    store.set({ mappingRule: { macPrefix: '/Users/apple/Desktop/Projects/', winPrefix: 'Z:\\' } })
    const deps = workspaceDeps({
      store,
      getRegistry: () => ({
        create: vi.fn(),
        list: vi.fn().mockReturnValue([{ id: 'w1', path: 'Z:\\dsh-coagenthub', title: 'x' }]),
      }),
    })
    const res = makeRes()
    await handleWorkspaceRoute(makeReq('GET', WORKSPACE_STATUS_PATH), res as unknown as ServerResponse, deps)

    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.mappingRule).toEqual({ macPrefix: '/Users/apple/Desktop/Projects/', winPrefix: 'Z:\\' })
    expect(body.workspaces[0]).toEqual({
      groupId: 'g1',
      groupTitle: 'dsh-coagenthub 插件开发',
      macPath: '/Users/apple/Desktop/Projects/dsh-coagenthub',
      winPath: 'Z:\\dsh-coagenthub',
      pathExists: true,
      registered: true,
    })
    expect(body.workspaces[1]!.registered).toBe(false)
  })

  it('intercepts workspace routes before forwarding upstream', async () => {
    const store = new CoAgentHubSettingsStore(null)
    const upstream = vi.fn()
    vi.stubGlobal('fetch', upstream)

    const { handler } = captureHandler({}, store)
    const res = makeRes()
    await handler(
      makeReq('POST', '/coagenthub-api/workspace-setup', JSON.stringify({ shareName: 'Projects' })),
      res as unknown as ServerResponse,
    )
    expect(res.statusCode).toBe(400)
    expect(JSON.parse(res.body)).toMatchObject({ error: expect.stringContaining('仅 Windows') })
    expect(upstream).not.toHaveBeenCalled()
  })
})
