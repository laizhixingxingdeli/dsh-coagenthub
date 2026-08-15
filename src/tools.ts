/**
 * CoAgentHub tools for the dsh agent: list participants, create groups, post
 * messages, dispatch tasks to executors, query tasks and messages.
 * @module @laizhixingxingdeli/dsh-coagenthub/tools
 */

import type { Context } from '@deepseek-ai/cordis'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolDefinition, ToolRunContext } from '@deepseek-ai/dsh-tools'
import { CoAgentHubClient } from './client.ts'
import type { Message, Participant } from './client.ts'
import type { CoAgentHubSettingsStore } from './config.ts'
import { notificationQueue } from './notification-queue.ts'
import { buildTaskBook } from './task-book.ts'
import { projectToWinPath } from './workspace.ts'
import { readWorkspaceInstructions, workspaceRootFromExec } from './workspace-instructions.ts'

const DEFAULT_EXECUTOR_NAME = 'AtomCode'

const ONLINE_WINDOW_MS = 5 * 60 * 1000

const BRIEF_SUMMARY_LIMIT = 200

function renderValue(_args: unknown, value: unknown): ContentBlock[] {
  return [{ type: 'text', text: JSON.stringify(value, null, 2) }]
}

function participantType(name: string): 'executor' | 'local' | 'participant' {
  if (name.includes('执行器')) return 'executor'
  if (name === 'Local User') return 'local'
  return 'participant'
}

function isOnline(participant: Participant): boolean {
  if (participant.lastSeen === null) return false
  const lastSeen = Date.parse(participant.lastSeen)
  if (Number.isNaN(lastSeen)) return false
  return Date.now() - lastSeen <= ONLINE_WINDOW_MS
}

function participantView(participant: Participant) {
  return {
    id: participant.id,
    name: participant.name,
    type: participantType(participant.name),
    device: participant.device,
    online: isOnline(participant),
    lastSeen: participant.lastSeen,
  }
}

function messageView(message: Message) {
  return {
    id: message.id,
    senderId: message.senderId,
    audience: message.audience,
    audienceRef: message.audienceRef,
    body: message.body,
    createdAt: message.createdAt,
  }
}

function summarizeBrief(brief: string): string {
  const trimmed = brief.trim()
  if (trimmed.length <= BRIEF_SUMMARY_LIMIT) return trimmed
  return `${trimmed.slice(0, BRIEF_SUMMARY_LIMIT)}…`
}

function requireGroupId(groupId: string | undefined): string {
  if (groupId === undefined || groupId.trim() === '') {
    throw new Error('groupId is required: pass the group id to scope the query')
  }
  return groupId
}

/** Resolve the executor participant whose name contains `executorName`. */
async function resolveExecutor(
  client: CoAgentHubClient,
  executorName: string | undefined,
): Promise<Participant> {
  const wanted = (executorName ?? DEFAULT_EXECUTOR_NAME).trim()
  const participants = await client.listParticipants()
  const match = participants.find(participant => participant.name.includes(wanted))
  if (match !== undefined) return match
  const available = participants.map(participant => participant.name).join(', ') || '(none)'
  throw new Error(`no participant named like "${wanted}"; available participants: ${available}`)
}

const PARTICIPANT_VIEW_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: { type: 'string', required: true },
    name: { type: 'string', required: true },
    type: { type: 'string', required: true, enum: ['executor', 'local', 'participant'] },
    device: { oneOf: [{ type: 'string' }, { type: 'null' }], required: true },
    online: { type: 'boolean', required: true },
    lastSeen: { oneOf: [{ type: 'string' }, { type: 'null' }], required: true },
  },
} as const

const GROUP_VIEW_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: { type: 'string', required: true },
    title: { type: 'string', required: true },
    status: { type: 'string', required: true },
  },
} as const

const MESSAGE_VIEW_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: { type: 'string', required: true },
    senderId: { type: 'string', required: true },
    audience: { oneOf: [{ type: 'string' }, { type: 'null' }], required: true },
    audienceRef: { oneOf: [{ type: 'string' }, { type: 'null' }], required: true },
    body: { type: 'string', required: true },
    createdAt: { type: 'string', required: true },
  },
} as const

const TASK_VIEW_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: { type: 'string', required: true },
    groupId: { type: 'string', required: true },
    status: { type: 'string', required: true },
    executorParticipantId: { type: 'string', required: true },
    executorName: { type: 'string', required: true },
    summary: { type: 'string', required: true },
    createdAt: { type: 'string', required: true },
    updatedAt: { type: 'string', required: true },
  },
} as const

