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

/** Build the six CoAgentHub tool definitions against one client. */
export function createCoAgentHubTools(client: CoAgentHubClient): ToolDefinition[] {
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
        'Dispatch a task to a CoAgentHub executor by sending a directed message: finds the participant whose name contains executorName (default "AtomCode") and sends audience="participant" with that participant id, which creates and schedules a task. Returns the message id. 若任务需求存在歧义(如效果/范围/验收不清晰),必须先向用户澄清要点,得到确认后再下发任务书。',
      parameters: {
        groupId: { type: 'string', required: true, description: 'Target group id.' },
        body: { type: 'string', required: true, description: 'Task brief sent to the executor.' },
        executorName: {
          type: 'string',
          default: DEFAULT_EXECUTOR_NAME,
          description: 'Name fragment matching an executor participant, e.g. "AtomCode" or "Reasoning".',
        },
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
      async execute(args: { groupId: string; body: string; executorName?: string }) {
        const executor = await resolveExecutor(client, args.executorName)
        const message = await client.postMessage(args.groupId, {
          body: args.body,
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
  ]
}

/** Register the six CoAgentHub tools on a dsh tools runtime. */
export function registerCoAgentHubTools(ctx: Context, client: CoAgentHubClient): () => void {
  const disposers = createCoAgentHubTools(client).map(definition => ctx.tools.register(definition))
  return () => {
    for (const dispose of disposers) dispose()
  }
}
