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
import type { CoAgentHubSettings, CoAgentHubSettingsStore } from './config.ts'
import { notificationQueue } from './notification-queue.ts'
import { buildTaskBook } from './task-book.ts'
import type { GroupWithPath } from './workspace.ts'
import { findGroupByWorkspaceCwd, groupProjectWinPath } from './workspace.ts'
import type { LiveAgentCwdResolver, LiveAgentSessionIdResolver } from './workspace-instructions.ts'
import { readWorkspaceInstructions, sessionIdFromExec, workspaceRootFromExec } from './workspace-instructions.ts'

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
  'Target group id. 可选:不传时自动回填(当前会话 per-session 映射优先 → 当前工作区 cwd 反查兜底)。'

/**
 * Resolve the current session id for per-session workspace lookup: `exec` 的
 * `agent.session.id` 优先;exec 未携带 agent(web 客户端桥接 / SDK 直调)时回退
 * live root agent 的会话 id;两者都拿不到时返回 null(调用方回落全局
 * activeGroupId 兼容兜底 / 按 cwd 反查)。
 */
function currentSessionId(
  exec: ToolRunContext,
  resolveLiveAgentSessionId?: LiveAgentSessionIdResolver,
): string | null {
  const fromExec = sessionIdFromExec(exec)
  if (fromExec !== null) return fromExec
  if (resolveLiveAgentSessionId !== undefined) {
    try {
      const live = resolveLiveAgentSessionId()
      if (typeof live === 'string' && live.trim() !== '') return live
    } catch {
      // 解析器失败视为拿不到 sessionId,继续回落。
    }
  }
  return null
}

/**
 * Resolve the group a workspace tool should operate on: an explicit groupId
 * wins, then the current session's per-session mapping (sessionActiveGroups)
 * when it is set and still exists in the group list (面板按会话保存的工作区
 * 优先生效), then a cwd-based backfill through the workspace mapping. Throws a
 * clear error when nothing resolves so the agent passes an explicit groupId.
 *
 * 会话 cwd 统一解析:exec agent 优先,exec 拿不到时回退 live root agent
 * (resolveLiveAgentCwd,见 workspaceRootFromExec)——绝不回退 process.cwd(),
 * 避免常驻 web 进程把会话误判到 dsh 启动目录绑定的群。per-session 映射在
 * groups 里找不到时视为未设置(群可能被删除/换库),继续 cwd 兜底,不抛错。
 */
async function resolveGroupId(
  args: { groupId?: string },
  exec: ToolRunContext,
  client: CoAgentHubClient,
  settingsStore: CoAgentHubSettingsStore | undefined,
  resolveLiveAgentCwd?: LiveAgentCwdResolver,
  resolveLiveAgentSessionId?: LiveAgentSessionIdResolver,
): Promise<string> {
  if (args.groupId !== undefined && args.groupId.trim() !== '') return args.groupId
  const settings = settingsStore?.get()
  const groups = (await client.listGroups(100)).items
  const group = resolveWorkspaceGroup(
    groups,
    settings,
    workspaceRootFromExec(exec, resolveLiveAgentCwd),
    currentSessionId(exec, resolveLiveAgentSessionId),
  )
  if (group !== null) return group.id
  throw new Error('未指定 groupId，且无法从当前工作区识别群；请手动传 groupId')
}

/**
 * Resolve the group a workspace tool should operate on. 有会话 id 时:该会话的
 * per-session 映射(sessionActiveGroups[sessionId],非空且存在于群列表)优先;
 * 未命中/已失效直接按会话 cwd 反查,绝不回退全局 activeGroupId(避免跨会话
 * 污染)。无会话 id 时:全局 activeGroupId 作为兼容兜底(仅此场景),再按 cwd
 * 反查。Null when nothing resolves.
 *
 * per-session 值不存在于 groups 时视为未设置(群可能被删除/换库),继续 cwd
 * 兜底,不抛错——与「自动(按 cwd)」语义一致。
 */