const GROUP_LIST_VIEW_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: { type: 'string', required: true },
    title: { type: 'string', required: true },
    status: { type: 'string', required: true },
    projectPath: { oneOf: [{ type: 'string' }, { type: 'null' }] },
  },
} as const

const GROUP_DETAIL_VIEW_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: { type: 'string', required: true },
    title: { type: 'string', required: true },
    status: { type: 'string', required: true },
    projectPath: { oneOf: [{ type: 'string' }, { type: 'null' }] },
    members: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          id: { type: 'string', required: true },
          name: { type: 'string', required: true },
          device: { oneOf: [{ type: 'string' }, { type: 'null' }] },
        },
      },
    },
  },
} as const

const EXECUTOR_VIEW_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    key: { type: 'string', required: true },
    agentName: { type: 'string', required: true },
    kind: { oneOf: [{ type: 'string' }, { type: 'null' }] },
    bin: { oneOf: [{ type: 'string' }, { type: 'null' }] },
    url: { oneOf: [{ type: 'string' }, { type: 'null' }] },
    model: { oneOf: [{ type: 'string' }, { type: 'null' }] },
    device: { oneOf: [{ type: 'string' }, { type: 'null' }] },
    online: { oneOf: [{ type: 'boolean' }, { type: 'null' }] },
  },
} as const

const TASK_DETAIL_VIEW_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: { type: 'string', required: true },
    status: { type: 'string', required: true },
    executorParticipantId: { type: 'string', required: true },
    executorName: { type: 'string', required: true },
    brief: { type: 'string', required: true },
    createdAt: { type: 'string', required: true },
    updatedAt: { type: 'string', required: true },
    retryCount: { type: 'number', required: true },
    attempts: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          n: { type: 'number', required: true },
          startedAt: { type: 'string', required: true },
          endedAt: { oneOf: [{ type: 'string' }, { type: 'null' }], required: true },
          status: { type: 'string', required: true },
          error: { oneOf: [{ type: 'string' }, { type: 'null' }], required: true },
          summary: { oneOf: [{ type: 'string' }, { type: 'null' }], required: true },
          hash: { oneOf: [{ type: 'string' }, { type: 'null' }], required: true },
        },
      },
    },
    diffSummary: {
      oneOf: [
        {
          type: 'object',
          additionalProperties: false,
          properties: {
            summary: { oneOf: [{ type: 'string' }, { type: 'null' }], required: true },
            hash: { oneOf: [{ type: 'string' }, { type: 'null' }], required: true },
            error: { oneOf: [{ type: 'string' }, { type: 'null' }], required: true },
          },
        },
        { type: 'null' },
      ],
      required: true,
    },
    outputTail: { oneOf: [{ type: 'string' }, { type: 'null' }] },
  },
} as const

const NOTIFICATION_VIEW_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    type: {
      type: 'string',
      required: true,
      enum: ['task.completed', 'task.failed', 'task.stalled', 'task.status_changed', 'message.received'],
    },
    groupId: { type: 'string', required: true },
    taskId: { type: 'string' },
    status: { type: 'string' },
    executorName: { type: 'string' },
    summary: { type: 'string' },
    time: { type: 'string', required: true },
  },
} as const

