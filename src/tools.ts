/**
 * CoAgentHub tools for the dsh agent: list participants, create groups, post
 * messages, dispatch tasks to executors, query tasks and messages.
 * @module @laizhixingxingdeli/dsh-coagenthub/tools
 */

import type { Context } from '@deepseek-ai/cordis'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolDefinition, ToolRunContext } from '@deepseek-ai/dsh-tools'
import { CoAgentHubClient, CoAgentHubError, CoAgentHubFetchError } from './client.ts'
import type { Message, Participant } from './client.ts'
import type { CoAgentHubSettingsStore } from './config.ts'
import { notificationQueue } from './notification-queue.ts'
import { buildTaskBook } from './task-book.ts'
import { findGroupByWorkspaceCwd, groupProjectWinPath } from './workspace.ts'
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

function summarizeBrief(brief: string | null | undefined): string {
  const trimmed = (brief ?? '').trim()
  if (trimmed.length <= BRIEF_SUMMARY_LIMIT) return trimmed
  return `${trimmed.slice(0, BRIEF_SUMMARY_LIMIT)}…`
}

/** Extract a readable message from an error response body (JSON envelope or raw text). */
function serverErrorMessage(error: CoAgentHubError): string {
  const body = error.bodySummary.trim()
  if (body === '') return ''
  if (body.startsWith('{')) {
    try {
      const parsed = JSON.parse(body) as Record<string, unknown>
      const message = parsed.error ?? parsed.message
      if (typeof message === 'string' && message.trim() !== '') return message
    } catch {
      // fall through to the raw text
    }
  }
  return body
}

const GROUP_ID_DESCRIPTION =
  'Target group id. 可选:不传时自动回填(当前工作区 cwd 反查 → activeGroupId 兜底)。'

/**
 * Resolve the group a tool should operate on: an explicit groupId wins, then a
 * cwd-based backfill through the workspace mapping, then the stored
 * activeGroupId as a last fallback. Throws a clear error when nothing
 * resolves so the agent passes an explicit groupId.
 */
async function resolveGroupId(
  args: { groupId?: string },
  exec: ToolRunContext,
  client: CoAgentHubClient,
  settingsStore: CoAgentHubSettingsStore | undefined,
): Promise<string> {
  const settings = settingsStore?.get()
  if (args.groupId !== undefined && args.groupId.trim() !== '') return args.groupId
  const matched = findGroupByWorkspaceCwd(
    (await client.listGroups(100)).items,
    workspaceRootFromExec(exec),
    settings?.mappingRule,
  )
  if (matched !== null) return matched.id
  if (settings?.activeGroupId !== undefined && settings.activeGroupId.trim() !== '') return settings.activeGroupId
  throw new Error('未指定 groupId，且无法从当前工作区识别群；请手动传 groupId')
}

/**
 * Convert a client-level failure into a clear tool-facing error:
 * 404 → a specific not-found message, other HTTP statuses → status + server
 * reason, network failures → a connection message. CoAgentHubError /
 * CoAgentHubFetchError are converted; any other unexpected error is re-thrown
 * as-is (matches the existing per-tool catch blocks).
 */
function throwToolError(error: unknown, notFoundMessage: string): never {
  if (error instanceof CoAgentHubError) {
    if (error.status === 404) throw new Error(notFoundMessage)
    const reason = serverErrorMessage(error)
    throw new Error(
      reason === ''
        ? `CoAgentHub API 错误(${error.status})`
        : `CoAgentHub API 错误(${error.status}): ${reason}`,
    )
  }
  if (error instanceof CoAgentHubFetchError) {
    throw new Error(`无法连接 CoAgentHub 服务: ${error.message}`)
  }
  throw error
}

/**
 * Normalize a member's `roles` to a string array: arrays pass through, a
 * single string is wrapped (server may send one role as a string), anything
 * else (missing/null) becomes an empty array — never `undefined`.
 */
function normalizeMemberRoles(roles: string[] | string | null | undefined): string[] {
  if (Array.isArray(roles)) return roles
  if (typeof roles === 'string') return [roles]
  return []
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

const GROUP_MEMBER_VIEW_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    participantId: { type: 'string', required: true },
    name: { type: 'string', required: true },
    device: { oneOf: [{ type: 'string' }, { type: 'null' }], required: true },
    roles: { type: 'array', items: { type: 'string' }, required: true },
    prompt: { oneOf: [{ type: 'string' }, { type: 'null' }], required: true },
    joinedAt: { oneOf: [{ type: 'string' }, { type: 'null' }], required: true },
  },
} as const