function resolveWorkspaceGroup(
  groups: readonly GroupWithPath[],
  settings: CoAgentHubSettings | undefined,
  cwd: string | null,
  sessionId: string | null,
): GroupWithPath | null {
  if (sessionId !== null && sessionId.trim() !== '') {
    const perSession = settings?.sessionActiveGroups?.[sessionId]
    if (perSession !== undefined && perSession.trim() !== '') {
      const active = groups.find(candidate => candidate.id === perSession)
      if (active !== undefined) return active
    }
    return findGroupByWorkspaceCwd(groups, cwd, settings?.mappingRule)
  }
  const activeGroupId = settings?.activeGroupId
  if (activeGroupId !== undefined && activeGroupId.trim() !== '') {
    const active = groups.find(candidate => candidate.id === activeGroupId)
    if (active !== undefined) return active
  }
  return findGroupByWorkspaceCwd(groups, cwd, settings?.mappingRule)
}

/**
 * 读 workspace instructions 用的本地根路径:优先选中群的 winPath(映射后的本地
 * 路径),其次该群 projectPath,两者都拿不到(群未绑定路径)才退回会话 cwd。确保
 * 手动保存的工作区(per-session 映射)优先生效时不从与选中群无关的会话 cwd
 * 读取 COAGENTHUB.md。
 */