/** Build the seven CoAgentHub tool definitions against one client. */
export function createCoAgentHubTools(
  client: CoAgentHubClient,
  settingsStore?: CoAgentHubSettingsStore,
): ToolDefinition[] {
  return [
    defineTool({
      name: 'coagenthub_list_participants',
      description:
        'List CoAgentHub participants (id, name, type, device, online status). Useful to find an executor name before dispatching a task.',
      parameters: {},
      output: { schema: { type: 'array', items: PARTICIPANT_VIEW_SCHEMA } as const, render: renderValue },
      async execute() {
        const participants = await client.listParticipants()
        return participants.map(participantView)
      },
    }),

    defineTool({
      name: 'coagenthub_create_group',
      description: 'Create a CoAgentHub group and return its id and title.',
      parameters: {
        title: { type: 'string', required: true, description: 'Title of the new group.' },
      },
      output: { schema: GROUP_VIEW_SCHEMA, render: renderValue },
      async execute(args: { title: string }) {
        const group = await client.createGroup(args.title)
        return { id: group.id, title: group.title, status: group.status }
      },
    }),

    defineTool({
      name: 'coagenthub_post_message',
      description:
        'Post a message to a CoAgentHub group. Default audience is "broadcast"; use audience "participant" with audienceRef to address one participant.',
      parameters: {
        groupId: { type: 'string', required: true, description: 'Target group id.' },
        body: { type: 'string', required: true, description: 'Message body.' },
        audience: {
          type: 'string',
          enum: ['broadcast', 'role', 'participant'],
          default: 'broadcast',
          description: 'Message audience.',
        },
        audienceRef: { type: 'string', description: 'Participant id when audience is "participant".' },
      },
      output: { schema: MESSAGE_VIEW_SCHEMA, render: renderValue },
      async execute(args: {
        groupId: string
        body: string
        audience?: 'broadcast' | 'role' | 'participant'
        audienceRef?: string
      }) {
        const message = await client.postMessage(args.groupId, {
          body: args.body,
          audience: args.audience ?? 'broadcast',
          audienceRef: args.audienceRef,
        })
        return messageView(message)
      },
    }),

    defineTool({
      name: 'coagenthub_dispatch_task',
      description:
        'Dispatch a task to a CoAgentHub executor by sending a directed message: finds the participant whose name contains executorName (default "AtomCode") and sends audience="participant" with that participant id, which creates and schedules a task. Returns the message id. 若任务需求存在歧义(如效果/范围/验收不清晰),必须先向用户澄清要点,得到确认后再下发任务书。可选结构化字段 goal/scope/acceptance/tests/report/priority/dependencies 会被渲染进任务书;只传 body 时原样发送(完全兼容)。',
      parameters: {
        groupId: { type: 'string', required: true, description: 'Target group id.' },
        body: { type: 'string', required: true, description: 'Task brief sent to the executor (plain text, kept verbatim).' },
        executorName: {
          type: 'string',
          default: DEFAULT_EXECUTOR_NAME,
          description: 'Name fragment matching an executor participant, e.g. "AtomCode" or "Reasoning".',
        },
        goal: { type: 'string', description: '目标:要达成的结果。' },
        scope: { type: 'string', description: '范围:涉及/不涉及的边界。' },
        acceptance: { type: 'string', description: '验收标准:可验证的完成条件。' },
        tests: { type: 'string', description: '测试要求:需要满足的测试约束。' },
        report: { type: 'string', description: '汇报格式:完成后如何汇报。' },
        priority: { type: 'string', description: '优先级:相对紧急程度。' },
        dependencies: { type: 'string', description: '依赖:前置条件或依赖项。' },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            messageId: { type: 'string', required: true },
            executorParticipantId: { type: 'string', required: true },
            executorName: { type: 'string', required: true },
          },
        } as const,
        render: renderValue,
      },
      async execute(args: {
        groupId: string
        body: string
        executorName?: string
        goal?: string
        scope?: string
        acceptance?: string
        tests?: string
        report?: string
        priority?: string
        dependencies?: string
      }) {
        const executor = await resolveExecutor(client, args.executorName)
        const taskBook = buildTaskBook({
          body: args.body,
          goal: args.goal,
          scope: args.scope,
          acceptance: args.acceptance,
          tests: args.tests,
          report: args.report,
          priority: args.priority,
          dependencies: args.dependencies,
        })
        const message = await client.postMessage(args.groupId, {
          body: taskBook,
          audience: 'participant',
          audienceRef: executor.id,
        })
        return {
          messageId: message.id,
          executorParticipantId: executor.id,
          executorName: executor.name,
        }
      },
    }),

    defineTool({
      name: 'coagenthub_list_tasks',
      description:
        'List tasks of a CoAgentHub group (id, status, executor, summary, timestamps). groupId is required by the API.',
      parameters: {
        groupId: { type: 'string', description: 'Target group id (required by the CoAgentHub API).' },
      },
      output: { schema: { type: 'array', items: TASK_VIEW_SCHEMA } as const, render: renderValue },
      async execute(args: { groupId?: string }, _exec: ToolRunContext) {
        const groupId = requireGroupId(args.groupId)
        const [tasks, participants] = await Promise.all([client.listTasks(groupId), client.listParticipants()])
        const nameById = new Map(participants.map(participant => [participant.id, participant.name]))
        return tasks.map(task => ({
          id: task.id,
          groupId: task.groupId,
          status: task.status,
          executorParticipantId: task.executorParticipantId,
          executorName: nameById.get(task.executorParticipantId) ?? task.executorParticipantId,
          summary: summarizeBrief(task.brief),
          createdAt: task.createdAt,
          updatedAt: task.updatedAt,
        }))
      },
    }),

    defineTool({
      name: 'coagenthub_get_messages',
      description:
        'List messages of a CoAgentHub group, newest first. Pass `after` (ISO 8601 timestamp) to fetch only messages created after it (incremental sync).',
      parameters: {
        groupId: { type: 'string', required: true, description: 'Target group id.' },
        after: { type: 'string', description: 'ISO 8601 timestamp; only messages created after it are returned.' },
      },
      output: { schema: { type: 'array', items: MESSAGE_VIEW_SCHEMA } as const, render: renderValue },
      async execute(args: { groupId: string; after?: string }) {
        const messages = await client.listMessages(args.groupId)
        const afterMs = args.after === undefined ? undefined : Date.parse(args.after)
        const filtered = afterMs === undefined || Number.isNaN(afterMs)
          ? messages
          : messages.filter(message => Date.parse(message.createdAt) > afterMs)
        return [...filtered]
          .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
          .map(messageView)
      },
    }),

    defineTool({
      name: 'coagenthub_get_active_group',
      description:
        'Return the currently selected CoAgentHub virtual workspace (the group chosen in the panel 当前工作区 dropdown) as { groupId, groupTitle, projectPath?, winPath?, instructions? }; null when nothing is selected. Useful to scope a task or message to the user\'s active group.',
      parameters: {},
      output: {
        schema: {
          oneOf: [
            {
              type: 'object',
              additionalProperties: false,
              properties: {
                groupId: { type: 'string', required: true },
                groupTitle: { type: 'string', required: true },
                projectPath: { oneOf: [{ type: 'string' }, { type: 'null' }] },
                winPath: { oneOf: [{ type: 'string' }, { type: 'null' }] },
                instructions: { oneOf: [{ type: 'string' }, { type: 'null' }] },
              },
            },
            { type: 'null' },
          ],
        } as const,
        render: renderValue,
      },
      async execute(_args: Record<string, never>, exec: ToolRunContext) {
        const activeGroupId = settingsStore?.get().activeGroupId
        if (activeGroupId === undefined || activeGroupId.trim() === '') return null
        const groups = await client.listGroups(100)
        const group = groups.items.find(candidate => candidate.id === activeGroupId)
        if (group === undefined) return null
        const mappingRule = settingsStore?.get().mappingRule
        const winPath = group.projectPath != null && mappingRule !== undefined
          ? projectToWinPath(group.projectPath, mappingRule.macPrefix, mappingRule.winPrefix)
          : null
        const instructions = await readWorkspaceInstructions(workspaceRootFromExec(exec))
        return {
          groupId: group.id,
          groupTitle: group.title,
          projectPath: group.projectPath ?? null,
          winPath,
          instructions,
        }
      },
    }),

    defineTool({
      name: 'coagenthub_get_workspace_instructions',
      description:
        'Return the workspace-level instructions for the current session: reads COAGENTHUB.md from the current dsh workspace root and pairs it with the active group id/title. 非插件工作区(无 COAGENTHUB.md)返回 instructions: null.',
      parameters: {},
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            groupId: { oneOf: [{ type: 'string' }, { type: 'null' }], required: true },
            groupTitle: { oneOf: [{ type: 'string' }, { type: 'null' }], required: true },
            instructions: { oneOf: [{ type: 'string' }, { type: 'null' }], required: true },
          },
        } as const,
        render: renderValue,
      },
      async execute(_args: Record<string, never>, exec: ToolRunContext) {
        const activeGroupId = settingsStore?.get().activeGroupId
        let groupId: string | null = null
        let groupTitle: string | null = null
        if (activeGroupId !== undefined && activeGroupId.trim() !== '') {
          const groups = await client.listGroups(100)
          const group = groups.items.find(candidate => candidate.id === activeGroupId)
          if (group !== undefined) {
            groupId = group.id
            groupTitle = group.title
          }
        }
        const instructions = await readWorkspaceInstructions(workspaceRootFromExec(exec))
        return { groupId, groupTitle, instructions }
      },
    }),

    defineTool({
      name: 'coagenthub_list_groups',
      description:
        'List CoAgentHub groups (id, title, status, projectPath). Optionally filter by status (active | archived); limit defaults to 100.',
      parameters: {
        limit: { type: 'number', default: 100, description: 'Max groups to return (default 100).' },
        status: { type: 'string', enum: ['active', 'archived'], description: 'Optional status filter.' },
      },
      output: { schema: { type: 'array', items: GROUP_LIST_VIEW_SCHEMA } as const, render: renderValue },
      async execute(args: { limit?: number; status?: 'active' | 'archived' }) {
        const limit = args.limit ?? 100
        // 带 status 过滤时先取全量再过滤、后按 limit 截断,避免服务端 limit
        // 作用在未过滤列表上导致符合条件的群被漏掉。
        const { items } = args.status === undefined
          ? await client.listGroups(limit)
          : await client.listGroups()
        const filtered = args.status === undefined
          ? items
          : items.filter(group => group.status === args.status).slice(0, limit)
        return filtered.map(group => ({
          id: group.id,
          title: group.title,
          status: group.status,
          projectPath: group.projectPath ?? undefined,
        }))
      },
    }),

    defineTool({
      name: 'coagenthub_get_group',
      description:
        'Fetch one CoAgentHub group by id (id, title, status, projectPath, members).',
      parameters: {
        groupId: { type: 'string', required: true, description: 'Target group id.' },
      },
      output: { schema: GROUP_DETAIL_VIEW_SCHEMA, render: renderValue },
      async execute(args: { groupId: string }) {
        const group = await client.getGroup(args.groupId)
        return {
          id: group.id,
          title: group.title,
          status: group.status,
          projectPath: group.projectPath ?? undefined,
          members: group.members,
        }
      },
    }),

    defineTool({
      name: 'coagenthub_list_executors',
      description:
        'List registered CoAgentHub executors (key, agentName, kind, bin, url, model, device, online). Useful to pick an executor before dispatching.',
      parameters: {},
      output: { schema: { type: 'array', items: EXECUTOR_VIEW_SCHEMA } as const, render: renderValue },
      async execute() {
        const executors = await client.listExecutors()
        return executors.map(executor => ({
          key: executor.key,
          agentName: executor.agentName,
          kind: executor.kind ?? undefined,
          bin: executor.bin ?? undefined,
          url: executor.url ?? undefined,
          model: executor.model ?? undefined,
          device: executor.device ?? undefined,
          online: executor.online ?? undefined,
        }))
      },
    }),

    defineTool({
      name: 'coagenthub_get_task',
      description:
        'Fetch one task of a CoAgentHub group (id, status, executor, brief, retryCount, attempts, diffSummary, outputTail). Prefers the single-task endpoint and falls back to listing tasks.',
      parameters: {
        groupId: { type: 'string', required: true, description: 'Target group id.' },
        taskId: { type: 'string', required: true, description: 'Task id.' },
      },
      output: { schema: TASK_DETAIL_VIEW_SCHEMA, render: renderValue },
      async execute(args: { groupId: string; taskId: string }) {
        const [task, participants] = await Promise.all([
          client.getTask(args.groupId, args.taskId),
          client.listParticipants(),
        ])
        const nameById = new Map(participants.map(participant => [participant.id, participant.name]))
        return {
          id: task.id,
          status: task.status,
          executorParticipantId: task.executorParticipantId,
          executorName: nameById.get(task.executorParticipantId) ?? task.executorParticipantId,
          brief: task.brief,
          createdAt: task.createdAt,
          updatedAt: task.updatedAt,
          retryCount: task.retryCount,
          attempts: task.attempts ?? [],
          diffSummary: task.diffSummary,
          outputTail: task.diffSummary?.outputTail ?? undefined,
        }
      },
    }),

    defineTool({
      name: 'coagenthub_get_notifications',
      description:
        'Return and clear the pending CoAgentHub notifications (task completed / failed / stalled / status changed / new message). Use to catch up on background events instead of polling.',
      parameters: {},
      output: { schema: { type: 'array', items: NOTIFICATION_VIEW_SCHEMA } as const, render: renderValue },
      async execute() {
        return notificationQueue.drain()
      },
    }),
  ]
}

/** Register the seven CoAgentHub tools on a dsh tools runtime. */
export function registerCoAgentHubTools(
  ctx: Context,
  client: CoAgentHubClient,
  settingsStore?: CoAgentHubSettingsStore,
): () => void {
  const disposers = createCoAgentHubTools(client, settingsStore).map(definition => ctx.tools.register(definition))
  return () => {
    for (const dispose of disposers) dispose()
  }
}
