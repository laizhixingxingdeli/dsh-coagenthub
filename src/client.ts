/**
 * CoAgentHub HTTP client: unauthenticated, identity declared via the
 * `X-Participant-Id` header (absent means the server falls back to Local User).
 * @module @laizhixingxingdeli/dsh-coagenthub/client
 */

import type { CoAgentHubSettingsStore } from './config.ts'

export const DEFAULT_API_BASE = 'http://localhost:3001/api'

export const REQUEST_TIMEOUT_MS = 10_000

export interface CoAgentHubOptions {
  /** API base URL; defaults to {@link DEFAULT_API_BASE}. */
  baseURL?: string
  /** Participant identity sent as `X-Participant-Id`; absent means no header. */
  participantId?: string
  /**
   * Runtime settings store; its values take precedence over `baseURL` /
   * `participantId` (设置 > 插件 config > 环境变量 > 默认), read per request.
   */
  settingsStore?: CoAgentHubSettingsStore
}

export interface Participant {
  id: string
  name: string
  device: string | null
  capabilities: string[]
  lastSeen: string | null
  createdAt: string
}

export interface Group {
  id: string
  title: string
  status: string
  createdBy: string
  createdAt: string
  updatedAt: string
  memberCount: number
  /** Mac-side project path when the group is bound to a repo; absent otherwise. */
  projectPath?: string | null
  /** Group members when the endpoint returns them (GET /groups/:id). */
  members?: GroupMember[]
}

export interface GroupMember {
  id: string
  name: string
  device?: string | null
}

/**
 * One member as returned by `GET /groups/:id/members` (the dedicated members
 * endpoint): carries the participant identity plus role/prompt 分工信息.
 */
export interface GroupMemberInfo {
  participantId: string
  name: string
  device: string | null
  roles: string[]
  prompt: string | null
  joinedAt: string | null
}

export interface GroupList {
  items: Group[]
  total: number
}

export type MessageAudience = 'broadcast' | 'role' | 'participant'

export interface Message {
  id: string
  groupId: string
  senderId: string
  parentId: string | null
  audience: MessageAudience | null
  audienceRef: string | null
  body: string
  contentType: string
  createdAt: string
  updatedAt: string
}

export interface PostMessageInput {
  body: string
  audience?: MessageAudience
  audienceRef?: string
  /**
   * 结构化透传元数据(如 `{ dispatcherSessionId }`),随消息写入服务端;
   * 服务端暂不支持时该字段会被忽略,不影响现有调用。
   */
  metadata?: Record<string, unknown>
  /** Spec-Driven 派发:规范文档路径(如 specs/feature-x.md),服务端据此在任务书中插入「关联规范」段。 */
  specRef?: string
  /** 规范文档的 Git Hash(版本快照),用于审计和版本锁定;可选。 */
  specHash?: string
}

export interface TaskDiffSummary {
  summary: string | null
  hash: string | null
  error: string | null
  /** Process output tail; only present when the tasks were fetched with includeOutput=1. */
  outputTail?: string | null
}

/** One attempt in a task's retry timeline (from `attempts` in the task payload). */
export interface TaskAttempt {
  n: number
  startedAt: string
  endedAt: string | null
  status: string
  error: string | null
  summary: string | null
  hash: string | null
}

export interface Task {
  id: string
  groupId: string
  messageId: string
  executorParticipantId: string
  executorKey: string
  brief: string
  status: string
  checkpointRef: string | null
  retryCount: number
  diffSummary: TaskDiffSummary | null
  /** Process output tail; server may also return it at the task top level. */
  outputTail?: string | null
  attempts?: TaskAttempt[]
  /**
   * 下发者会话 id(dispatch 时经 message metadata 传入,服务端回显到任务上;
   * 服务端尚未支持时缺失)。
   */
  dispatcherSessionId?: string | null
  /** 下发者 participant id(服务端回显;dispatcherSessionId 缺失时的兜底路由)。 */
  dispatcherParticipantId?: string | null
  createdAt: string
  updatedAt: string
}

