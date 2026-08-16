import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  CoAgentHubClient,
  CoAgentHubError,
  CoAgentHubFetchError,
  DEFAULT_API_BASE,
  REQUEST_TIMEOUT_MS,
} from '../src/client.ts'
import { CoAgentHubSettingsStore } from '../src/config.ts'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function initSignalAborted(fetchMock: ReturnType<typeof vi.fn>): boolean {
  const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
  return init.signal?.aborted ?? false
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('CoAgentHubClient', () => {
  it('uses the default base URL and omits X-Participant-Id when unset', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse([]))
    vi.stubGlobal('fetch', fetchMock)

    const client = new CoAgentHubClient()
    await client.listParticipants()

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(`${DEFAULT_API_BASE}/participants`)
    expect(new Headers(init.headers).has('X-Participant-Id')).toBe(false)
  })

  it('sends X-Participant-Id when configured', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse([]))
    vi.stubGlobal('fetch', fetchMock)

    const client = new CoAgentHubClient({ participantId: 'abc-123' })
    await client.listParticipants()

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(new Headers(init.headers).get('X-Participant-Id')).toBe('abc-123')
  })

  it('createGroup POSTs the title and returns the group', async () => {
    const group = { id: 'g1', title: '测试群' }
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(group))
    vi.stubGlobal('fetch', fetchMock)

    const client = new CoAgentHubClient()
    const result = await client.createGroup('测试群')

    expect(result).toEqual(group)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(`${DEFAULT_API_BASE}/groups`)
    expect(init.method).toBe('POST')
    expect(JSON.parse(String(init.body))).toEqual({ title: '测试群' })
  })

  it('throws CoAgentHubError with status and body summary on non-ok response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => Promise.resolve(new Response('oops', { status: 500 }))))

    const client = new CoAgentHubClient()
    const promise = client.createGroup('x')
    await expect(promise).rejects.toBeInstanceOf(CoAgentHubError)
    await expect(promise).rejects.toMatchObject({
      status: 500,
      bodySummary: 'oops',
    })
  })

  it('throws CoAgentHubFetchError on timeout', async () => {
    vi.useFakeTimers()
    try {
      const fetchMock = vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
        })
      })
      vi.stubGlobal('fetch', fetchMock)

      const client = new CoAgentHubClient()
      const promise = client.listParticipants()
      // Mark the rejection as handled up front so the timer flush below
      // cannot surface an unhandled-rejection warning before we assert.
      promise.catch(() => {})
      await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS + 1)
      await expect(promise).rejects.toThrow(CoAgentHubFetchError)
      expect(initSignalAborted(fetchMock)).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })

  it('getParticipantByName finds a participant by exact name', async () => {
    const participants = [
      { id: 'p1', name: '路人甲', device: null, capabilities: [], lastSeen: null, createdAt: '' },
      { id: 'p2', name: 'AtomCode 执行器', device: 'mac', capabilities: [], lastSeen: null, createdAt: '' },
    ]
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => Promise.resolve(jsonResponse(participants))))

    const client = new CoAgentHubClient()
    const found = await client.getParticipantByName('AtomCode 执行器')
    expect(found?.id).toBe('p2')
    expect(await client.getParticipantByName('不存在')).toBeUndefined()
  })

  it('resolves base URL from the COAGENTHUB_API_BASE environment variable', async () => {
    const previous = process.env.COAGENTHUB_API_BASE
    process.env.COAGENTHUB_API_BASE = 'http://example.test/api/'
    try {
      const fetchMock = vi.fn().mockResolvedValue(jsonResponse([]))
      vi.stubGlobal('fetch', fetchMock)
      const client = new CoAgentHubClient()
      await client.listParticipants()
      const [url] = fetchMock.mock.calls[0] as [string]
      expect(url).toBe('http://example.test/api/participants')
    } finally {
      if (previous === undefined) delete process.env.COAGENTHUB_API_BASE
      else process.env.COAGENTHUB_API_BASE = previous
    }
  })

  it('prefers the settings store over config and env (设置 > config > env)', async () => {
    const store = new CoAgentHubSettingsStore(null)
    store.set({ apiBase: 'http://settings.test:3001/api' })
    const previous = process.env.COAGENTHUB_API_BASE
    process.env.COAGENTHUB_API_BASE = 'http://env.test:3001/api'
    try {
      const fetchMock = vi.fn().mockResolvedValue(jsonResponse([]))
      vi.stubGlobal('fetch', fetchMock)
      const client = new CoAgentHubClient({ baseURL: 'http://config.test:3001/api', settingsStore: store })
      await client.listParticipants()
      const [url] = fetchMock.mock.calls[0] as [string]
      expect(url).toBe('http://settings.test:3001/api/participants')
    } finally {
      if (previous === undefined) delete process.env.COAGENTHUB_API_BASE
      else process.env.COAGENTHUB_API_BASE = previous
    }
  })

  it('reads the participant id from the settings store', async () => {
    const store = new CoAgentHubSettingsStore(null)
    store.set({ participantId: 'from-store' })
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse([]))
    vi.stubGlobal('fetch', fetchMock)

    const client = new CoAgentHubClient({ settingsStore: store })
    await client.listParticipants()

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(new Headers(init.headers).get('X-Participant-Id')).toBe('from-store')
  })

  it('listTasks appends includeOutput=1 only when requested', async () => {
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(jsonResponse([])))
    vi.stubGlobal('fetch', fetchMock)

    const client = new CoAgentHubClient()
    await client.listTasks('g1')
    expect(fetchMock.mock.calls[0]![0]).toBe(`${DEFAULT_API_BASE}/groups/g1/tasks`)
    await client.listTasks('g1', true)
    expect(fetchMock.mock.calls[1]![0]).toBe(`${DEFAULT_API_BASE}/groups/g1/tasks?includeOutput=1`)
  })

  it('updateTaskBrief PATCHes the brief to the single-task endpoint', async () => {
    const task = {
      id: 't1',
      groupId: 'g1',
      brief: '新任务书',
      status: 'queued',
      createdAt: '',
      updatedAt: '2026-08-14T01:00:00.000Z',
    }
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(task))
    vi.stubGlobal('fetch', fetchMock)

    const client = new CoAgentHubClient()
    const result = await client.updateTaskBrief('g1', 't1', '新任务书')

    expect(result).toEqual(task)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(`${DEFAULT_API_BASE}/groups/g1/tasks/t1`)
    expect(init.method).toBe('PATCH')
    expect(JSON.parse(String(init.body))).toEqual({ brief: '新任务书' })
  })

  it('postMessage passes metadata through to the request body', async () => {
    const message = {
      id: 'm1',
      groupId: 'g1',
      senderId: 'u1',
      parentId: null,
      audience: 'participant',
      audienceRef: 'e1',
      body: 'b',
      contentType: 'text',
      createdAt: 'c',
      updatedAt: 'u',
    }
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(message))
    vi.stubGlobal('fetch', fetchMock)

    const client = new CoAgentHubClient()
    const result = await client.postMessage('g1', {
      body: 'b',
      metadata: { dispatcherSessionId: 'session-abc' },
    })

    expect(result).toEqual(message)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(String(url)).toBe(`${DEFAULT_API_BASE}/groups/g1/messages`)
    expect(init.method).toBe('POST')
    expect(JSON.parse(String(init.body))).toEqual({
      body: 'b',
      metadata: { dispatcherSessionId: 'session-abc' },
    })
  })

  it('postMessage omits metadata when not provided (server remains compatible)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ id: 'm1' }))
    vi.stubGlobal('fetch', fetchMock)

    const client = new CoAgentHubClient()
    await client.postMessage('g1', { body: 'b' })

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(JSON.parse(String(init.body))).toEqual({ body: 'b' })
  })

  it('updateGroup PATCHes title/projectPath to the group endpoint and returns the group', async () => {
    const group = {
      id: 'g1',
      title: '改名后的群',
      status: 'active',
      createdBy: 'u1',
      createdAt: '',
      updatedAt: '',
      memberCount: 0,
      projectPath: '/mac/path',
    }
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(group))
    vi.stubGlobal('fetch', fetchMock)

    const client = new CoAgentHubClient()
    const result = await client.updateGroup('g1', { title: '改名后的群', projectPath: '/mac/path' })

    expect(result).toEqual(group)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(`${DEFAULT_API_BASE}/groups/g1`)
    expect(init.method).toBe('PATCH')
    expect(JSON.parse(String(init.body))).toEqual({ title: '改名后的群', projectPath: '/mac/path' })
  })

  it('updateGroup passes projectPath null through to clear the binding', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ id: 'g1', title: 'T', status: 'active', projectPath: null }))
    vi.stubGlobal('fetch', fetchMock)

    const client = new CoAgentHubClient()
    await client.updateGroup('g1', { projectPath: null })

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(JSON.parse(String(init.body))).toEqual({ projectPath: null })
  })

  it('addGroupMember POSTs participantId and roles to the members endpoint', async () => {
    const member = {
      participantId: 'e1',
      name: 'AtomCode 执行器',
      device: 'mac',
      roles: ['executor'],
      prompt: '执行任务',
      joinedAt: '2026-08-15T06:00:00.000Z',
    }
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(member))
    vi.stubGlobal('fetch', fetchMock)

    const client = new CoAgentHubClient()
    const result = await client.addGroupMember('g1', { participantId: 'e1', roles: ['executor'] })

    expect(result).toEqual(member)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(`${DEFAULT_API_BASE}/groups/g1/members`)
    expect(init.method).toBe('POST')
    expect(JSON.parse(String(init.body))).toEqual({ participantId: 'e1', roles: ['executor'] })
  })

  it('removeGroupMember DELETEs the member and returns { ok: true } on an empty body (204)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', fetchMock)

    const client = new CoAgentHubClient()
    const result = await client.removeGroupMember('g1', 'e1')

    expect(result).toEqual({ ok: true })
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(`${DEFAULT_API_BASE}/groups/g1/members/e1`)
    expect(init.method).toBe('DELETE')
  })

  it('removeGroupMember passes through a JSON body when the server returns one', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: true }))
    vi.stubGlobal('fetch', fetchMock)

    const client = new CoAgentHubClient()
    await expect(client.removeGroupMember('g1', 'e1')).resolves.toEqual({ ok: true })
  })
})