function workspaceInstructionsRoot(
  group: GroupWithPath,
  settings: CoAgentHubSettings | undefined,
  cwdFallback: string | null,
): string | null {
  const winPath = groupProjectWinPath(group.projectPath, settings?.mappingRule)
  if (winPath !== null && winPath.trim() !== '') return winPath
  if (group.projectPath !== null && group.projectPath !== undefined && group.projectPath.trim() !== '') return group.projectPath
  return cwdFallback
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

/**
 * Build the CoAgentHub tool definitions against one client. 会话 cwd 解析统一
 * 走 workspaceRootFromExec(exec agent 优先,其次 live root agent 回退);工具经
 * 非 agent 路径执行(web 客户端桥接 / SDK 直调)且 exec 未携带 agent 时,
 * resolveLiveAgentCwd 提供 dsh 运行时 root agent 的会话目录。per-session 映射
 * 按会话 id 查询:exec 的 agent.session.id 优先,缺失时回退 resolveLiveAgentSessionId
 * (root agent 会话 id);两者都拿不到则回落全局 activeGroupId 兼容兜底 / cwd 反查。
 */
export function createCoAgentHubTools(
  client: CoAgentHubClient,
  settingsStore?: CoAgentHubSettingsStore,
  resolveLiveAgentCwd?: LiveAgentCwdResolver,
  resolveLiveAgentSessionId?: LiveAgentSessionIdResolver,
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
          const groupId = await resolveGroupId(args, exec, client, settingsStore, resolveLiveAgentCwd, resolveLiveAgentSessionId)
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
        'Dispatch a task to a CoAgentHub executor by sending a directed message: finds the participant whose name contains executorName (default "AtomCode") and sends audience="participant" with that participant id, which creates and schedules a task. Returns the message id. groupId 可选:不传时优先用当前会话已保存的工作区映射(per-session,须在群列表中),否则按当前工作区 cwd 反查匹配群;都找不到会报错提示手动传 groupId。若任务需求存在歧义(如效果/范围/验收不清晰),必须先向用户澄清要点,得到确认后再下发任务书。可选结构化字段 goal/scope/acceptance/tests/report/priority/dependencies 会被渲染进任务书;只传 body 时原样发送(完全兼容)。planOnly=true 时只生成任务书预览(与真实下发渲染完全一致),不发送给执行器、不创建任务;返回 { planned: true, taskBook }。',
      parameters: {
        groupId: { type: 'string', description: 'Target group id. 可选:不传时自动回填(当前会话 per-session 映射优先 → 当前工作区 cwd 反查兜底)。' },
        body: { type: 'string', required: true, description: 'Task brief sent to the executor (plain text, kept verbatim).' },
        executorName: {
          type: 'string',
          default: DEFAULT_EXECUTOR_NAME,
          description: 'Name fragment matching an executor participant, e.g. "AtomCode" or "Reasoning".',
        },
        planOnly: {
          type: 'boolean',
          default: false,
          description: 'Dry-run 预览:true 时只渲染任务书,不发给执行器、不创建任务;默认 false 真实下发。',
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
          oneOf: [
            {
              type: 'object',
              additionalProperties: false,
              properties: {
                messageId: { type: 'string', required: true },
                executorParticipantId: { type: 'string', required: true },
                executorName: { type: 'string', required: true },
              },
            },
            {
              type: 'object',
              additionalProperties: false,
              properties: {
                planned: { type: 'boolean', required: true },
                taskBook: { type: 'string', required: true },
              },
            },
          ],
        } as const,
        render: renderValue,
      },
      async execute(args: {
        groupId?: string
        body: string
        executorName?: string
        planOnly?: boolean
        goal?: string
        scope?: string
        acceptance?: string
        tests?: string
        report?: string
        priority?: string
        dependencies?: string
      }, exec: ToolRunContext) {
        // 任务书渲染与真实下发完全一致;planOnly 时只渲染预览,不做任何客户端
        // 调用(不解析群/执行器、不发消息、不创建任务),返回 { planned: true, taskBook }。
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
        if (args.planOnly === true) {
          return { planned: true, taskBook }
        }
        // groupId 可选:显式传值优先,否则依次用当前会话 per-session 映射(须在
        // 群列表中)、当前工作区 cwd 反查自动回填。
        const groupId = await resolveGroupId(args, exec, client, settingsStore, resolveLiveAgentCwd, resolveLiveAgentSessionId)
        const executor = await resolveExecutor(client, args.executorName)
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
          const groupId = await resolveGroupId(args, exec, client, settingsStore, resolveLiveAgentCwd, resolveLiveAgentSessionId)
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
          const groupId = await resolveGroupId(args, exec, client, settingsStore, resolveLiveAgentCwd, resolveLiveAgentSessionId)
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
        'Resolve the CoAgentHub virtual workspace for the current session: the group selected in the panel 当前工作区 dropdown for this dsh session (per-session mapping, sessionActiveGroups[session.id]) takes precedence when it is set and exists in the group list; otherwise fall back to the group matched from the session cwd via the workspace mapping. instructions 从实际选中群的本地路径读取(优先 winPath,其次 projectPath,拿不到再退回会话 cwd)。Returns { groupId, groupTitle, projectPath?, winPath?, instructions? }; null when nothing resolves. Useful to scope a task or message to the user\'s workspace group.',
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
          // 解析优先级:当前会话 per-session 映射(非空且存在于群列表)优先 →
          // 会话 cwd 反查兜底(有 sessionId 时绝不回退全局 activeGroupId)。
          const settings = settingsStore?.get()
          const cwd = workspaceRootFromExec(exec, resolveLiveAgentCwd)
          const groups = await client.listGroups(100)
          const group = resolveWorkspaceGroup(groups.items, settings, cwd, currentSessionId(exec, resolveLiveAgentSessionId))
          if (group === null) return null
          const winPath = groupProjectWinPath(group.projectPath, settings?.mappingRule)
          const instructions = await readWorkspaceInstructions(workspaceInstructionsRoot(group, settings, cwd))
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
        'Return the workspace-level instructions for the current session: pairs the group resolved via the current session\'s per-session mapping (falling back to the session cwd) and reads COAGENTHUB.md from the resolved group\'s local path (优先 winPath,其次 projectPath,拿不到再退回会话 cwd)。非插件工作区(无 COAGENTHUB.md)返回 instructions: null.',
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
          // 解析优先级:当前会话 per-session 映射(非空且存在于群列表)优先 →
          // 会话 cwd 反查兜底(有 sessionId 时绝不回退全局 activeGroupId)。
          const settings = settingsStore?.get()
          const cwd = workspaceRootFromExec(exec, resolveLiveAgentCwd)
          const groups = await client.listGroups(100)
          const group = resolveWorkspaceGroup(groups.items, settings, cwd, currentSessionId(exec, resolveLiveAgentSessionId))
          // 解析到群时从选中群本地路径读;解析不到群(自动模式也无 cwd 匹配)时退回会话 cwd。
          const instructionsRoot = group === null ? cwd : workspaceInstructionsRoot(group, settings, cwd)
          const instructions = await readWorkspaceInstructions(instructionsRoot)
          return {
            groupId: group?.id ?? null,
            groupTitle: group?.title ?? null,
            instructions,
          }
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
          const groupId = await resolveGroupId(args, exec, client, settingsStore, resolveLiveAgentCwd, resolveLiveAgentSessionId)
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
        const groupId = await resolveGroupId(args, exec, client, settingsStore, resolveLiveAgentCwd, resolveLiveAgentSessionId)
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
        const groupId = await resolveGroupId(args, exec, client, settingsStore, resolveLiveAgentCwd, resolveLiveAgentSessionId)
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
          const groupId = await resolveGroupId(args, exec, client, settingsStore, resolveLiveAgentCwd, resolveLiveAgentSessionId)
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
          const groupId = await resolveGroupId(args, exec, client, settingsStore, resolveLiveAgentCwd, resolveLiveAgentSessionId)
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
          const groupId = await resolveGroupId(args, exec, client, settingsStore, resolveLiveAgentCwd, resolveLiveAgentSessionId)
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
            outputTail: task.diffSummary?.outputTail ?? task.outputTail ?? null,
          }
        } catch (error) {
          // 单任务接口 404/405 后 fallback 到 listTasks 仍找不到该 id 时,client.getTask
          // 会抛出 bodySummary 为 "task <taskId> not found in group <groupId>" 的 404。
          // 这种情况多半是用户把 dispatch_task 返回的 messageId 误当 taskId,给出友好提示。
          if (
            error instanceof CoAgentHubError &&
            error.status === 404 &&
            error.bodySummary.startsWith(`task ${args.taskId} not found in group`)
          ) {
            throw new Error(
              `任务不存在或 id 无效(404): ${args.taskId}。如果这是 coagenthub_dispatch_task 返回的 messageId，它不是 taskId；请用 coagenthub_list_tasks 查询真实任务 id。`,
            )
          }
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
          const groupId = await resolveGroupId(args, exec, client, settingsStore, resolveLiveAgentCwd, resolveLiveAgentSessionId)
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
        'Return and clear the pending CoAgentHub notifications for the group resolved from the current session\'s per-session mapping when set and valid (falling back to the session cwd → group backfill). Notifications from other groups stay queued and do not leak into the current workspace. Use to catch up on background events instead of polling.',
      parameters: {},
      output: { schema: { type: 'array', items: NOTIFICATION_VIEW_SCHEMA } as const, render: renderValue },
      async execute(_args: Record<string, never>, exec: ToolRunContext) {
        try {
          // 通知按 当前会话 per-session 映射 → 会话 cwd 反查 的顺序隔离群:手动
          // 保存的工作区优先(须存在于群列表),未设置/已失效才按 cwd 反查;只
          // drain 该群的通知,其他群的通知保留在队列里(不会串到当前会话也不
          // 会丢失);反查不到群时返回空且不消费队列。
          const settings = settingsStore?.get()
          const cwd = workspaceRootFromExec(exec, resolveLiveAgentCwd)
          const groups = await client.listGroups(100)
          const group = resolveWorkspaceGroup(groups.items, settings, cwd, currentSessionId(exec, resolveLiveAgentSessionId))
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

/** Register the CoAgentHub tools on a dsh tools runtime. */
export function registerCoAgentHubTools(
  ctx: Context,
  client: CoAgentHubClient,
  settingsStore?: CoAgentHubSettingsStore,
  resolveLiveAgentCwd?: LiveAgentCwdResolver,
  resolveLiveAgentSessionId?: LiveAgentSessionIdResolver,
): () => void {
  const disposers = createCoAgentHubTools(client, settingsStore, resolveLiveAgentCwd, resolveLiveAgentSessionId)
    .map(definition => ctx.tools.register(definition))
  return () => {
    for (const dispose of disposers) dispose()
  }
}