/** An executor registered on the CoAgentHub server (GET /executors). */
export interface Executor {
  key: string
  agentName: string
  kind?: string | null
  bin?: string | null
  url?: string | null
  model?: string | null
  device?: string | null
  online?: boolean | null
}

/**
 * Standard completion-event envelope (schemaVersion=1). Read at claim/list time
 * so `diffSummary` / `outputTail` are always fresh from the task row. `task`
 * carries the routed event data; `state` / `attempts` / `nextAttemptAt` are the
 * delivery state (only present on inbox-list items, not on claim responses).
 */
export interface CompletionEventEnvelope {
  schemaVersion: 1
  type: 'coagenthub.task.completed'
  eventId: string
  dispatcherParticipantId: string | null
  dispatcherSessionId: string | null
  callbackRef: Record<string, unknown> | null
  task: {
    groupId: string
    taskId: string
    status: string | null
    specRef: string | null
    specHash: string | null
    diffSummary: unknown
    outputTail: unknown
  }
}

/** One inbox-list item = standard envelope + delivery state. */
export interface CompletionInboxItem extends CompletionEventEnvelope {
  state: string
  attempts: number
  nextAttemptAt: string | null
}

export interface CompletionInboxList {
  events: CompletionInboxItem[]
}

export interface ClaimResult {
  leaseToken: string
  event: CompletionEventEnvelope
}

/** HTTP-level failure carrying the status code and a response body summary. */
export class CoAgentHubError extends Error {
  readonly status: number
  readonly bodySummary: string

  constructor(status: number, bodySummary: string, message?: string) {
    super(message ?? `CoAgentHub request failed with status ${status}`)
    this.name = 'CoAgentHubError'
    this.status = status
    this.bodySummary = bodySummary
  }
}

/** Fetch-level failure (network error, DNS, timeout, …). */
export class CoAgentHubFetchError extends Error {
  constructor(cause: unknown) {
    super(`CoAgentHub request failed: ${cause instanceof Error ? cause.message : String(cause)}`)
    this.name = 'CoAgentHubFetchError'
    this.cause = cause
  }
}

const BODY_SUMMARY_LIMIT = 500

function summarizeBody(body: string): string {
  const trimmed = body.trim()
  if (trimmed.length <= BODY_SUMMARY_LIMIT) return trimmed
  return `${trimmed.slice(0, BODY_SUMMARY_LIMIT)}…`
}

export class CoAgentHubClient {
  private readonly configuredBaseURL?: string
  private readonly configuredParticipantId?: string
  private readonly settingsStore?: CoAgentHubSettingsStore

  constructor(options: CoAgentHubOptions = {}) {
    this.configuredBaseURL = options.baseURL
    this.configuredParticipantId = options.participantId
    this.settingsStore = options.settingsStore
  }

  /** Effective base URL, resolved per request: 设置 > config > env > default. */
  get baseURL(): string {
    const fromSettings = this.settingsStore?.get().apiBase
    const base = fromSettings ?? this.configuredBaseURL ?? process.env.COAGENTHUB_API_BASE ?? DEFAULT_API_BASE
    return base.replace(/\/+$/, '')
  }

  /** Effective participant id, resolved per request: 设置 > config > env. */
  get participantId(): string | undefined {
    return (
      this.settingsStore?.get().participantId
      ?? this.configuredParticipantId
      ?? process.env.COAGENTHUB_PARTICIPANT_ID
    )
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
    const headers = new Headers(init.headers)
    headers.set('Accept', 'application/json')
    if (init.body !== undefined) headers.set('Content-Type', 'application/json')
    if (this.participantId !== undefined) headers.set('X-Participant-Id', this.participantId)
    try {
      const response = await fetch(`${this.baseURL}${path}`, { ...init, headers, signal: controller.signal })
      const text = await response.text()
      if (!response.ok) {
        throw new CoAgentHubError(response.status, summarizeBody(text))
      }
      if (text.length === 0) return undefined as T
      return JSON.parse(text) as T
    } catch (error: unknown) {
      if (error instanceof CoAgentHubError) throw error
      throw new CoAgentHubFetchError(error)
    } finally {
      clearTimeout(timer)
    }
  }

