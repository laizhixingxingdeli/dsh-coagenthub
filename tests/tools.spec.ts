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

  it('get_notifications returns and clears the pending queue', async () => {
    notificationQueue.drain() // 清空共享队列,避免用例间串扰
    notificationQueue.enqueue({ type: 'task.completed', groupId: 'g1', taskId: 't1', status: 'done', time: 't' })
    const client = clientWith(() => Promise.resolve([]))
    const tool = createCoAgentHubTools(client).find(t => t.name === 'coagenthub_get_notifications')!
    const first = (await execute(tool, {})) as Array<{ type: string; groupId: string }>
    expect(first).toEqual([expect.objectContaining({ type: 'task.completed', groupId: 'g1' })])
    const second = (await execute(tool, {})) as unknown[]
    expect(second).toEqual([])
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
    const client = clientWith(() => Promise.resolve([]))
    const tool = createCoAgentHubTools(client).find(t => t.name === 'coagenthub_get_notifications')!
    const result = (await execute(tool, {})) as Array<Record<string, unknown>>
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
        agent: { session: { meta: { cwd: dir } } },
      } as never)) as Record<string, unknown>
      expect(result).toEqual({ groupId: 'g1', groupTitle: '群A', instructions: '# 指令\n\n指挥官职责\n' })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('get_workspace_instructions returns instructions null in a non-plugin workspace', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'coagenthub-empty-'))
    try {
      const client = clientWith(() => Promise.resolve({ items: [], total: 0 }))
      const tool = createCoAgentHubTools(client).find(t => t.name === 'coagenthub_get_workspace_instructions')!
      const result = (await tool.execute({}, {
        agent: { session: { meta: { cwd: dir } } },
      } as never)) as Record<string, unknown>
      expect(result).toEqual({ groupId: null, groupTitle: null, instructions: null })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('get_active_group projects winPath and reads instructions', async () => {
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
        agent: { session: { meta: { cwd: dir } } },
      } as never)) as Record<string, unknown>
      expect(result).toEqual(expect.objectContaining({
        groupId: 'g1',
        groupTitle: 'dsh-coagenthub 插件开发',
        projectPath: '/Users/apple/Desktop/Projects/dsh-coagenthub',
        winPath: 'Z:\\dsh-coagenthub',
        instructions: '工作区指令',
      }))
    } finally {
      rmSync(dir, { recursive: true, force: true })
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
      agent: { session: { meta: { cwd: 'Y:\\dsh-coagenthub' } } },
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
      agent: { session: { meta: { cwd: '/Users/apple/Desktop/Projects/dsh-coagenthub/' } } },
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
      agent: { session: { meta: { cwd: 'c:/Projects/dsh-coagenthub' } } },
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

  it('get_active_group returns null when cwd matches no group; instructions tool still reads COAGENTHUB.md', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'coagenthub-nomatch-'))
    try {
      writeFileSync(join(dir, 'COAGENTHUB.md'), '非插件群指令')
      const client = clientWith(() =>
        Promise.resolve({ items: [group('g1', '别的项目', 'active', '/Users/apple/Desktop/Projects/other')], total: 1 }),
      )
      const tools = createCoAgentHubTools(client)
      const active = tools.find(t => t.name === 'coagenthub_get_active_group')!
      expect(await active.execute({}, { agent: { session: { meta: { cwd: dir } } } } as never)).toBeNull()
      const instructions = tools.find(t => t.name === 'coagenthub_get_workspace_instructions')!
      const result = (await instructions.execute({}, {
        agent: { session: { meta: { cwd: dir } } },
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
      agent: { session: { meta: { cwd: 'Y:\\dsh-coagenthub' } } },
    } as never)) as Record<string, unknown>
    expect(result).toEqual({ groupId: 'g3', groupTitle: '映射群', instructions: null })
  })
})