const GROUP_UPDATE_VIEW_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: { type: 'string', required: true },
    title: { type: 'string', required: true },
    status: { type: 'string', required: true },
    projectPath: { oneOf: [{ type: 'string' }, { type: 'null' }], required: true },
  },
} as const

const REMOVE_MEMBER_VIEW_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    ok: { type: 'boolean', required: true },
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

const TASK_UPDATE_VIEW_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: { type: 'string', required: true },
    groupId: { type: 'string', required: true },
    status: { type: 'string', required: true },
    executorParticipantId: { type: 'string', required: true },
    executorName: { type: 'string', required: true },
    brief: { type: 'string', required: true },
    createdAt: { type: 'string', required: true },
    updatedAt: { type: 'string', required: true },
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
    taskId: { oneOf: [{ type: 'string' }, { type: 'null' }] },
    status: { oneOf: [{ type: 'string' }, { type: 'null' }] },
    executorName: { oneOf: [{ type: 'string' }, { type: 'null' }] },
    summary: { oneOf: [{ type: 'string' }, { type: 'null' }] },
    time: { type: 'string', required: true },
  },
} as const

/** Build the eight CoAgentHub tool definitions against one client. */
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
        try {
          const participants = await client.listParticipants()
          return participants.map(participantView)
        } catch (error) {
          throwToolError(error, '参与者列表不可用(404)')
        }
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
        try {
          const group = await client.createGroup(args.title)
          return { id: group.id, title: group.title, status: group.status }
        } catch (error) {
          throwToolError(error, '群创建失败(404)')
        }
      },
    }),

    defineTool({
      name: 'coagenthub_post_message',
      description:
        'Post a message to a CoAgentHub group. Default audience is "broadcast"; use audience "participant" with audienceRef to address one participant.',
      parameters: {
        groupId: { type: 'string', description: GROUP_ID_DESCRIPTION },
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
        groupId?: string
        body: string
        audience?: 'broadcast' | 'role' | 'participant'
        audienceRef?: string
      }, exec: ToolRunContext) {
        try {
          const groupId = await resolveGroupId(args, exec, client, settingsStore)
          const message = await client.postMessage(groupId, {
            body: args.body,
            audience: args.audience ?? 'broadcast',
            audienceRef: args.audienceRef,
          })
          return messageView(message)
        } catch (error) {
          throwToolError(error, '群组不存在(404)')
        }
      },
    }),

    defineTool({
      name: 'coagenthub_dispatch_task',
      description:
        'Dispatch a task to a CoAgentHub executor by sending a directed message: finds the participant whose name contains executorName (default "AtomCode") and sends audience="participant" with that participant id, which creates and schedules a task. Returns the message id. groupId 可选:不传时按当前工作区 cwd 反查匹配群,否则用活动群(activeGroupId)兜底;都找不到会报错提示手动传 groupId。若任务需求存在歧义(如效果/范围/验收不清晰),必须先向用户澄清要点,得到确认后再下发任务书。可选结构化字段 goal/scope/acceptance/tests/report/priority/dependencies 会被渲染进任务书;只传 body 时原样发送(完全兼容)。',
      parameters: {
        groupId: { type: 'string', description: 'Target group id. 可选:不传时自动回填(当前工作区 cwd 反查 → activeGroupId 兜底)。' },
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
        groupId?: string
        body: string
        executorName?: string
        goal?: string
        scope?: string
        acceptance?: string
        tests?: string
        report?: string
        priority?: string
        dependencies?: string
      }, exec: ToolRunContext) {
        // groupId 可选:显式传值优先,否则依次用当前工作区 cwd 反查、activeGroupId 兜底。
        const groupId = await resolveGroupId(args, exec, client, settingsStore)
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
        try {
          const message = await client.postMessage(groupId, {
            body: taskBook,
            audience: 'participant',
            audienceRef: executor.id,
          })
          return {
            messageId: message.id,
            executorParticipantId: executor.id,
            executorName: executor.name,
          }
        } catch (error) {
          if (error instanceof CoAgentHubError && error.status === 403) {
            throw new Error('无权限发布任务：需要 coordinator/human 身份')
          }
          throwToolError(error, '群组不存在(404)')
        }
      },
    }),

    defineTool({
      name: 'coagenthub_list_tasks',
      description:
        'List tasks of a CoAgentHub group (id, status, executor, summary, timestamps).',
      parameters: {
        groupId: { type: 'string', description: GROUP_ID_DESCRIPTION },
      },
      output: { schema: { type: 'array', items: TASK_VIEW_SCHEMA } as const, render: renderValue },
      async execute(args: { groupId?: string }, exec: ToolRunContext) {
        try {
          const groupId = await resolveGroupId(args, exec, client, settingsStore)
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
        } catch (error) {
          throwToolError(error, '群组不存在(404)')
        }
      },
    }),

    defineTool({
      name: 'coagenthub_get_messages',
      description:
        'List messages of a CoAgentHub group, newest first. Pass `after` (ISO 8601 timestamp) to fetch only messages created after it (incremental sync).',
      parameters: {
        groupId: { type: 'string', description: GROUP_ID_DESCRIPTION },
        after: { type: 'string', description: 'ISO 8601 timestamp; only messages created after it are returned.' },
      },
      output: { schema: { type: 'array', items: MESSAGE_VIEW_SCHEMA } as const, render: renderValue },
      async execute(args: { groupId?: string; after?: string }, exec: ToolRunContext) {
        try {
          const groupId = await resolveGroupId(args, exec, client, settingsStore)
          const messages = await client.listMessages(groupId)
          const afterMs = args.after === undefined ? undefined : Date.parse(args.after)
          const filtered = afterMs === undefined || Number.isNaN(afterMs)
            ? messages
            : messages.filter(message => Date.parse(message.createdAt) > afterMs)
          return [...filtered]
            .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
            .map(messageView)
        } catch (error) {
          throwToolError(error, '群组不存在(404)')
        }
      },
    }),

    defineTool({
      name: 'coagenthub_get_active_group',
      description:
        'Resolve the CoAgentHub virtual workspace for the current session: the group matched from the session cwd via the workspace mapping, falling back to the group selected in the panel 当前工作区 dropdown (activeGroupId) when cwd matches nothing. Returns { groupId, groupTitle, projectPath?, winPath?, instructions? }; null when nothing resolves. Useful to scope a task or message to the user\'s workspace group.',
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
        try {
          const settings = settingsStore?.get()
          const activeGroupId = settings?.activeGroupId
          const cwd = workspaceRootFromExec(exec)
          const groups = await client.listGroups(100)
          const group = findGroupByWorkspaceCwd(groups.items, cwd, settings?.mappingRule)
            ?? (activeGroupId !== undefined && activeGroupId.trim() !== ''
              ? groups.items.find(candidate => candidate.id === activeGroupId) ?? undefined
              : undefined)
          if (group === undefined) return null
          const winPath = groupProjectWinPath(group.projectPath, settings?.mappingRule)
          const instructions = await readWorkspaceInstructions(cwd)
          return {
            groupId: group.id,
            groupTitle: group.title,
            projectPath: group.projectPath ?? null,
            winPath,
            instructions,
          }
        } catch (error) {
          throwToolError(error, '当前工作区不可用(404)')
        }
      },
    }),

    defineTool({
      name: 'coagenthub_get_workspace_instructions',
      description:
        'Return the workspace-level instructions for the current session: reads COAGENTHUB.md from the current dsh workspace root and pairs it with the group resolved from the session cwd (falling back to the active group id/title). 非插件工作区(无 COAGENTHUB.md)返回 instructions: null.',
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
        try {
          const settings = settingsStore?.get()
          const activeGroupId = settings?.activeGroupId
          const cwd = workspaceRootFromExec(exec)
          let groupId: string | null = null
          let groupTitle: string | null = null
          const groups = await client.listGroups(100)
          const group = findGroupByWorkspaceCwd(groups.items, cwd, settings?.mappingRule)
            ?? (activeGroupId !== undefined && activeGroupId.trim() !== ''
              ? groups.items.find(candidate => candidate.id === activeGroupId) ?? undefined
              : undefined)
          if (group !== undefined) {
            groupId = group.id
            groupTitle = group.title
          }
          const instructions = await readWorkspaceInstructions(cwd)
          return { groupId, groupTitle, instructions }
        } catch (error) {
          throwToolError(error, '工作区指令不可用(404)')
        }
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
        try {
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
            projectPath: group.projectPath ?? null,
          }))
        } catch (error) {
          throwToolError(error, '群列表不可用(404)')
        }
      },
    }),

    defineTool({
      name: 'coagenthub_get_group',
      description:
        'Fetch one CoAgentHub group by id (id, title, status, projectPath, members).',
      parameters: {
        groupId: { type: 'string', description: GROUP_ID_DESCRIPTION },
      },
      output: { schema: GROUP_DETAIL_VIEW_SCHEMA, render: renderValue },
      async execute(args: { groupId?: string }, exec: ToolRunContext) {
        try {
          const groupId = await resolveGroupId(args, exec, client, settingsStore)
          const group = await client.getGroup(groupId)
          // members 归一化:每项 { id, name, device },缺失字段补 null,
          // 避免返回对象携带 undefined 字段触发 lossless JSON 校验失败。
          return {
            id: group.id,
            title: group.title,
            status: group.status,
            projectPath: group.projectPath ?? null,
            members: (group.members ?? []).map(member => ({
              id: member.id,
              name: member.name,
              device: member.device ?? null,
            })),
          }
        } catch (error) {
          throwToolError(error, '群组不存在(404)')
        }
      },
    }),

    defineTool({
      name: 'coagenthub_get_group_members',
      description:
        'List members of a CoAgentHub group with their roles and 分工 prompt (participantId, name, device, roles, prompt, joinedAt). Useful to read who is in a group and what each member is assigned to do.',
      parameters: {
        groupId: { type: 'string', description: GROUP_ID_DESCRIPTION },
      },
      output: { schema: { type: 'array', items: GROUP_MEMBER_VIEW_SCHEMA } as const, render: renderValue },
      async execute(args: { groupId?: string }, exec: ToolRunContext) {
        const groupId = await resolveGroupId(args, exec, client, settingsStore)
        try {
          const members = await client.getGroupMembers(groupId)
          // 归一化:缺失的 device/prompt/joinedAt 补 null、roles 兜底为数组,
          // 避免返回对象携带 undefined 字段触发 lossless JSON 校验失败。
          return members.map(member => ({
            participantId: member.participantId,
            name: member.name,
            device: member.device ?? null,
            roles: normalizeMemberRoles(member.roles),
            prompt: member.prompt ?? null,
            joinedAt: member.joinedAt ?? null,
          }))
        } catch (error) {
          // 404 可能表示群不存在,也可能表示服务端未实现该成员接口,两者都给出清晰提示。
          throwToolError(error, '群组不存在或成员接口不可用(404)')
        }
      },
    }),

    defineTool({
      name: 'coagenthub_update_group',
      description:
        'Update a CoAgentHub group: change its title and/or its project binding (projectPath). Pass projectPath as an empty string to clear the binding, or as a non-empty path to set it. groupId 可选(自动回填),至少 title / projectPath 传一个。',
      parameters: {
        groupId: { type: 'string', description: GROUP_ID_DESCRIPTION },
        title: { type: 'string', description: 'New group title.' },
        projectPath: {
          type: 'string',
          description: 'Project path to bind; empty string clears the binding (projectPath: null).',
        },
      },
      output: { schema: GROUP_UPDATE_VIEW_SCHEMA, render: renderValue },
      async execute(args: { groupId?: string; title?: string; projectPath?: string }, exec: ToolRunContext) {
        if (args.title === undefined && args.projectPath === undefined) {
          throw new Error('title 和 projectPath 至少传一个:请提供要修改的字段')
        }
        const groupId = await resolveGroupId(args, exec, client, settingsStore)
        const patch: { title?: string; projectPath?: string | null } = {}
        if (args.title !== undefined) patch.title = args.title
        if (args.projectPath !== undefined) {
          const path = args.projectPath.trim()
          patch.projectPath = path === '' ? null : path
        }
        try {
          const group = await client.updateGroup(groupId, patch)
          return {
            id: group.id,
            title: group.title,
            status: group.status,
            projectPath: group.projectPath ?? null,
          }
        } catch (error) {
          throwToolError(error, '群组不存在(404)')
        }
      },
    }),

    defineTool({
      name: 'coagenthub_add_group_member',
      description:
        'Add a member to a CoAgentHub group with optional roles (default ["executor"]) and return the server member row (participantId, name, device, roles, prompt, joinedAt).',
      parameters: {
        groupId: { type: 'string', description: GROUP_ID_DESCRIPTION },
        participantId: { type: 'string', required: true, description: 'Participant id of the member to add.' },
        roles: {
          type: 'array',
          items: { type: 'string' },
          default: ['executor'],
          description: 'Roles for the new member (default ["executor"]).',
        },
      },
      output: { schema: GROUP_MEMBER_VIEW_SCHEMA, render: renderValue },
      async execute(args: { groupId?: string; participantId: string; roles?: string[] }, exec: ToolRunContext) {
        try {
          const groupId = await resolveGroupId(args, exec, client, settingsStore)
          const member = await client.addGroupMember(groupId, {
            participantId: args.participantId,
            roles: args.roles === undefined ? ['executor'] : args.roles,
          })
          // 归一化:缺失的 device/prompt/joinedAt 补 null、roles 兜底为数组,
          // 避免返回对象携带 undefined 字段触发 lossless JSON 校验失败。
          return {
            participantId: member.participantId,
            name: member.name,
            device: member.device ?? null,
            roles: normalizeMemberRoles(member.roles),
            prompt: member.prompt ?? null,
            joinedAt: member.joinedAt ?? null,
          }
        } catch (error) {
          throwToolError(error, '群组或成员不存在(404)')
        }
      },
    }),

    defineTool({
      name: 'coagenthub_remove_group_member',
      description:
        'Remove a member from a CoAgentHub group by participant id. Returns { ok: true } on success; a missing member or group yields a clear 404 error.',
      parameters: {
        groupId: { type: 'string', description: GROUP_ID_DESCRIPTION },
        participantId: { type: 'string', required: true, description: 'Participant id of the member to remove.' },
      },
      output: { schema: REMOVE_MEMBER_VIEW_SCHEMA, render: renderValue },
      async execute(args: { groupId?: string; participantId: string }, exec: ToolRunContext) {
        try {
          const groupId = await resolveGroupId(args, exec, client, settingsStore)
          await client.removeGroupMember(groupId, args.participantId)
          return { ok: true }
        } catch (error) {
          throwToolError(error, '成员或群组不存在(404):请检查 participantId 与 groupId')
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
        try {
          const executors = await client.listExecutors()
          return executors.map(executor => ({
            key: executor.key,
            agentName: executor.agentName,
            kind: executor.kind ?? null,
            bin: executor.bin ?? null,
            url: executor.url ?? null,
            model: executor.model ?? null,
            device: executor.device ?? null,
            online: executor.online ?? null,
          }))
        } catch (error) {
          throwToolError(error, '执行器列表不可用(404)')
        }
      },
    }),

    defineTool({
      name: 'coagenthub_get_task',
      description:
        'Fetch one task of a CoAgentHub group (id, status, executor, brief, retryCount, attempts, diffSummary, outputTail). Prefers the single-task endpoint and falls back to listing tasks.',
      parameters: {
        groupId: { type: 'string', description: GROUP_ID_DESCRIPTION },
        taskId: { type: 'string', required: true, description: 'Task id.' },
      },
      output: { schema: TASK_DETAIL_VIEW_SCHEMA, render: renderValue },
      async execute(args: { groupId?: string; taskId: string }, exec: ToolRunContext) {
        try {
          const groupId = await resolveGroupId(args, exec, client, settingsStore)
          const [task, participants] = await Promise.all([
            client.getTask(groupId, args.taskId),
            client.listParticipants(),
          ])
          const nameById = new Map(participants.map(participant => [participant.id, participant.name]))
          // 归一化后再返回:attempts 各项的 error/summary/hash 缺省时补 null
          // (schema 中 required: true,字段缺失会违反;值为 null 则不违反),
          // diffSummary 只保留 schema 声明的字段(outputTail 提到顶层)。
          return {
            id: task.id,
            status: task.status,
            executorParticipantId: task.executorParticipantId,
            executorName: nameById.get(task.executorParticipantId) ?? task.executorParticipantId,
            brief: task.brief,
            createdAt: task.createdAt,
            updatedAt: task.updatedAt,
            retryCount: task.retryCount,
            attempts: (task.attempts ?? []).map(attempt => ({
              n: attempt.n,
              startedAt: attempt.startedAt,
              endedAt: attempt.endedAt ?? null,
              status: attempt.status,
              error: attempt.error ?? null,
              summary: attempt.summary ?? null,
              hash: attempt.hash ?? null,
            })),
            diffSummary: task.diffSummary === null || task.diffSummary === undefined
              ? null
              : {
                  summary: task.diffSummary.summary ?? null,
                  hash: task.diffSummary.hash ?? null,
                  error: task.diffSummary.error ?? null,
                },
            outputTail: task.diffSummary?.outputTail ?? null,
          }
        } catch (error) {
          throwToolError(error, '任务或群组不存在(404)')
        }
      },
    }),

    defineTool({
      name: 'coagenthub_update_task',
      description:
        'Update a CoAgentHub task brief before the task starts executing (PATCH). The server rejects with 409 when the task is no longer in a modifiable (queued) state and with 403 when the caller lacks permission.',
      parameters: {
        groupId: { type: 'string', description: GROUP_ID_DESCRIPTION },
        taskId: { type: 'string', required: true, description: 'Task id.' },
        brief: { type: 'string', required: true, description: 'The new full task brief, replacing the previous one.' },
      },
      output: { schema: TASK_UPDATE_VIEW_SCHEMA, render: renderValue },
      async execute(args: { groupId?: string; taskId: string; brief: string }, exec: ToolRunContext) {
        try {
          const groupId = await resolveGroupId(args, exec, client, settingsStore)
          const [task, participants] = await Promise.all([
            client.updateTaskBrief(groupId, args.taskId, args.brief),
            client.listParticipants(),
          ])
          const nameById = new Map(participants.map(participant => [participant.id, participant.name]))
          return {
            id: task.id,
            groupId: task.groupId,
            status: task.status,
            executorParticipantId: task.executorParticipantId,
            executorName: nameById.get(task.executorParticipantId) ?? task.executorParticipantId,
            brief: task.brief,
            createdAt: task.createdAt,
            updatedAt: task.updatedAt,
          }
        } catch (error) {
          if (error instanceof CoAgentHubError) {
            if (error.status === 409) {
              const reason = serverErrorMessage(error)
              throw new Error(reason === '' ? '任务书更新被拒绝(409):任务不在可修改状态' : reason)
            }
            if (error.status === 403) {
              const reason = serverErrorMessage(error)
              throw new Error(reason === '' ? '无权限修改任务书(403):需要协调者权限' : `无权限修改任务书(403): ${reason}`)
            }
          }
          throwToolError(error, '任务或群组不存在(404)')
        }
      },
    }),

    defineTool({
      name: 'coagenthub_get_notifications',
      description:
        'Return and clear the pending CoAgentHub notifications for the group resolved from the current session workspace (cwd → group; falls back to the active group setting). Notifications from other groups stay queued and do not leak into the current workspace. Use to catch up on background events instead of polling.',
      parameters: {},
      output: { schema: { type: 'array', items: NOTIFICATION_VIEW_SCHEMA } as const, render: renderValue },
      async execute(_args: Record<string, never>, exec: ToolRunContext) {
        try {
          // 通知按会话 cwd 反查群隔离:优先 cwd → 群,fallback settingsStore.activeGroupId。
          // 只 drain 该群的通知,其他群的通知保留在队列里(不会串到当前会话也不会丢失);
          // 反查不到群时返回空且不消费队列。
          const settings = settingsStore?.get()
          const cwd = workspaceRootFromExec(exec)
          const groups = await client.listGroups(100)
          const byCwd = findGroupByWorkspaceCwd(groups.items, cwd, settings?.mappingRule)
          const activeGroupId = settings?.activeGroupId
          const group = byCwd
            ?? (activeGroupId !== undefined && activeGroupId.trim() !== ''
              ? groups.items.find(candidate => candidate.id === activeGroupId) ?? null
              : null)
          if (group === null) return []
          const pending = notificationQueue.drainByGroup(group.id)
          // 归一化:drain() 结果中缺省的 taskId/status/executorName/summary 补 null,
          // 避免返回对象携带 undefined 字段触发 lossless JSON 校验失败。
          return pending.map(notification => ({
            type: notification.type,
            groupId: notification.groupId,
            taskId: notification.taskId ?? null,
            status: notification.status ?? null,
            executorName: notification.executorName ?? null,
            summary: notification.summary ?? null,
            time: notification.time,
          }))
        } catch (error) {
          throwToolError(error, '通知队列不可用')
        }
      },
    }),
  ]
}

/** Register the eight CoAgentHub tools on a dsh tools runtime. */
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
