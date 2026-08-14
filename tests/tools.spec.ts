import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import { CoAgentHubClient } from '../src/client.ts'
import { CoAgentHubSettingsStore } from '../src/config.ts'
import { createCoAgentHubTools, registerCoAgentHubTools } from '../src/tools.ts'

const EXPECTED_TOOL_NAMES = [
  'coagenthub_list_participants',
  'coagenthub_create_group',
  'coagenthub_post_message',
  'coagenthub_dispatch_task',
  'coagenthub_list_tasks',
  'coagenthub_get_messages',
  'coagenthub_get_active_group',
] as const

function participant(overrides: Partial<{ id: string; name: string; device: string | null; lastSeen: string | null }>) {
  return {
    id: overrides.id ?? 'p-default',
    name: overrides.name ?? '路人',
    device: overrides.device ?? null,
    capabilities: [],
    lastSeen: overrides.lastSeen ?? null,
    createdAt: '2026-08-13T00:00:00.000Z',
  }
}

function clientWith(fetchImpl: (...args: Parameters<typeof fetch>) => Promise<unknown>): CoAgentHubClient {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation(async (...args: Parameters<typeof fetch>) => {
      const body = await fetchImpl(...args)
      if (body instanceof Response) return body
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }),
  )
  return new CoAgentHubClient()
}

