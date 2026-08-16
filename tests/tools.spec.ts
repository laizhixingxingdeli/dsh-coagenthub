import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import { CoAgentHubClient } from '../src/client.ts'
import { CoAgentHubSettingsStore } from '../src/config.ts'
import { notificationQueue } from '../src/notification-queue.ts'
import { createCoAgentHubTools, registerCoAgentHubTools } from '../src/tools.ts'

const EXPECTED_TOOL_NAMES = [
  'coagenthub_list_participants',
  'coagenthub_create_group',
  'coagenthub_post_message',
  'coagenthub_dispatch_task',
  'coagenthub_list_tasks',
  'coagenthub_get_messages',
  'coagenthub_get_active_group',
  'coagenthub_get_workspace_instructions',
  'coagenthub_list_groups',
  'coagenthub_get_group',
  'coagenthub_get_group_members',
  'coagenthub_update_group',
  'coagenthub_add_group_member',
  'coagenthub_remove_group_member',
  'coagenthub_list_executors',
  'coagenthub_get_task',
  'coagenthub_update_task',
  'coagenthub_get_notifications',
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

/** Execute with an explicit session cwd (session header);exec 的 cwd 优先于 live-agent 回退解析器。 */
function executeWithCwd(tool: ToolDefinition, args: Record<string, unknown>, cwd: string): Promise<unknown> {
  return tool.execute(args, { agent: { session: { header: { cwd } } } } as never)
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('createCoAgentHubTools', () => {
  it('defines exactly the expected tools', () => {
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

  it('dispatch_task throws a clear error when the server rejects with 403', async () => {
    const postMessage = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: 'forbidden: not a coordinator' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    const client = clientWith((url: string | URL | Request, init?: RequestInit) => {
      if (String(url).endsWith('/participants')) {
        return Promise.resolve([participant({ id: 'e-atom', name: 'AtomCode 执行器' })])
      }
      return postMessage(url, init)
    })
    const tool = createCoAgentHubTools(client).find(t => t.name === 'coagenthub_dispatch_task')!
    await expect(execute(tool, { groupId: 'g1', body: '任务' })).rejects.toThrow(
      '无权限发布任务：需要 coordinator/human 身份',
    )
    expect(postMessage).toHaveBeenCalledTimes(1)
  })

  it('dispatch_task prefers an explicit groupId over the stored activeGroupId', async () => {
    const store = new CoAgentHubSettingsStore(null)
    store.set({ activeGroupId: 'g1' })
    const postMessage = vi.fn().mockResolvedValue({ id: 'm1', createdAt: '' })
    const listGroups = vi.fn().mockResolvedValue({ items: [], total: 0 })
    const client = clientWith((url: string | URL | Request, init?: RequestInit) => {
      if (String(url).endsWith('/participants')) {
        return Promise.resolve([participant({ id: 'e-atom', name: 'AtomCode 执行器' })])
      }
      if (String(url).endsWith('/groups?limit=100')) {
        return listGroups()
      }
      return postMessage(url, init)
    })
    const tool = createCoAgentHubTools(client, store).find(t => t.name === 'coagenthub_dispatch_task')!
    const result = (await execute(tool, { groupId: 'g2', body: '任务' })) as Record<string, unknown>
    expect(result).toEqual({ messageId: 'm1', executorParticipantId: 'e-atom', executorName: 'AtomCode 执行器' })
    const [url] = postMessage.mock.calls[0] as [string, RequestInit]
    expect(String(url)).toContain('/groups/g2/messages')
    expect(listGroups).not.toHaveBeenCalled()
  })

  it('dispatch_task uses the stored activeGroupId when groupId is omitted and it exists in the group list', async () => {
    const store = new CoAgentHubSettingsStore(null)
    store.set({ activeGroupId: 'g1' })
    const postMessage = vi.fn().mockResolvedValue({ id: 'm1', createdAt: '' })
    const listGroups = vi.fn().mockResolvedValue({
      items: [{ id: 'g1', title: '手动保存群', status: 'active' }],
      total: 1,
    })
    const client = clientWith((url: string | URL | Request, init?: RequestInit) => {
      if (String(url).endsWith('/participants')) {
        return Promise.resolve([participant({ id: 'e-atom', name: 'AtomCode 执行器' })])
      }
      if (String(url).endsWith('/groups?limit=100')) {
        return listGroups()
      }
      return postMessage(url, init)
    })
    const tool = createCoAgentHubTools(client, store).find(t => t.name === 'coagenthub_dispatch_task')!
    const result = (await execute(tool, { body: '任务' })) as Record<string, unknown>
    expect(result).toEqual({ messageId: 'm1', executorParticipantId: 'e-atom', executorName: 'AtomCode 执行器' })
    expect(listGroups).toHaveBeenCalledTimes(1)
    const [url] = postMessage.mock.calls[0] as [string, RequestInit]
    expect(String(url)).toContain('/groups/g1/messages')
  })

  it('dispatch_task prefers the stored activeGroupId over the cwd-matched group', async () => {
    const store = new CoAgentHubSettingsStore(null)
    store.set({ activeGroupId: 'g1' })
    const postMessage = vi.fn().mockResolvedValue({ id: 'm1', createdAt: '' })
    const client = clientWith((url: string | URL | Request, init?: RequestInit) => {
      if (String(url).endsWith('/groups?limit=100')) {
        return Promise.resolve({
          items: [
            { id: 'g1', title: '手动保存群', status: 'active' },
            { id: 'g9', title: 'dsh-coagenthub 插件开发', status: 'active', projectPath: '/Users/apple/Desktop/Projects/dsh-coagenthub' },
          ],
          total: 2,
        })
      }
      if (String(url).endsWith('/participants')) {
        return Promise.resolve([participant({ id: 'e-atom', name: 'AtomCode 执行器' })])
      }
      return postMessage(url, init)
    })
    const tool = createCoAgentHubTools(client, store).find(t => t.name === 'coagenthub_dispatch_task')!
    // cwd 命中 g9,但手动保存的 activeGroupId g1 优先生效。
    const result = (await tool.execute({ body: '任务' }, {
      agent: { session: { header: { cwd: '/Users/apple/Desktop/Projects/dsh-coagenthub' } } },
    } as never)) as Record<string, unknown>
    expect(result).toEqual({ messageId: 'm1', executorParticipantId: 'e-atom', executorName: 'AtomCode 执行器' })
    const [url] = postMessage.mock.calls[0] as [string, RequestInit]
    expect(String(url)).toContain('/groups/g1/messages')
  })

  it('dispatch_task falls back to the cwd-matched group when the stored activeGroupId no longer exists', async () => {
    const store = new CoAgentHubSettingsStore(null)
    store.set({ activeGroupId: 'g1' })
    const postMessage = vi.fn().mockResolvedValue({ id: 'm1', createdAt: '' })
    const client = clientWith((url: string | URL | Request, init?: RequestInit) => {
      if (String(url).endsWith('/groups?limit=100')) {
        return Promise.resolve({
          items: [{ id: 'g9', title: 'dsh-coagenthub 插件开发', status: 'active', projectPath: '/Users/apple/Desktop/Projects/dsh-coagenthub' }],
          total: 1,
        })
      }
      if (String(url).endsWith('/participants')) {
        return Promise.resolve([participant({ id: 'e-atom', name: 'AtomCode 执行器' })])
      }
      return postMessage(url, init)
    })
    const tool = createCoAgentHubTools(client, store).find(t => t.name === 'coagenthub_dispatch_task')!
    // 存储的 g1 已不在群列表中(视为未设置),cwd 反查兜底命中 g9。
    const result = (await tool.execute({ body: '任务' }, {
      agent: { session: { header: { cwd: '/Users/apple/Desktop/Projects/dsh-coagenthub' } } },
    } as never)) as Record<string, unknown>
    expect(result).toEqual({ messageId: 'm1', executorParticipantId: 'e-atom', executorName: 'AtomCode 执行器' })
    const [url] = postMessage.mock.calls[0] as [string, RequestInit]
    expect(String(url)).toContain('/groups/g9/messages')
  })

  it('dispatch_task resolves groupId from the workspace cwd when groupId and activeGroupId are absent', async () => {
    const postMessage = vi.fn().mockResolvedValue({ id: 'm1', createdAt: '' })
    const client = clientWith((url: string | URL | Request, init?: RequestInit) => {
      if (String(url).endsWith('/groups?limit=100')) {
        return Promise.resolve({
          items: [{ id: 'g9', title: 'dsh-coagenthub 插件开发', status: 'active', projectPath: '/Users/apple/Desktop/Projects/dsh-coagenthub' }],
          total: 1,
        })
      }
      if (String(url).endsWith('/participants')) {
        return Promise.resolve([participant({ id: 'e-atom', name: 'AtomCode 执行器' })])
      }
      return postMessage(url, init)
    })
    const tool = createCoAgentHubTools(client).find(t => t.name === 'coagenthub_dispatch_task')!
    const result = (await tool.execute({ body: '任务' }, {
      agent: { session: { header: { cwd: '/Users/apple/Desktop/Projects/dsh-coagenthub' } } },
    } as never)) as Record<string, unknown>
    expect(result).toEqual({ messageId: 'm1', executorParticipantId: 'e-atom', executorName: 'AtomCode 执行器' })
    const [url] = postMessage.mock.calls[0] as [string, RequestInit]
    expect(String(url)).toContain('/groups/g9/messages')
  })

  it('dispatch_task throws a clear error when no group can be resolved', async () => {
    const client = clientWith(() =>
      Promise.resolve({
        items: [{ id: 'g9', title: '别的项目', status: 'active', projectPath: '/Users/apple/Desktop/Projects/other' }],
        total: 1,
      }),
    )
    const tool = createCoAgentHubTools(client).find(t => t.name === 'coagenthub_dispatch_task')!
    await expect(tool.execute({ body: '任务' }, {
      agent: { session: { header: { cwd: '/Users/apple/Desktop/Projects/dsh-coagenthub' } } },
    } as never)).rejects.toThrow('未指定 groupId，且无法从当前工作区识别群；请手动传 groupId')
  })

  it('dispatch_task resolves groupId from the live root agent cwd when exec carries no agent', async () => {
    const postMessage = vi.fn().mockResolvedValue({ id: 'm1', createdAt: '' })
    const client = clientWith((url: string | URL | Request, init?: RequestInit) => {
      if (String(url).endsWith('/groups?limit=100')) {
        return Promise.resolve({
          items: [{ id: 'g9', title: 'ReadingHelper', status: 'active', projectPath: '/Users/apple/Desktop/Projects/readinghelper' }],
          total: 1,
        })
      }
      if (String(url).endsWith('/participants')) {
        return Promise.resolve([participant({ id: 'e-atom', name: 'AtomCode 执行器' })])
      }
      return postMessage(url, init)
    })
    const tool = createCoAgentHubTools(client, undefined, () => '/Users/apple/Desktop/Projects/readinghelper')
      .find(t => t.name === 'coagenthub_dispatch_task')!
    // exec 未携带 agent(web 客户端桥接 / SDK 直调):cwd 由 live root agent 解析器回退。
    const result = (await execute(tool, { body: '任务' })) as Record<string, unknown>
    expect(result).toEqual({ messageId: 'm1', executorParticipantId: 'e-atom', executorName: 'AtomCode 执行器' })
    const [url] = postMessage.mock.calls[0] as [string, RequestInit]
    expect(String(url)).toContain('/groups/g9/messages')
  })

  it('dispatch_task does not fall back to process.cwd() when no cwd is resolvable', async () => {
    // 常驻 web 进程里 process.cwd() 是 dsh 启动目录;即便它恰好命中某个群,
    // 拿不到会话 cwd 也必须报错,而非误判到启动目录绑定的群。
    const client = clientWith((url: string | URL | Request) => {
      if (String(url).endsWith('/participants')) {
        return Promise.resolve([participant({ id: 'e-atom', name: 'AtomCode 执行器' })])
      }
      return Promise.resolve({
        items: [{ id: 'g9', title: 'dsh-coagenthub 插件开发', status: 'active', projectPath: process.cwd() }],
        total: 1,
      })
    })
    const tool = createCoAgentHubTools(client).find(t => t.name === 'coagenthub_dispatch_task')!
    await expect(execute(tool, { body: '任务' })).rejects.toThrow('未指定 groupId，且无法从当前工作区识别群；请手动传 groupId')
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

  it('list_tasks tolerates a missing brief (undefined/null) and returns an empty summary', async () => {
    const client = clientWith((url: string | URL | Request) => {
      if (String(url).includes('/tasks')) {
        return Promise.resolve([
          {
            id: 't1',
            groupId: 'g1',
            status: 'running',
            executorParticipantId: 'e-atom',
            brief: undefined,
            createdAt: '2026-08-14T00:00:00.000Z',
            updatedAt: '2026-08-14T00:01:00.000Z',
          },
          {
            id: 't2',
            groupId: 'g1',
            status: 'queued',
            executorParticipantId: 'e-atom',
            brief: null,
            createdAt: '2026-08-14T00:00:00.000Z',
            updatedAt: '2026-08-14T00:01:00.000Z',
          },
        ])
      }
      return Promise.resolve([participant({ id: 'e-atom', name: 'AtomCode 执行器' })])
    })
    const tool = createCoAgentHubTools(client).find(t => t.name === 'coagenthub_list_tasks')!
    const result = (await execute(tool, { groupId: 'g1' })) as Array<{ summary: string }>
    expect(result).toHaveLength(2)
    for (const task of result) {
      expect(task.summary).toBe('')
      expect(Object.values(task).some(value => value === undefined)).toBe(false)
    }
  })

  it('list_tasks uses the stored activeGroupId when groupId is omitted and it exists in the group list', async () => {
    const store = new CoAgentHubSettingsStore(null)
    store.set({ activeGroupId: 'g1' })
    const client = clientWith((url: string | URL | Request) => {
      if (String(url).endsWith('/participants')) {
        return Promise.resolve([participant({ id: 'e1', name: 'AtomCode 执行器' })])
      }
      if (String(url).includes('/tasks')) {
        return Promise.resolve([])
      }
      return Promise.resolve({
        items: [{ id: 'g1', title: '手动保存群', status: 'active' }],
        total: 1,
      })
    })
    const tool = createCoAgentHubTools(client, store).find(t => t.name === 'coagenthub_list_tasks')!
    const result = (await execute(tool, {})) as Array<{ groupId: string }>
    expect(result).toEqual([])
    const calls = (fetch as ReturnType<typeof vi.fn>).mock.calls as Array<[string]>
    const tasksUrl = calls.map(call => String(call[0])).find(url => url.includes('/tasks'))
    expect(tasksUrl).toContain('/groups/g1/tasks')
  })

  it('list_tasks falls back to the cwd-matched group when the stored activeGroupId no longer exists', async () => {
    const store = new CoAgentHubSettingsStore(null)
    store.set({ activeGroupId: 'g1' })
    const client = clientWith((url: string | URL | Request) => {
      if (String(url).endsWith('/participants')) {
        return Promise.resolve([participant({ id: 'e1', name: 'AtomCode 执行器' })])
      }
      if (String(url).includes('/tasks')) {
        return Promise.resolve([])
      }
      return Promise.resolve({
        items: [{ id: 'g9', title: 'dsh-coagenthub 插件开发', status: 'active', projectPath: '/Users/apple/Desktop/Projects/dsh-coagenthub' }],
        total: 1,
      })
    })
    const tool = createCoAgentHubTools(client, store).find(t => t.name === 'coagenthub_list_tasks')!
    const result = (await tool.execute({}, {
      agent: { session: { header: { cwd: '/Users/apple/Desktop/Projects/dsh-coagenthub' } } },
    } as never)) as Array<{ groupId: string }>
    expect(result).toEqual([])
    const calls = (fetch as ReturnType<typeof vi.fn>).mock.calls as Array<[string]>
    const tasksUrl = calls.map(call => String(call[0])).find(url => url.includes('/tasks'))
    expect(tasksUrl).toContain('/groups/g9/tasks')
  })

  it('list_tasks throws a clear error when no group can be resolved', async () => {
    const client = clientWith(() => Promise.resolve({ items: [], total: 0 }))
    const tool = createCoAgentHubTools(client).find(t => t.name === 'coagenthub_list_tasks')!
    await expect(execute(tool, {})).rejects.toThrow('未指定 groupId，且无法从当前工作区识别群；请手动传 groupId')
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
    const result = (await execute(tool, {})) as Record<string, unknown>
    expect(result).toEqual(expect.objectContaining({ groupId: 'g1', groupTitle: 'dsh-coagenthub 插件开发' }))
    expect(result.projectPath).toBeNull()
  })

  it('get_active_group returns null when the stored group no longer exists', async () => {
    const store = new CoAgentHubSettingsStore(null)
    store.set({ activeGroupId: 'ghost' })
    const client = clientWith(() => Promise.resolve({ items: [], total: 0 }))
    const tool = createCoAgentHubTools(client, store).find(t => t.name === 'coagenthub_get_active_group')!
    expect(await execute(tool, {})).toBeNull()
  })
})

describe('commander tools (list_groups / get_group / list_executors / get_task / notifications / workspace instructions)', () => {
  function group(id: string, title: string, status = 'active', projectPath: string | null = null) {
    return { id, title, status, projectPath, createdBy: 'u1', createdAt: '', updatedAt: '', memberCount: 0 }
  }

  it('list_groups maps groups and filters by status', async () => {
    const client = clientWith(() =>
      Promise.resolve({
        items: [group('g1', 'A', 'active', '/mac/a'), group('g2', 'B', 'archived')],
        total: 2,
      }),
    )
    const tool = createCoAgentHubTools(client).find(t => t.name === 'coagenthub_list_groups')!
    const all = (await execute(tool, {})) as Array<{ id: string; projectPath?: string | null }>
    expect(all).toEqual([
      { id: 'g1', title: 'A', status: 'active', projectPath: '/mac/a' },
      { id: 'g2', title: 'B', status: 'archived', projectPath: null },
    ])
    const active = (await execute(tool, { status: 'active' })) as Array<{ id: string }>
    expect(active.map(item => item.id)).toEqual(['g1'])
    const archived = (await execute(tool, { status: 'archived' })) as Array<{ id: string }>
    expect(archived.map(item => item.id)).toEqual(['g2'])
  })

  it('list_groups passes the limit to listGroups', async () => {
    const client = clientWith(() => Promise.resolve({ items: [], total: 0 }))
    const tool = createCoAgentHubTools(client).find(t => t.name === 'coagenthub_list_groups')!
    await execute(tool, { limit: 50 })
    const url = String((fetch as ReturnType<typeof vi.fn>).mock.calls[0]![0])
    expect(url).toContain('limit=50')
  })

  it('get_group returns projectPath and members', async () => {
    const client = clientWith(() =>
      Promise.resolve({
        ...group('g1', 'A', 'active', '/mac/a'),
        members: [{ id: 'm1', name: 'AtomCode 执行器' }],
      }),
    )
    const tool = createCoAgentHubTools(client).find(t => t.name === 'coagenthub_get_group')!
    const result = (await execute(tool, { groupId: 'g1' })) as Record<string, unknown>
    expect(result).toEqual({
      id: 'g1',
      title: 'A',
      status: 'active',
      projectPath: '/mac/a',
      members: [{ id: 'm1', name: 'AtomCode 执行器', device: null }],
    })
    expect(Object.values(result).some(value => value === undefined)).toBe(false)
  })

  it('get_group normalizes members: missing device becomes null, no undefined fields', async () => {
    const client = clientWith(() =>
      Promise.resolve({
        ...group('g1', 'A', 'active', '/mac/a'),
        members: [
          { id: 'm1', name: 'AtomCode 执行器' },
          { id: 'm2', name: 'Win dsh', device: 'windows' },
          { id: 'm3', name: '无设备', device: null },
        ],
      }),
    )
    const tool = createCoAgentHubTools(client).find(t => t.name === 'coagenthub_get_group')!
    const result = (await execute(tool, { groupId: 'g1' })) as {
      members: Array<{ id: string; name: string; device: string | null }>
    }
    expect(result.members).toEqual([
      { id: 'm1', name: 'AtomCode 执行器', device: null },
      { id: 'm2', name: 'Win dsh', device: 'windows' },
      { id: 'm3', name: '无设备', device: null },
    ])
    // 返回对象不得携带值为 undefined 的字段(序列化安全)。
    expect(JSON.stringify(result).includes('undefined')).toBe(false)
  })

  it('get_group outputs null (not undefined) when projectPath is absent', async () => {
    const client = clientWith(() =>
      Promise.resolve({
        ...group('g2', 'B', 'active', null),
        members: [],
      }),
    )
    const tool = createCoAgentHubTools(client).find(t => t.name === 'coagenthub_get_group')!
    const result = (await execute(tool, { groupId: 'g2' })) as Record<string, unknown>
    expect(result).toEqual({
      id: 'g2',
      title: 'B',
      status: 'active',
      projectPath: null,
      members: [],
    })
    expect(Object.values(result).some(value => value === undefined)).toBe(false)
  })

  it('get_group_members returns members with roles and prompt', async () => {
    const members = [
      {
        participantId: 'e-atom',
        name: 'AtomCode 执行器',
        device: 'mac',
        roles: ['executor'],
        prompt: '主要执行者',
        joinedAt: '2026-08-15T06:00:00.000Z',
      },
      {
        participantId: 'u1',
        name: 'Local User',
        device: null,
        roles: ['coordinator'],
        prompt: '任务发布者',
        joinedAt: '2026-08-15T06:00:00.000Z',
      },
    ]
    const client = clientWith(() => Promise.resolve(members))
    const tool = createCoAgentHubTools(client).find(t => t.name === 'coagenthub_get_group_members')!
    const result = (await execute(tool, { groupId: 'g1' })) as Array<Record<string, unknown>>
    expect(result).toEqual(members)
    const url = String((fetch as ReturnType<typeof vi.fn>).mock.calls[0]![0])
    expect(url).toContain('/groups/g1/members')
    // 返回对象不得携带值为 undefined 的字段(序列化安全)。
    expect(JSON.stringify(result).includes('undefined')).toBe(false)
  })

  it('get_group_members normalizes missing device/prompt/joinedAt and wraps string roles', async () => {
    const client = clientWith(() =>
      Promise.resolve([
        { participantId: 'e1', name: 'N1', roles: ['executor'] },
        { participantId: 'e2', name: 'N2', device: 'win', roles: 'executor' },
      ]),
    )
    const tool = createCoAgentHubTools(client).find(t => t.name === 'coagenthub_get_group_members')!
    const result = (await execute(tool, { groupId: 'g1' })) as Array<Record<string, unknown>>
    expect(result).toEqual([
      { participantId: 'e1', name: 'N1', device: null, roles: ['executor'], prompt: null, joinedAt: null },
      // 单个字符串角色被包装为数组,避免丢失分工信息。
      { participantId: 'e2', name: 'N2', device: 'win', roles: ['executor'], prompt: null, joinedAt: null },
    ])
    expect(JSON.stringify(result).includes('undefined')).toBe(false)
  })

  it('get_group_members auto-backfills groupId and throws a clear error when nothing resolves', async () => {
    const client = clientWith(() => Promise.resolve({ items: [], total: 0 }))
    const tool = createCoAgentHubTools(client).find(t => t.name === 'coagenthub_get_group_members')!
    // groupId 可选:未传时走自动回填,回填失败报清晰错误而非崩溃。
    await expect(execute(tool, {})).rejects.toThrow('未指定 groupId，且无法从当前工作区识别群；请手动传 groupId')
    // 空白 groupId 等价于未传,同样走回填并报错。
    await expect(execute(tool, { groupId: '  ' })).rejects.toThrow('未指定 groupId，且无法从当前工作区识别群；请手动传 groupId')
  })

  it('get_group_members surfaces a clear error when the group does not exist (404)', async () => {
    const client = clientWith(() =>
      Promise.resolve(new Response('{"error":"group not found"}', { status: 404 })),
    )
    const tool = createCoAgentHubTools(client).find(t => t.name === 'coagenthub_get_group_members')!
    await expect(execute(tool, { groupId: 'missing' })).rejects.toThrow('群组不存在')
  })

  it('get_group_members surfaces a clear error with status and reason on non-2xx', async () => {
    const client = clientWith(() =>
      Promise.resolve(new Response('{"error":"internal failure"}', { status: 500 })),
    )
    const tool = createCoAgentHubTools(client).find(t => t.name === 'coagenthub_get_group_members')!
    await expect(execute(tool, { groupId: 'g1' })).rejects.toThrow('CoAgentHub API 错误(500): internal failure')
  })

  it('get_group_members surfaces a clear error when the API is unreachable', async () => {
    const client = clientWith(() => Promise.reject(new TypeError('fetch failed')))
    const tool = createCoAgentHubTools(client).find(t => t.name === 'coagenthub_get_group_members')!
    await expect(execute(tool, { groupId: 'g1' })).rejects.toThrow('无法连接 CoAgentHub 服务')
  })

  it('update_group PATCHes a new title and returns id/title/status/projectPath', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ...group('g1', '改名后的群'),
      updatedAt: '',
      projectPath: '/mac/path',
    })
    const client = clientWith(fetchImpl)
    const tool = createCoAgentHubTools(client).find(t => t.name === 'coagenthub_update_group')!
    const result = (await execute(tool, { groupId: 'g1', title: '改名后的群' })) as Record<string, unknown>

    expect(result).toEqual({ id: 'g1', title: '改名后的群', status: 'active', projectPath: '/mac/path' })
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit]
    expect(String(url)).toContain('/groups/g1')
    expect(init.method).toBe('PATCH')
    expect(JSON.parse(String(init.body))).toEqual({ title: '改名后的群' })
  })

  it('update_group clears the project binding when projectPath is an empty string', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ...group('g1', 'T'), projectPath: null })
    const client = clientWith(fetchImpl)
    const tool = createCoAgentHubTools(client).find(t => t.name === 'coagenthub_update_group')!
    const result = (await execute(tool, { groupId: 'g1', projectPath: '' })) as { projectPath: string | null }

    expect(result.projectPath).toBeNull()
    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit]
    expect(JSON.parse(String(init.body))).toEqual({ projectPath: null })
  })

  it('update_group rejects when neither title nor projectPath is provided', async () => {
    const client = clientWith(() => Promise.resolve(group('g1', 'T')))
    const tool = createCoAgentHubTools(client).find(t => t.name === 'coagenthub_update_group')!
    await expect(execute(tool, { groupId: 'g1' })).rejects.toThrow('至少传一个')
  })

  it('update_group surfaces a clear error when the group does not exist (404)', async () => {
    const client = clientWith(() => Promise.resolve(new Response('{"error":"group not found"}', { status: 404 })))
    const tool = createCoAgentHubTools(client).find(t => t.name === 'coagenthub_update_group')!
    await expect(execute(tool, { groupId: 'missing', title: 'X' })).rejects.toThrow('群组不存在(404)')
  })

  it('add_group_member POSTs the member and returns the normalized member row', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      participantId: 'e1',
      name: 'AtomCode 执行器',
      device: 'mac',
      roles: ['executor'],
      prompt: '执行任务',
      joinedAt: '2026-08-15T06:00:00.000Z',
    })
    const client = clientWith(fetchImpl)
    const tool = createCoAgentHubTools(client).find(t => t.name === 'coagenthub_add_group_member')!
    const result = (await execute(tool, { groupId: 'g1', participantId: 'e1' })) as Record<string, unknown>

    expect(result).toEqual({
      participantId: 'e1',
      name: 'AtomCode 执行器',
      device: 'mac',
      roles: ['executor'],
      prompt: '执行任务',
      joinedAt: '2026-08-15T06:00:00.000Z',
    })
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit]
    expect(String(url)).toContain('/groups/g1/members')
    expect(init.method).toBe('POST')
    // 未传 roles 时默认 ['executor']。
    expect(JSON.parse(String(init.body))).toEqual({ participantId: 'e1', roles: ['executor'] })
    expect(JSON.stringify(result).includes('undefined')).toBe(false)
  })

  it('add_group_member normalizes missing fields and wraps string roles', async () => {
    const client = clientWith(() =>
      Promise.resolve({ participantId: 'e1', name: 'N1', roles: 'executor' }),
    )
    const tool = createCoAgentHubTools(client).find(t => t.name === 'coagenthub_add_group_member')!
    const result = (await execute(tool, { groupId: 'g1', participantId: 'e1', roles: ['executor'] })) as Record<string, unknown>

    expect(result).toEqual({
      participantId: 'e1',
      name: 'N1',
      device: null,
      roles: ['executor'],
      prompt: null,
      joinedAt: null,
    })
    expect(JSON.stringify(result).includes('undefined')).toBe(false)
  })

  it('add_group_member rejects a missing participantId', async () => {
    const client = clientWith(() => Promise.resolve({}))
    const tool = createCoAgentHubTools(client).find(t => t.name === 'coagenthub_add_group_member')!
    // schema 层必填校验:缺 participantId 时报清晰错误而非崩溃。
    await expect(execute(tool, { groupId: 'g1' })).rejects.toThrow('missing required property "participantId"')
  })

  it('add_group_member surfaces a clear error when the group does not exist (404)', async () => {
    const client = clientWith(() => Promise.resolve(new Response('{"error":"group not found"}', { status: 404 })))
    const tool = createCoAgentHubTools(client).find(t => t.name === 'coagenthub_add_group_member')!
    await expect(execute(tool, { groupId: 'missing', participantId: 'e1' })).rejects.toThrow('群组或成员不存在(404)')
  })

  it('remove_group_member returns { ok: true } on success', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(null, { status: 204 }))
    const client = clientWith(fetchImpl)
    const tool = createCoAgentHubTools(client).find(t => t.name === 'coagenthub_remove_group_member')!
    const result = await execute(tool, { groupId: 'g1', participantId: 'e1' })

    expect(result).toEqual({ ok: true })
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit]
    expect(String(url)).toContain('/groups/g1/members/e1')
    expect(init.method).toBe('DELETE')
  })

  it('remove_group_member surfaces a clear error when the member/group does not exist (404)', async () => {
    const client = clientWith(() => Promise.resolve(new Response('{"error":"member not found"}', { status: 404 })))
    const tool = createCoAgentHubTools(client).find(t => t.name === 'coagenthub_remove_group_member')!
    await expect(execute(tool, { groupId: 'g1', participantId: 'ghost' })).rejects.toThrow('成员或群组不存在(404)')
  })

  it('remove_group_member rejects a missing participantId', async () => {
    const client = clientWith(() => Promise.resolve({ ok: true }))
    const tool = createCoAgentHubTools(client).find(t => t.name === 'coagenthub_remove_group_member')!
    await expect(execute(tool, { groupId: 'g1' })).rejects.toThrow('missing required property "participantId"')
  })

  it('list_executors maps executors to the view shape', async () => {
    const client = clientWith(() =>
      Promise.resolve([
        { key: 'k1', agentName: 'AtomCode 执行器', kind: 'cli', bin: '/usr/bin/node', model: 'deepseek' },
        { key: 'k2', agentName: 'Win dsh', kind: null, bin: null, url: null, model: null, device: 'windows', online: true },
      ]),
    )
    const tool = createCoAgentHubTools(client).find(t => t.name === 'coagenthub_list_executors')!
    const result = (await execute(tool, {})) as Array<Record<string, unknown>>
    expect(result[0]).toEqual({
      key: 'k1',
      agentName: 'AtomCode 执行器',
      kind: 'cli',
      bin: '/usr/bin/node',
      url: null,
      model: 'deepseek',
      device: null,
      online: null,
    })
    expect(result[1]).toMatchObject({ device: 'windows', online: true })
    // 返回对象不得携带值为 undefined 的字段(序列化安全)。
    for (const executor of result) {
      expect(Object.values(executor).some(value => value === undefined)).toBe(false)
    }
  })

  it('get_task resolves executorName and carries attempts / diffSummary / outputTail', async () => {
    const task = {
      id: 't1',
      groupId: 'g1',
      status: 'done',
      executorParticipantId: 'e-atom',
      brief: '实现登录页',
      retryCount: 1,
      attempts: [{ n: 1, startedAt: 'a', endedAt: 'b', status: 'done', error: null, summary: 's', hash: 'h' }],
      diffSummary: { summary: '完成', hash: 'abc1234', error: null, outputTail: 'tail' },
      createdAt: 'c',
      updatedAt: 'u',
    }
    const client = clientWith((url: string | URL | Request) => {
      if (String(url).includes('/tasks/t1')) return Promise.resolve(task)
      return Promise.resolve([participant({ id: 'e-atom', name: 'AtomCode 执行器' })])
    })
    const tool = createCoAgentHubTools(client).find(t => t.name === 'coagenthub_get_task')!
    const result = (await execute(tool, { groupId: 'g1', taskId: 't1' })) as Record<string, unknown>
    expect(result).toEqual(expect.objectContaining({
      id: 't1',
      status: 'done',
      executorParticipantId: 'e-atom',
      executorName: 'AtomCode 执行器',
      brief: '实现登录页',
      retryCount: 1,
      attempts: task.attempts,
      outputTail: 'tail',
    }))
  })

  it('get_task normalizes attempts to schema: missing error/summary/hash become null', async () => {
    // 服务端 attempt 缺省 error/summary/hash(undefined):schema 中 required: true,
    // 缺字段会违反;归一化后补 null,值为 null 不违反 schema。
    const task = {
      id: 't1',
      groupId: 'g1',
      status: 'failed',
      executorParticipantId: 'e-atom',
      brief: '实现登录页',
      retryCount: 2,
      attempts: [
        { n: 1, startedAt: 'a', endedAt: null, status: 'failed' },
        { n: 2, startedAt: 'b', endedAt: 'c', status: 'running', error: '脚本崩溃', summary: 's', hash: 'h' },
      ],
      diffSummary: null,
      createdAt: 'c',
      updatedAt: 'u',
    }
    const client = clientWith((url: string | URL | Request) => {
      if (String(url).includes('/tasks/t1')) return Promise.resolve(task)
      return Promise.resolve([participant({ id: 'e-atom', name: 'AtomCode 执行器' })])
    })
    const tool = createCoAgentHubTools(client).find(t => t.name === 'coagenthub_get_task')!
    const result = (await execute(tool, { groupId: 'g1', taskId: 't1' })) as Record<string, unknown>
    expect(result.attempts).toEqual([
      { n: 1, startedAt: 'a', endedAt: null, status: 'failed', error: null, summary: null, hash: null },
      { n: 2, startedAt: 'b', endedAt: 'c', status: 'running', error: '脚本崩溃', summary: 's', hash: 'h' },
    ])
    expect(result.diffSummary).toBeNull()
    expect(result.outputTail).toBeNull()
    // 返回对象不得携带值为 undefined 的字段(序列化安全)。
    expect(JSON.stringify(result).includes('undefined')).toBe(false)
  })

  it('get_task keeps diffSummary fields when present and lifts outputTail to the top', async () => {
    const task = {
      id: 't1',
      groupId: 'g1',
      status: 'done',
      executorParticipantId: 'e-atom',
      brief: '实现登录页',
      retryCount: 1,
      attempts: [{ n: 1, startedAt: 'a', endedAt: 'b', status: 'done', error: null, summary: 's', hash: 'h' }],
      diffSummary: { summary: '完成', hash: 'abc1234', error: null, outputTail: 'tail' },
      createdAt: 'c',
      updatedAt: 'u',
    }
    const client = clientWith((url: string | URL | Request) => {
      if (String(url).includes('/tasks/t1')) return Promise.resolve(task)
      return Promise.resolve([participant({ id: 'e-atom', name: 'AtomCode 执行器' })])
    })
    const tool = createCoAgentHubTools(client).find(t => t.name === 'coagenthub_get_task')!
    const result = (await execute(tool, { groupId: 'g1', taskId: 't1' })) as Record<string, unknown>
    expect(result.diffSummary).toEqual({ summary: '完成', hash: 'abc1234', error: null })
    expect(result.outputTail).toBe('tail')
  })

  it('get_task returns outputTail from the task top level (server refactor position)', async () => {
    // 服务端重构后 outputTail 挂在任务顶层,diffSummary 里不再有它;工具应兼容读取。
    const task = {
      id: 't1',
      groupId: 'g1',
      status: 'running',
      executorParticipantId: 'e-atom',
      brief: '实现登录页',
      retryCount: 0,
      attempts: [],
      diffSummary: { summary: null, hash: null, error: null },
      outputTail: 'top-level-tail-line-1\ntop-level-tail-line-2',
      createdAt: 'c',
      updatedAt: 'u',
    }
    const client = clientWith((url: string | URL | Request) => {
      if (String(url).includes('/tasks/t1')) return Promise.resolve(task)
      return Promise.resolve([participant({ id: 'e-atom', name: 'AtomCode 执行器' })])
    })
    const tool = createCoAgentHubTools(client).find(t => t.name === 'coagenthub_get_task')!
    const result = (await execute(tool, { groupId: 'g1', taskId: 't1' })) as Record<string, unknown>
    expect(result.diffSummary).toEqual({ summary: null, hash: null, error: null })
    expect(result.outputTail).toBe('top-level-tail-line-1\ntop-level-tail-line-2')
  })

  it('get_task throws a friendly hint when the id is not a real task id (404 after listTasks fallback)', async () => {
    // 模拟单任务接口 404,fallback listTasks 也找不到该 id:此时应提示用户
    // dispatch_task 返回的是 messageId 而非 taskId,引导用 list_tasks 查询真实任务 id。
    const client = clientWith((url: string | URL | Request) => {
      if (String(url).includes('/tasks/ghost')) {
        return Promise.resolve(new Response('{"error":"task not found"}', { status: 404 }))
      }
      if (String(url).includes('/tasks')) {
        return Promise.resolve([])
      }
      return Promise.resolve([participant({ id: 'e-atom', name: 'AtomCode 执行器' })])
    })
    const tool = createCoAgentHubTools(client).find(t => t.name === 'coagenthub_get_task')!
    const error = await execute(tool, { groupId: 'g1', taskId: 'ghost' }).catch(err => err)
    expect(error).toBeInstanceOf(Error)
    const message = String((error as Error).message)
    expect(message).toContain('任务不存在或 id 无效(404): ghost')
    expect(message).toContain('coagenthub_dispatch_task 返回的 messageId，它不是 taskId')
    expect(message).toContain('coagenthub_list_tasks 查询真实任务 id')
  })

  it('update_task updates the brief and returns the updated task summary', async () => {
    const task = {
      id: 't1',
      groupId: 'g1',
      status: 'queued',
      executorParticipantId: 'e-atom',
      brief: '新任务书',
      createdAt: '2026-08-14T00:00:00.000Z',
      updatedAt: '2026-08-14T01:00:00.000Z',
    }
    const client = clientWith((url: string | URL | Request) => {
      if (String(url).includes('/tasks/t1')) return Promise.resolve(task)
      return Promise.resolve([participant({ id: 'e-atom', name: 'AtomCode 执行器' })])
    })
    const tool = createCoAgentHubTools(client).find(t => t.name === 'coagenthub_update_task')!
    const result = (await execute(tool, { groupId: 'g1', taskId: 't1', brief: '新任务书' })) as Record<string, unknown>
    expect(result).toEqual({
      id: 't1',
      groupId: 'g1',
      status: 'queued',
      executorParticipantId: 'e-atom',
      executorName: 'AtomCode 执行器',
      brief: '新任务书',
      createdAt: '2026-08-14T00:00:00.000Z',
      updatedAt: '2026-08-14T01:00:00.000Z',
    })
    const [url, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit]
    expect(String(url)).toContain('/groups/g1/tasks/t1')
    expect(init.method).toBe('PATCH')
    expect(JSON.parse(String(init.body))).toEqual({ brief: '新任务书' })
  })

  it('update_task surfaces the server 409 message verbatim', async () => {
    const client = clientWith(() =>
      Promise.resolve(new Response('仅排队中的任务可修改任务书', { status: 409 })),
    )
    const tool = createCoAgentHubTools(client).find(t => t.name === 'coagenthub_update_task')!
    await expect(execute(tool, { groupId: 'g1', taskId: 't1', brief: 'x' })).rejects.toThrow(
      '仅排队中的任务可修改任务书',
    )
  })

  it('update_task extracts the 409 message from a JSON error envelope', async () => {
    const client = clientWith(() =>
      Promise.resolve(new Response(JSON.stringify({ error: '仅排队中的任务可修改任务书' }), { status: 409 })),
    )
    const tool = createCoAgentHubTools(client).find(t => t.name === 'coagenthub_update_task')!
    await expect(execute(tool, { groupId: 'g1', taskId: 't1', brief: 'x' })).rejects.toThrow(
      '仅排队中的任务可修改任务书',
    )
  })

  it('update_task reports missing permission on 403', async () => {
    const client = clientWith(() => Promise.resolve(new Response('forbidden', { status: 403 })))
    const tool = createCoAgentHubTools(client).find(t => t.name === 'coagenthub_update_task')!
    await expect(execute(tool, { groupId: 'g1', taskId: 't1', brief: 'x' })).rejects.toThrow(/无权限修改任务书/)
  })

  it('get_notifications returns and clears the resolved group pending queue', async () => {
    notificationQueue.drain() // 清空共享队列,避免用例间串扰
    notificationQueue.enqueue({ type: 'task.completed', groupId: 'g1', taskId: 't1', status: 'done', time: 't' })
    // activeGroupId g1 存在于群列表,优先生效(cwd 未命中也没关系)。
    const store = new CoAgentHubSettingsStore(null)
    store.set({ activeGroupId: 'g1' })
    const client = clientWith(() => Promise.resolve({ items: [group('g1', '群一')], total: 1 }))
    const tool = createCoAgentHubTools(client, store).find(t => t.name === 'coagenthub_get_notifications')!
    const first = (await execute(tool, {})) as Array<{ type: string; groupId: string }>
    expect(first).toEqual([expect.objectContaining({ type: 'task.completed', groupId: 'g1' })])
    const second = (await execute(tool, {})) as unknown[]
    expect(second).toEqual([])
  })

  it('get_notifications resolves the group from the session cwd and keeps other groups queued', async () => {
    notificationQueue.drain() // 清空共享队列,避免用例间串扰
    notificationQueue.enqueue({ type: 'task.completed', groupId: 'g1', taskId: 't1', status: 'done', time: 't' })
    notificationQueue.enqueue({ type: 'task.failed', groupId: 'g2', taskId: 't2', status: 'failed', time: 't2' })
    const client = clientWith(() =>
      Promise.resolve({
        items: [group('g1', '群一', 'active', '/repo/a'), group('g2', '群二', 'active', '/repo/b')],
        total: 2,
      }),
    )
    const tool = createCoAgentHubTools(client).find(t => t.name === 'coagenthub_get_notifications')!
    const result = (await executeWithCwd(tool, {}, '/repo/a')) as Array<{ groupId: string }>
    expect(result).toEqual([expect.objectContaining({ groupId: 'g1' })])
    // 其他群的通知保留在队列里,不丢失。
    expect(notificationQueue.peek()).toEqual([expect.objectContaining({ groupId: 'g2' })])
    notificationQueue.drain()
  })

  it('sessions with different cwd only get their own group notifications', async () => {
    notificationQueue.drain() // 清空共享队列,避免用例间串扰
    notificationQueue.enqueue({ type: 'task.completed', groupId: 'g1', taskId: 't1', status: 'done', time: 't1' })
    notificationQueue.enqueue({ type: 'task.failed', groupId: 'g2', taskId: 't2', status: 'failed', time: 't2' })
    const client = clientWith(() =>
      Promise.resolve({
        items: [group('g1', '群一', 'active', '/repo/a'), group('g2', '群二', 'active', '/repo/b')],
        total: 2,
      }),
    )
    const tool = createCoAgentHubTools(client).find(t => t.name === 'coagenthub_get_notifications')!
    // 会话 A:cwd=/repo/a → 只取到 g1 的通知。
    const fromA = (await executeWithCwd(tool, {}, '/repo/a')) as Array<{ groupId: string; taskId: string }>
    expect(fromA).toEqual([expect.objectContaining({ groupId: 'g1', taskId: 't1' })])
    // 会话 B:cwd=/repo/b → 只取到 g2 的通知。
    const fromB = (await executeWithCwd(tool, {}, '/repo/b')) as Array<{ groupId: string; taskId: string }>
    expect(fromB).toEqual([expect.objectContaining({ groupId: 'g2', taskId: 't2' })])
    expect(notificationQueue.size).toBe(0)
  })

  it('get_notifications prefers the stored activeGroupId over the cwd lookup', async () => {
    notificationQueue.drain() // 清空共享队列,避免用例间串扰
    notificationQueue.enqueue({ type: 'task.completed', groupId: 'g1', taskId: 't1', status: 'done', time: 't' })
    notificationQueue.enqueue({ type: 'task.failed', groupId: 'g2', taskId: 't2', status: 'failed', time: 't2' })
    const store = new CoAgentHubSettingsStore(null)
    store.set({ activeGroupId: 'g2' }) // 设置指向 g2;cwd 命中 g1,但手动保存的 g2 优先
    const client = clientWith(() =>
      Promise.resolve({
        items: [group('g1', '群一', 'active', '/repo/a'), group('g2', '群二', 'active', '/repo/b')],
        total: 2,
      }),
    )
    const tool = createCoAgentHubTools(client, store).find(t => t.name === 'coagenthub_get_notifications')!
    const result = (await executeWithCwd(tool, {}, '/repo/a')) as Array<{ groupId: string; taskId: string }>
    expect(result).toEqual([expect.objectContaining({ groupId: 'g2', taskId: 't2' })])
    // 其他群(g1)的通知保留在队列里,不丢失。
    expect(notificationQueue.peek()).toEqual([expect.objectContaining({ groupId: 'g1' })])
    notificationQueue.drain()
  })

  it('get_notifications falls back to the cwd lookup when the stored activeGroupId no longer exists', async () => {
    notificationQueue.drain() // 清空共享队列,避免用例间串扰
    notificationQueue.enqueue({ type: 'task.completed', groupId: 'g1', taskId: 't1', status: 'done', time: 't' })
    const store = new CoAgentHubSettingsStore(null)
    store.set({ activeGroupId: 'ghost' }) // 存储的群已不在群列表中,视为未设置
    const client = clientWith(() =>
      Promise.resolve({
        items: [group('g1', '群一', 'active', '/repo/a'), group('g2', '群二', 'active', '/repo/b')],
        total: 2,
      }),
    )
    const tool = createCoAgentHubTools(client, store).find(t => t.name === 'coagenthub_get_notifications')!
    const result = (await executeWithCwd(tool, {}, '/repo/a')) as Array<{ groupId: string }>
    expect(result).toEqual([expect.objectContaining({ groupId: 'g1', taskId: 't1' })])
    notificationQueue.drain()
  })

  it('get_notifications returns nothing and clears nothing when no group resolves', async () => {
    notificationQueue.drain() // 清空共享队列,避免用例间串扰
    notificationQueue.enqueue({ type: 'task.completed', groupId: 'g1', taskId: 't1', status: 'done', time: 't' })
    // cwd 未命中任何群,也没有 activeGroupId:返回空且不消费队列。
    const client = clientWith(() =>
      Promise.resolve({ items: [group('g1', '群一', 'active', '/repo/a')], total: 1 }),
    )
    const tool = createCoAgentHubTools(client).find(t => t.name === 'coagenthub_get_notifications')!
    const result = (await executeWithCwd(tool, {}, '/other/repo')) as unknown[]
    expect(result).toEqual([])
    expect(notificationQueue.size).toBe(1)
    notificationQueue.drain()
  })

  it('get_notifications normalizes missing fields to null (no undefined values)', async () => {
    notificationQueue.drain() // 清空共享队列,避免用例间串扰
    notificationQueue.enqueue({ type: 'message.received', groupId: 'g1', time: 't' })
    notificationQueue.enqueue({
      type: 'task.failed',
      groupId: 'g1',
      taskId: 't1',
      status: 'failed',
      executorName: 'AtomCode 执行器',
      summary: '构建失败',
      time: 't2',
    })
    const client = clientWith(() =>
      Promise.resolve({ items: [group('g1', '群一', 'active', '/repo/a')], total: 1 }),
    )
    const tool = createCoAgentHubTools(client).find(t => t.name === 'coagenthub_get_notifications')!
    const result = (await executeWithCwd(tool, {}, '/repo/a')) as Array<Record<string, unknown>>
    expect(result).toEqual([
      { type: 'message.received', groupId: 'g1', taskId: null, status: null, executorName: null, summary: null, time: 't' },
      {
        type: 'task.failed',
        groupId: 'g1',
        taskId: 't1',
        status: 'failed',
        executorName: 'AtomCode 执行器',
        summary: '构建失败',
        time: 't2',
      },
    ])
    // 返回数组不得携带值为 undefined 的字段(序列化安全)。
    expect(JSON.stringify(result).includes('undefined')).toBe(false)
  })

  it('dispatch_task renders structured fields into the task book body', async () => {
    const postMessage = vi.fn().mockResolvedValue({ id: 'm1', createdAt: '' })
    const client = clientWith((url: string | URL | Request, init?: RequestInit) => {
      if (String(url).endsWith('/participants')) {
        return Promise.resolve([participant({ id: 'e-atom', name: 'AtomCode 执行器' })])
      }
      return postMessage(url, init)
    })
    const tool = createCoAgentHubTools(client).find(t => t.name === 'coagenthub_dispatch_task')!
    const result = await execute(tool, {
      groupId: 'g1',
      body: '实现登录页',
      goal: '完成登录功能',
      scope: '不含支付',
      acceptance: '能登录、能登出',
      tests: 'pnpm test 通过',
      report: '提交 + 测试摘要',
    })
    expect(result).toEqual({ messageId: 'm1', executorParticipantId: 'e-atom', executorName: 'AtomCode 执行器' })
    const [, init] = postMessage.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(String(init.body)).body as string
    expect(body).toContain('实现登录页')
    expect(body).toContain('## 目标')
    expect(body).toContain('完成登录功能')
    expect(body).toContain('## 范围')
    expect(body).toContain('不含支付')
    expect(body).toContain('## 验收标准')
    expect(body).toContain('能登录、能登出')
    expect(body).toContain('## 测试要求')
    expect(body).toContain('## 汇报格式')
  })

  it('dispatch_task keeps the body verbatim when no structured fields are passed', async () => {
    const postMessage = vi.fn().mockResolvedValue({ id: 'm1', createdAt: '' })
    const client = clientWith((url: string | URL | Request, init?: RequestInit) => {
      if (String(url).endsWith('/participants')) {
        return Promise.resolve([participant({ id: 'e-atom', name: 'AtomCode 执行器' })])
      }
      return postMessage(url, init)
    })
    const tool = createCoAgentHubTools(client).find(t => t.name === 'coagenthub_dispatch_task')!
    await execute(tool, { groupId: 'g1', body: '原样任务书' })
    const [, init] = postMessage.mock.calls[0] as [string, RequestInit]
    expect(JSON.parse(String(init.body)).body).toBe('原样任务书')
  })

  it('get_workspace_instructions reads COAGENTHUB.md from the workspace root', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'coagenthub-ws-'))
    try {
      writeFileSync(join(dir, 'COAGENTHUB.md'), '# 指令\n\n指挥官职责\n')
      const store = new CoAgentHubSettingsStore(null)
      store.set({ activeGroupId: 'g1' })
      const client = clientWith(() => Promise.resolve({ items: [group('g1', '群A')], total: 1 }))
      const tool = createCoAgentHubTools(client, store).find(t => t.name === 'coagenthub_get_workspace_instructions')!
      const result = (await tool.execute({}, {
        agent: { session: { header: { cwd: dir } } },
      } as never)) as Record<string, unknown>
      expect(result).toEqual({ groupId: 'g1', groupTitle: '群A', instructions: '# 指令\n\n指挥官职责\n' })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('get_workspace_instructions prefers the stored activeGroupId over cwd and reads the group local path', async () => {
    const groupDir = mkdtempSync(join(tmpdir(), 'coagenthub-ws-group-'))
    const cwdDir = mkdtempSync(join(tmpdir(), 'coagenthub-ws-cwd-'))
    try {
      writeFileSync(join(groupDir, 'COAGENTHUB.md'), '选中群指令')
      writeFileSync(join(cwdDir, 'COAGENTHUB.md'), 'cwd 指令(不应被读取)')
      const store = new CoAgentHubSettingsStore(null)
      store.set({ activeGroupId: 'g1' })
      const client = clientWith(() =>
        Promise.resolve({ items: [group('g1', '手动保存群', 'active', groupDir)], total: 1 }),
      )
      const tool = createCoAgentHubTools(client, store).find(t => t.name === 'coagenthub_get_workspace_instructions')!
      const result = (await tool.execute({}, {
        agent: { session: { header: { cwd: cwdDir } } },
      } as never)) as Record<string, unknown>
      expect(result).toEqual({ groupId: 'g1', groupTitle: '手动保存群', instructions: '选中群指令' })
    } finally {
      rmSync(groupDir, { recursive: true, force: true })
      rmSync(cwdDir, { recursive: true, force: true })
    }
  })

  it('get_workspace_instructions returns instructions null in a non-plugin workspace', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'coagenthub-empty-'))
    try {
      const client = clientWith(() => Promise.resolve({ items: [], total: 0 }))
      const tool = createCoAgentHubTools(client).find(t => t.name === 'coagenthub_get_workspace_instructions')!
      const result = (await tool.execute({}, {
        agent: { session: { header: { cwd: dir } } },
      } as never)) as Record<string, unknown>
      expect(result).toEqual({ groupId: null, groupTitle: null, instructions: null })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('get_active_group projects winPath for the selected group and does not read instructions from the unrelated cwd', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'coagenthub-active-'))
    try {
      writeFileSync(join(dir, 'COAGENTHUB.md'), '工作区指令')
      const store = new CoAgentHubSettingsStore(null)
      store.set({
        activeGroupId: 'g1',
        mappingRule: { macPrefix: '/Users/apple/Desktop/Projects/', winPrefix: 'Z:\\' },
      })
      const client = clientWith(() =>
        Promise.resolve({ items: [group('g1', 'dsh-coagenthub 插件开发', 'active', '/Users/apple/Desktop/Projects/dsh-coagenthub')], total: 1 }),
      )
      const tool = createCoAgentHubTools(client, store).find(t => t.name === 'coagenthub_get_active_group')!
      const result = (await tool.execute({}, {
        agent: { session: { header: { cwd: dir } } },
      } as never)) as Record<string, unknown>
      expect(result).toEqual(expect.objectContaining({
        groupId: 'g1',
        groupTitle: 'dsh-coagenthub 插件开发',
        projectPath: '/Users/apple/Desktop/Projects/dsh-coagenthub',
        winPath: 'Z:\\dsh-coagenthub',
      }))
      // activeGroupId 优先生效时 instructions 从选中群本地路径读:winPath
      // Z:\dsh-coagenthub 在本机不可读 → null,绝不读与选中群无关的会话 cwd。
      expect(result.instructions).toBeNull()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('get_active_group reads instructions from the selected group local path, not the unrelated session cwd', async () => {
    const groupDir = mkdtempSync(join(tmpdir(), 'coagenthub-group-'))
    const cwdDir = mkdtempSync(join(tmpdir(), 'coagenthub-cwd-'))
    try {
      writeFileSync(join(groupDir, 'COAGENTHUB.md'), '选中群指令')
      writeFileSync(join(cwdDir, 'COAGENTHUB.md'), 'cwd 指令(不应被读取)')
      const store = new CoAgentHubSettingsStore(null)
      store.set({ activeGroupId: 'g1' })
      const client = clientWith(() =>
        Promise.resolve({ items: [group('g1', '手动保存群', 'active', groupDir)], total: 1 }),
      )
      const tool = createCoAgentHubTools(client, store).find(t => t.name === 'coagenthub_get_active_group')!
      const result = (await tool.execute({}, {
        agent: { session: { header: { cwd: cwdDir } } },
      } as never)) as Record<string, unknown>
      expect(result).toEqual(expect.objectContaining({
        groupId: 'g1',
        groupTitle: '手动保存群',
        projectPath: groupDir,
        winPath: null,
        instructions: '选中群指令',
      }))
    } finally {
      rmSync(groupDir, { recursive: true, force: true })
      rmSync(cwdDir, { recursive: true, force: true })
    }
  })

  it('get_active_group resolves the group from cwd via a non-Z mapping rule', async () => {
    const store = new CoAgentHubSettingsStore(null)
    store.set({ mappingRule: { macPrefix: '/Users/apple/Desktop/Projects/', winPrefix: 'Y:\\' } })
    const client = clientWith(() =>
      Promise.resolve({
        items: [group('g1', 'dsh-coagenthub 插件开发', 'active', '/Users/apple/Desktop/Projects/dsh-coagenthub')],
        total: 1,
      }),
    )
    const tool = createCoAgentHubTools(client, store).find(t => t.name === 'coagenthub_get_active_group')!
    const result = (await tool.execute({}, {
      agent: { session: { header: { cwd: 'Y:\\dsh-coagenthub' } } },
    } as never)) as Record<string, unknown>
    expect(result).toEqual(expect.objectContaining({
      groupId: 'g1',
      groupTitle: 'dsh-coagenthub 插件开发',
      projectPath: '/Users/apple/Desktop/Projects/dsh-coagenthub',
      winPath: 'Y:\\dsh-coagenthub',
    }))
  })

  it('get_active_group matches a Mac/POSIX cwd via projectPath and returns the mapped winPath', async () => {
    const store = new CoAgentHubSettingsStore(null)
    store.set({ mappingRule: { macPrefix: '/Users/apple/Desktop/Projects/', winPrefix: 'Z:\\' } })
    const client = clientWith(() =>
      Promise.resolve({
        items: [group('g1', 'dsh-coagenthub 插件开发', 'active', '/Users/apple/Desktop/Projects/dsh-coagenthub')],
        total: 1,
      }),
    )
    const tool = createCoAgentHubTools(client, store).find(t => t.name === 'coagenthub_get_active_group')!
    const result = (await tool.execute({}, {
      agent: { session: { header: { cwd: '/Users/apple/Desktop/Projects/dsh-coagenthub/' } } },
    } as never)) as Record<string, unknown>
    expect(result).toEqual(expect.objectContaining({
      groupId: 'g1',
      groupTitle: 'dsh-coagenthub 插件开发',
      projectPath: '/Users/apple/Desktop/Projects/dsh-coagenthub',
      winPath: 'Z:\\dsh-coagenthub',
    }))
  })

  it('get_active_group resolves the group from cwd matching a native Windows path (case/slash tolerant)', async () => {
    const client = clientWith(() =>
      Promise.resolve({
        items: [group('g2', '本地 Windows 项目', 'active', 'C:\\projects\\dsh-coagenthub')],
        total: 1,
      }),
    )
    const tool = createCoAgentHubTools(client).find(t => t.name === 'coagenthub_get_active_group')!
    const result = (await tool.execute({}, {
      agent: { session: { header: { cwd: 'c:/Projects/dsh-coagenthub' } } },
    } as never)) as Record<string, unknown>
    expect(result).toEqual(expect.objectContaining({
      groupId: 'g2',
      groupTitle: '本地 Windows 项目',
      projectPath: 'C:\\projects\\dsh-coagenthub',
      winPath: 'C:\\projects\\dsh-coagenthub',
    }))
  })

  it('get_active_group keeps the native winPath for a selected Windows-local group', async () => {
    const store = new CoAgentHubSettingsStore(null)
    store.set({ activeGroupId: 'g2' })
    const client = clientWith(() =>
      Promise.resolve({
        items: [group('g2', '本地 Windows 项目', 'active', 'C:\\projects\\dsh-coagenthub')],
        total: 1,
      }),
    )
    const tool = createCoAgentHubTools(client, store).find(t => t.name === 'coagenthub_get_active_group')!
    const result = (await tool.execute({}, {} as never)) as Record<string, unknown>
    expect(result).toEqual(expect.objectContaining({
      groupId: 'g2',
      winPath: 'C:\\projects\\dsh-coagenthub',
    }))
  })

  it('get_active_group resolves the group from a UNC cwd via server/share + macPrefix when activeGroupId is empty', async () => {
    const store = new CoAgentHubSettingsStore(null)
    store.set({ mappingRule: { macPrefix: '/Users/apple/Desktop/Projects/', winPrefix: 'Z:\\' } })
    const client = clientWith(() =>
      Promise.resolve({
        items: [
          group('g1', 'dsh-coagenthub 插件开发', 'active', '/Users/apple/Desktop/Projects/dsh-coagenthub'),
          group('g2', 'readinghelper', 'active', '/Users/apple/Desktop/Projects/readinghelper'),
        ],
        total: 2,
      }),
    )
    const tool = createCoAgentHubTools(client, store).find(t => t.name === 'coagenthub_get_active_group')!
    // activeGroupId 为空:会话 cwd 为 UNC,按 \\server\share + macPrefix 反查命中 g1。
    const result = (await tool.execute({}, {
      agent: { session: { header: { cwd: '\\\\192.168.31.92\\Projects\\dsh-coagenthub' } } },
    } as never)) as Record<string, unknown>
    expect(result).toEqual(expect.objectContaining({
      groupId: 'g1',
      groupTitle: 'dsh-coagenthub 插件开发',
      projectPath: '/Users/apple/Desktop/Projects/dsh-coagenthub',
      winPath: 'Z:\\dsh-coagenthub',
    }))
  })

  it('get_active_group resolves the group from a forward-slash UNC cwd', async () => {
    const store = new CoAgentHubSettingsStore(null)
    store.set({ mappingRule: { macPrefix: '/Users/apple/Desktop/Projects/', winPrefix: 'Z:\\' } })
    const client = clientWith(() =>
      Promise.resolve({
        items: [group('g2', 'readinghelper', 'active', '/Users/apple/Desktop/Projects/readinghelper')],
        total: 1,
      }),
    )
    const tool = createCoAgentHubTools(client, store).find(t => t.name === 'coagenthub_get_active_group')!
    const result = (await tool.execute({}, {
      agent: { session: { header: { cwd: '//192.168.31.92/Projects/readinghelper' } } },
    } as never)) as Record<string, unknown>
    expect(result).toEqual(expect.objectContaining({
      groupId: 'g2',
      groupTitle: 'readinghelper',
      winPath: 'Z:\\readinghelper',
    }))
  })

  it('get_active_group returns null when the UNC cwd matches no group', async () => {
    const store = new CoAgentHubSettingsStore(null)
    store.set({ mappingRule: { macPrefix: '/Users/apple/Desktop/Projects/', winPrefix: 'Z:\\' } })
    const client = clientWith(() =>
      Promise.resolve({
        items: [group('g1', 'dsh-coagenthub 插件开发', 'active', '/Users/apple/Desktop/Projects/dsh-coagenthub')],
        total: 1,
      }),
    )
    const tool = createCoAgentHubTools(client, store).find(t => t.name === 'coagenthub_get_active_group')!
    expect(await tool.execute({}, {
      agent: { session: { header: { cwd: '\\\\192.168.31.92\\Projects\\nope' } } },
    } as never)).toBeNull()
  })

  it('get_active_group falls back to the cwd-matched group when the stored activeGroupId no longer exists', async () => {
    const store = new CoAgentHubSettingsStore(null)
    store.set({ activeGroupId: 'g1' })
    const client = clientWith(() =>
      Promise.resolve({
        items: [group('g9', 'dsh-coagenthub 插件开发', 'active', '/Users/apple/Desktop/Projects/dsh-coagenthub')],
        total: 1,
      }),
    )
    const tool = createCoAgentHubTools(client, store).find(t => t.name === 'coagenthub_get_active_group')!
    // 存储的 g1 已不在群列表中(视为未设置),cwd 反查兜底命中 g9。
    const result = (await tool.execute({}, {
      agent: { session: { header: { cwd: '/Users/apple/Desktop/Projects/dsh-coagenthub' } } },
    } as never)) as Record<string, unknown>
    expect(result).toEqual(expect.objectContaining({ groupId: 'g9', groupTitle: 'dsh-coagenthub 插件开发' }))
  })

  it('get_active_group returns null when cwd matches no group; instructions tool still reads COAGENTHUB.md', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'coagenthub-nomatch-'))
    try {
      writeFileSync(join(dir, 'COAGENTHUB.md'), '非插件群指令')
      const client = clientWith(() =>
        Promise.resolve({ items: [group('g1', '别的项目', 'active', '/Users/apple/Desktop/Projects/other')], total: 1 }),
      )
      const tools = createCoAgentHubTools(client)
      const active = tools.find(t => t.name === 'coagenthub_get_active_group')!
      expect(await active.execute({}, { agent: { session: { header: { cwd: dir } } } } as never)).toBeNull()
      const instructions = tools.find(t => t.name === 'coagenthub_get_workspace_instructions')!
      const result = (await instructions.execute({}, {
        agent: { session: { header: { cwd: dir } } },
      } as never)) as Record<string, unknown>
      expect(result).toEqual({ groupId: null, groupTitle: null, instructions: '非插件群指令' })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('get_workspace_instructions fills groupId/groupTitle from cwd when no group is selected', async () => {
    const store = new CoAgentHubSettingsStore(null)
    store.set({ mappingRule: { macPrefix: '/Users/apple/Desktop/Projects/', winPrefix: 'Y:\\' } })
    const client = clientWith(() =>
      Promise.resolve({
        items: [group('g3', '映射群', 'active', '/Users/apple/Desktop/Projects/dsh-coagenthub')],
        total: 1,
      }),
    )
    const tool = createCoAgentHubTools(client, store).find(t => t.name === 'coagenthub_get_workspace_instructions')!
    const result = (await tool.execute({}, {
      agent: { session: { header: { cwd: 'Y:\\dsh-coagenthub' } } },
    } as never)) as Record<string, unknown>
    expect(result).toEqual({ groupId: 'g3', groupTitle: '映射群', instructions: null })
  })

  it('get_active_group resolves the group from the live root agent cwd (Mac session, ReadingHelper)', async () => {
    const client = clientWith(() =>
      Promise.resolve({
        items: [group('g9', 'ReadingHelper', 'active', '/Users/apple/Desktop/Projects/readinghelper')],
        total: 1,
      }),
    )
    const tool = createCoAgentHubTools(client, undefined, () => '/Users/apple/Desktop/Projects/readinghelper')
      .find(t => t.name === 'coagenthub_get_active_group')!
    const result = (await execute(tool, {})) as Record<string, unknown>
    expect(result).toEqual(expect.objectContaining({ groupId: 'g9', groupTitle: 'ReadingHelper' }))
  })

  it('get_active_group resolves the live root agent cwd via the Z: mapping (Windows session)', async () => {
    const store = new CoAgentHubSettingsStore(null)
    store.set({ mappingRule: { macPrefix: '/Users/apple/Desktop/Projects/', winPrefix: 'Z:\\' } })
    const client = clientWith(() =>
      Promise.resolve({
        items: [group('g9', 'ReadingHelper', 'active', '/Users/apple/Desktop/Projects/readinghelper')],
        total: 1,
      }),
    )
    const tool = createCoAgentHubTools(client, store, () => 'Z:\\readinghelper')
      .find(t => t.name === 'coagenthub_get_active_group')!
    const result = (await execute(tool, {})) as Record<string, unknown>
    expect(result).toEqual(expect.objectContaining({ groupId: 'g9', winPath: 'Z:\\readinghelper' }))
  })

  it('get_active_group prefers the exec agent cwd over the live root agent resolver', async () => {
    const client = clientWith(() =>
      Promise.resolve({
        items: [
          group('g1', 'dsh-coagenthub 插件开发', 'active', '/Users/apple/Desktop/Projects/dsh-coagenthub'),
          group('g2', 'ReadingHelper', 'active', '/Users/apple/Desktop/Projects/readinghelper'),
        ],
        total: 2,
      }),
    )
    const tool = createCoAgentHubTools(client, undefined, () => '/Users/apple/Desktop/Projects/readinghelper')
      .find(t => t.name === 'coagenthub_get_active_group')!
    const result = (await tool.execute({}, {
      agent: { session: { header: { cwd: '/Users/apple/Desktop/Projects/dsh-coagenthub' } } },
    } as never)) as Record<string, unknown>
    expect(result).toEqual(expect.objectContaining({ groupId: 'g1' }))
  })

  it('get_active_group resolves the group from the legacy session.meta.cwd when header.cwd is absent', async () => {
    const client = clientWith(() =>
      Promise.resolve({
        items: [group('g9', 'ReadingHelper', 'active', '/Users/apple/Desktop/Projects/readinghelper')],
        total: 1,
      }),
    )
    const tool = createCoAgentHubTools(client).find(t => t.name === 'coagenthub_get_active_group')!
    const result = (await tool.execute({}, {
      agent: { session: { meta: { cwd: '/Users/apple/Desktop/Projects/readinghelper' } } },
    } as never)) as Record<string, unknown>
    expect(result).toEqual(expect.objectContaining({ groupId: 'g9', groupTitle: 'ReadingHelper' }))
  })

  it('get_active_group does not fall back to process.cwd() (no session cwd, no resolver)', async () => {
    // 回归:修复前 workspaceRootFromExec 在 exec 无 agent 时回退 process.cwd(),
    // 常驻 web 进程会把会话误判到 dsh 启动目录绑定的群。
    const client = clientWith(() =>
      Promise.resolve({
        items: [group('g9', 'dsh-coagenthub 插件开发', 'active', process.cwd())],
        total: 1,
      }),
    )
    const tool = createCoAgentHubTools(client).find(t => t.name === 'coagenthub_get_active_group')!
    expect(await execute(tool, {})).toBeNull()
  })

  it('get_workspace_instructions fills groupId/groupTitle from the live root agent cwd', async () => {
    const client = clientWith(() =>
      Promise.resolve({ items: [group('g3', '映射群', 'active', '/repo/x')], total: 1 }),
    )
    const tool = createCoAgentHubTools(client, undefined, () => '/repo/x')
      .find(t => t.name === 'coagenthub_get_workspace_instructions')!
    const result = (await execute(tool, {})) as Record<string, unknown>
    expect(result).toEqual({ groupId: 'g3', groupTitle: '映射群', instructions: null })
  })

  it('get_notifications resolves the group from the live root agent cwd when exec carries no agent', async () => {
    notificationQueue.drain()
    notificationQueue.enqueue({ type: 'task.completed', groupId: 'g1', taskId: 't1', status: 'done', time: 't' })
    const client = clientWith(() =>
      Promise.resolve({ items: [group('g1', '群一', 'active', '/repo/a')], total: 1 }),
    )
    const tool = createCoAgentHubTools(client, undefined, () => '/repo/a')
      .find(t => t.name === 'coagenthub_get_notifications')!
    const result = (await execute(tool, {})) as Array<{ groupId: string }>
    expect(result).toEqual([expect.objectContaining({ groupId: 'g1' })])
    notificationQueue.drain()
  })

  it('get_notifications does not fall back to process.cwd() when no cwd is resolvable', async () => {
    notificationQueue.drain()
    notificationQueue.enqueue({ type: 'task.completed', groupId: 'g9', taskId: 't1', status: 'done', time: 't' })
    const client = clientWith(() =>
      Promise.resolve({
        items: [group('g9', 'dsh-coagenthub 插件开发', 'active', process.cwd())],
        total: 1,
      }),
    )
    const tool = createCoAgentHubTools(client).find(t => t.name === 'coagenthub_get_notifications')!
    const result = (await execute(tool, {})) as unknown[]
    expect(result).toEqual([])
    expect(notificationQueue.size).toBe(1)
    notificationQueue.drain()
  })
})
