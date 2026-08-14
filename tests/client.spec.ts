import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  CoAgentHubClient,
  CoAgentHubError,
  CoAgentHubFetchError,
  DEFAULT_API_BASE,
  REQUEST_TIMEOUT_MS,
} from '../src/client.ts'

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
})