function execute(tool: ToolDefinition, args: Record<string, unknown>): Promise<unknown> {
  return tool.execute(args, {} as never)
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('createCoAgentHubTools', () => {
  it('defines exactly the seven expected tools', () => {
    const client = clientWith(() => Promise.resolve([]))
    const tools = createCoAgentHubTools(client)
    expect(tools.map(tool => tool.name)).toEqual(EXPECTED_TOOL_NAMES)
  })

  it('dispatch_task description guides clarifying ambiguous requirements', () => {
    const client = clientWith(() => Promise.resolve([]))
    const tool = createCoAgentHubTools(client).find(t => t.name === 'coagenthub_dispatch_task')!
    expect(tool.description).toContain('若任务需求存在歧义')
    expect(tool.description).toContain('必须先向用户澄清要点,得到确认后再下发任务书')
  })

  it('registers all six tools on a tools runtime', () => {
    const registered: string[] = []
    const fakeCtx = {
      tools: {
        register(definition: ToolDefinition) {
          registered.push(definition.name)
          return () => {}
        },
      },
    } as unknown as Context
    const client = clientWith(() => Promise.resolve([]))
    const dispose = registerCoAgentHubTools(fakeCtx, client)
    expect(registered).toEqual(EXPECTED_TOOL_NAMES)
    dispose()
  })

  it('list_participants maps participants to views with type and online flags', async () => {
    const client = clientWith(() =>
      Promise.resolve([
        participant({ id: 'e1', name: 'AtomCode 执行器', device: 'mac', lastSeen: new Date().toISOString() }),
        participant({ id: 'u1', name: 'Local User', lastSeen: '2026-01-01T00:00:00.000Z' }),
      ]),
    )
    const tool = createCoAgentHubTools(client).find(t => t.name === 'coagenthub_list_participants')!
    const result = await execute(tool, {})
    expect(result).toEqual([
      expect.objectContaining({ id: 'e1', type: 'executor', device: 'mac', online: true }),
      expect.objectContaining({ id: 'u1', type: 'local', online: false }),
    ])
  })

  it('dispatch_task picks the executor whose name contains the requested fragment', async () => {
    const postMessage = vi.fn().mockResolvedValue({ id: 'm1', createdAt: '' })
    const client = clientWith((url: string | URL | Request, init?: RequestInit) => {
      if (String(url).endsWith('/participants')) {
        return Promise.resolve([
          participant({ id: 'e-other', name: 'Reasoning 执行器' }),
          participant({ id: 'e-atom', name: 'AtomCode 执行器' }),
        ])
      }
      return postMessage(url, init)
    })
    const tool = createCoAgentHubTools(client).find(t => t.name === 'coagenthub_dispatch_task')!
    const result = await execute(tool, { groupId: 'g1', body: '请实现 X', executorName: 'AtomCode' })

    expect(result).toEqual({ messageId: 'm1', executorParticipantId: 'e-atom', executorName: 'AtomCode 执行器' })
    const [url, init] = postMessage.mock.calls[0] as [string, RequestInit]
    expect(String(url)).toContain('/groups/g1/messages')
    expect(JSON.parse(String(init.body))).toEqual({
      body: '请实现 X',
      audience: 'participant',
      audienceRef: 'e-atom',
    })
  })

  it('dispatch_task defaults the executor name to AtomCode', async () => {
    const client = clientWith((url: string | URL | Request) => {
      if (String(url).endsWith('/participants')) {
        return Promise.resolve([participant({ id: 'e-atom', name: 'AtomCode 执行器' })])
      }
      return Promise.resolve({ id: 'm1', createdAt: '' })
    })
    const tool = createCoAgentHubTools(client).find(t => t.name === 'coagenthub_dispatch_task')!
    const result = await execute(tool, { groupId: 'g1', body: '任务' })
    expect(result).toEqual({ messageId: 'm1', executorParticipantId: 'e-atom', executorName: 'AtomCode 执行器' })
  })

  it('dispatch_task fails clearly when no executor matches', async () => {
    const client = clientWith(() => Promise.resolve([participant({ id: 'u1', name: 'Local User' })]))
    const tool = createCoAgentHubTools(client).find(t => t.name === 'coagenthub_dispatch_task')!
    await expect(execute(tool, { groupId: 'g1', body: '任务', executorName: 'Nobody' })).rejects.toThrow(
      'no participant named like "Nobody"',
    )
  })

  it('get_messages filters by `after` and sorts newest first', async () => {
    const messages = [
      { id: 'm1', createdAt: '2026-08-14T01:00:00.000Z' },
      { id: 'm2', createdAt: '2026-08-14T03:00:00.000Z' },
      { id: 'm3', createdAt: '2026-08-14T02:00:00.000Z' },
    ]
    const client = clientWith(() => Promise.resolve(messages))
    const tool = createCoAgentHubTools(client).find(t => t.name === 'coagenthub_get_messages')!
    const result = (await execute(tool, { groupId: 'g1', after: '2026-08-14T01:30:00.000Z' })) as Array<{ id: string }>
    expect(result.map(message => message.id)).toEqual(['m2', 'm3'])
  })

  it('list_tasks maps executor names and summarizes the brief', async () => {
    const longBrief = 'x'.repeat(300)
    const client = clientWith((url: string | URL | Request) => {
      if (String(url).includes('/tasks')) {
        return Promise.resolve([
          {
            id: 't1',
            groupId: 'g1',
            status: 'running',
            executorParticipantId: 'e-atom',
            brief: longBrief,
            createdAt: '2026-08-14T00:00:00.000Z',
            updatedAt: '2026-08-14T00:01:00.000Z',
          },
        ])
      }
      return Promise.resolve([participant({ id: 'e-atom', name: 'AtomCode 执行器' })])
    })
    const tool = createCoAgentHubTools(client).find(t => t.name === 'coagenthub_list_tasks')!
    const result = (await execute(tool, { groupId: 'g1' })) as Array<{ executorName: string; summary: string }>
    expect(result).toHaveLength(1)
    const task = result[0]!
    expect(task.executorName).toBe('AtomCode 执行器')
    expect(task.summary.length).toBe(201)
    expect(task.summary.endsWith('…')).toBe(true)
  })

  it('list_tasks requires a groupId', async () => {
    const client = clientWith(() => Promise.resolve([]))
    const tool = createCoAgentHubTools(client).find(t => t.name === 'coagenthub_list_tasks')!
    await expect(execute(tool, {})).rejects.toThrow('groupId is required')
  })

  it('get_active_group returns null when nothing is selected', async () => {
    const client = clientWith(() => Promise.resolve({ items: [], total: 0 }))
    const tool = createCoAgentHubTools(client).find(t => t.name === 'coagenthub_get_active_group')!
    expect(await execute(tool, {})).toBeNull()
  })

  it('get_active_group resolves the stored selection to groupId + title', async () => {
    const store = new CoAgentHubSettingsStore(null)
    store.set({ activeGroupId: 'g1' })
    const client = clientWith(() =>
      Promise.resolve({ items: [{ id: 'g1', title: 'dsh-coagenthub 插件开发', status: 'active' }], total: 1 }),
    )
    const tool = createCoAgentHubTools(client, store).find(t => t.name === 'coagenthub_get_active_group')!
    expect(await execute(tool, {})).toEqual({ groupId: 'g1', groupTitle: 'dsh-coagenthub 插件开发' })
  })

  it('get_active_group returns null when the stored group no longer exists', async () => {
    const store = new CoAgentHubSettingsStore(null)
    store.set({ activeGroupId: 'ghost' })
    const client = clientWith(() => Promise.resolve({ items: [], total: 0 }))
    const tool = createCoAgentHubTools(client, store).find(t => t.name === 'coagenthub_get_active_group')!
    expect(await execute(tool, {})).toBeNull()
  })
})
