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
}

export interface TaskDiffSummary {
  summary: string | null
  hash: string | null
  error: string | null
  /** Process output tail; only present when the tasks were fetched with includeOutput=1. */
  outputTail?: string | null
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
  createdAt: string
  updatedAt: string
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

  async getParticipantByName(name: string): Promise<Participant | undefined> {
    const participants = await this.listParticipants()
    return participants.find(participant => participant.name === name)
  }
}