  listParticipants(): Promise<Participant[]> {
    return this.request<Participant[]>('/participants')
  }

  createGroup(title: string): Promise<Group> {
    return this.request<Group>('/groups', { method: 'POST', body: JSON.stringify({ title }) })
  }

  patchGroup(id: string, patch: Record<string, unknown>): Promise<Group> {
    return this.request<Group>(`/groups/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(patch) })
  }

  listGroups(limit?: number, offset?: number): Promise<GroupList> {
    const params = new URLSearchParams()
    if (limit !== undefined) params.set('limit', String(limit))
    if (offset !== undefined) params.set('offset', String(offset))
    const query = params.size > 0 ? `?${params.toString()}` : ''
    return this.request<GroupList>(`/groups${query}`)
  }

  postMessage(groupId: string, input: PostMessageInput): Promise<Message> {
    // metadata 未传时 JSON.stringify 自然省略该键,服务端旧版本不受影响。
    return this.request<Message>(`/groups/${encodeURIComponent(groupId)}/messages`, {
      method: 'POST',
      body: JSON.stringify(input),
    })
  }

  listMessages(groupId: string): Promise<Message[]> {
    return this.request<Message[]>(`/groups/${encodeURIComponent(groupId)}/messages`)
  }

  listTasks(groupId: string, includeOutput = false): Promise<Task[]> {
    const query = includeOutput ? '?includeOutput=1' : ''
    return this.request<Task[]>(`/groups/${encodeURIComponent(groupId)}/tasks${query}`)
  }

  /** Fetch one group by id (GET /groups/:id); may include `members`. */
  getGroup(groupId: string): Promise<Group> {
    return this.request<Group>(`/groups/${encodeURIComponent(groupId)}`)
  }

  /** List members of one group with role/prompt 分工信息 (GET /groups/:id/members). */
  getGroupMembers(groupId: string): Promise<GroupMemberInfo[]> {
    return this.request<GroupMemberInfo[]>(`/groups/${encodeURIComponent(groupId)}/members`)
  }

  /**
   * Update a group's title and/or project binding (PATCH /groups/:id).
   * Pass `projectPath: null` to clear the binding.
   */
  updateGroup(groupId: string, patch: { title?: string; projectPath?: string | null }): Promise<Group> {
    return this.patchGroup(groupId, patch)
  }

  /**
   * Add a member to a group (POST /groups/:id/members). The server returns the
   * member row with its roles/prompt 分工信息; roles default to `['executor']`
   * server-side when omitted.
   */
  addGroupMember(groupId: string, input: { participantId: string; roles?: string[] }): Promise<GroupMemberInfo> {
    return this.request<GroupMemberInfo>(`/groups/${encodeURIComponent(groupId)}/members`, {
      method: 'POST',
      body: JSON.stringify(input),
    })
  }

  /**
   * Remove a member from a group (DELETE /groups/:id/members/:participantId).
   * The server may answer 204 with no body; in that case return `{ ok: true }`.
   */
  async removeGroupMember(groupId: string, participantId: string): Promise<{ ok: boolean } | void> {
    const result = await this.request<{ ok: boolean } | undefined>(
      `/groups/${encodeURIComponent(groupId)}/members/${encodeURIComponent(participantId)}`,
      { method: 'DELETE' },
    )
    // 204 无 body 时 request() 返回 undefined,按成功处理返回 { ok: true }。
    return result ?? { ok: true }
  }

  /** List registered executors (GET /executors). */
  listExecutors(): Promise<Executor[]> {
    return this.request<Executor[]>('/executors')
  }

  /**
   * Fetch one task by id. Prefers the single-task endpoint
   * (`GET /groups/:id/tasks/:taskId`); when the server has no such endpoint
   * (404/405) it falls back to `listTasks(groupId, true)` and filters.
   */
  async getTask(groupId: string, taskId: string): Promise<Task> {
    try {
      return await this.request<Task>(`/groups/${encodeURIComponent(groupId)}/tasks/${encodeURIComponent(taskId)}`)
    } catch (error) {
      if (error instanceof CoAgentHubError && (error.status === 404 || error.status === 405)) {
        const tasks = await this.listTasks(groupId, true)
        const task = tasks.find(candidate => candidate.id === taskId)
        if (task === undefined) {
          throw new CoAgentHubError(404, `task ${taskId} not found in group ${groupId}`)
        }
        return task
      }
      throw error
    }
  }

  /**
   * Update a task's brief (PATCH /groups/:id/tasks/:taskId, body `{ brief }`).
   * The server rejects with 409 when the task is not in a modifiable (queued)
   * state and with 403 when the caller lacks permission.
   */
  updateTaskBrief(groupId: string, taskId: string, brief: string): Promise<Task> {
    return this.request<Task>(
      `/groups/${encodeURIComponent(groupId)}/tasks/${encodeURIComponent(taskId)}`,
      { method: 'PATCH', body: JSON.stringify({ brief }) },
    )
  }

  async getParticipantByName(name: string): Promise<Participant | undefined> {
    const participants = await this.listParticipants()
    return participants.find(participant => participant.name === name)
  }

  /**
   * List pending / retriable / lease-expired completion events for the
   * participant (GET /participants/:id/task-completion-events). `after` is an
   * event-id cursor; `limit` caps at 100 server-side.
   */
  listCompletionEvents(participantId: string, after?: string, limit?: number): Promise<CompletionInboxList> {
    const params = new URLSearchParams()
    if (after !== undefined) params.set('after', after)
    if (limit !== undefined) params.set('limit', String(limit))
    const query = params.size > 0 ? `?${params.toString()}` : ''
    return this.request<CompletionInboxList>(
      `/participants/${encodeURIComponent(participantId)}/task-completion-events${query}`,
    )
  }

  /**
   * Atomically claim one completion event (lease). Body carries the stable
   * local `consumerId` and requested `leaseMs`; returns a `leaseToken` that must
   * be presented to ack/fail. 409 means not claimable (already leased/delivered).
   */
  claimCompletionEvent(participantId: string, eventId: string, consumerId: string, leaseMs: number): Promise<ClaimResult> {
    return this.request<ClaimResult>(
      `/participants/${encodeURIComponent(participantId)}/task-completion-events/${encodeURIComponent(eventId)}/claim`,
      { method: 'POST', body: JSON.stringify({ consumerId, leaseMs }) },
    )
  }

  /**
   * Acknowledge a claimed event as delivered (state → delivered). Idempotent for
   * the same `leaseToken`. 409 means token mismatch or event not found.
   */
  ackCompletionEvent(participantId: string, eventId: string, leaseToken: string): Promise<{ success: boolean; eventId: string }> {
    return this.request<{ success: boolean; eventId: string }>(
      `/participants/${encodeURIComponent(participantId)}/task-completion-events/${encodeURIComponent(eventId)}/ack`,
      { method: 'POST', body: JSON.stringify({ leaseToken }) },
    )
  }

  /**
   * Record a delivery failure for a claimed event: increments attempts, sets
   * `retryAfterMs`; exceeds the server's max attempts (default 10) → dead.
   * 409 means token mismatch or event not found.
   */
  failCompletionEvent(
    participantId: string,
    eventId: string,
    leaseToken: string,
    error?: string,
    retryAfterMs?: number,
  ): Promise<{ success: boolean; eventId: string; attempts: number; state: string; nextAttemptAt: string | null }> {
    return this.request<{
      success: boolean
      eventId: string
      attempts: number
      state: string
      nextAttemptAt: string | null
    }>(
      `/participants/${encodeURIComponent(participantId)}/task-completion-events/${encodeURIComponent(eventId)}/fail`,
      {
        method: 'POST',
        body: JSON.stringify({
          leaseToken,
          ...(error !== undefined ? { error } : {}),
          ...(retryAfterMs !== undefined ? { retryAfterMs } : {}),
        }),
      },
    )
  }
}
