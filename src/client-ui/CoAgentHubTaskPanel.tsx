/**
 * CoAgentHub task panel (browser half). Lists the tasks of a selected group:
 * status badge / executor / brief / updatedAt, with expandable rows showing
 * the attempt timeline and diff output tail. Fetches through the same-origin
 * proxy route the host half registers (default `/coagenthub-api`), auto-
 * refreshes running tasks every 15s, and copies a task id on demand.
 * @module @laizhixingxingdeli/dsh-coagenthub/client-ui
 */

import { useEffect, useState } from 'react'
import css from './CoAgentHubTaskPanel.module.css'
import { DEFAULT_API_BASE, fetchGroups, type CoAgentHubGroupView } from './CoAgentHubGroupList.tsx'

/** Auto-refresh interval (ms) while a group is selected and tasks are shown. */
export const TASK_REFRESH_MS = 15_000

/** Preview lengths for the collapsed summary / expanded brief / output tail. */
export const SUMMARY_LIMIT = 60
export const BRIEF_LIMIT = 300
export const OUTPUT_LIMIT = 8000

/** Minimal task shape read from `GET {apiBase}/groups/:id/tasks?includeOutput=1`. */
export interface CoAgentHubTaskView {
  id: string
  status: 'queued' | 'running' | 'done' | 'failed' | 'cancelled' | string
  executorKey: string
  executorLabel?: string
  brief: string
  diffSummary: {
    summary: string | null
    hash: string | null
    error: string | null
    outputTail?: string | null
  } | null
  attempts: Array<{
    n: number
    startedAt: string
    endedAt: string | null
    status: string
    error: string | null
    summary: string | null
    hash: string | null
  }>
  createdAt: string
  updatedAt: string
  retryCount: number
}

/** Panel props: only the API base is configurable; everything else is framework-injected. */
export interface CoAgentHubTaskPanelProps {
  /** API base; defaults to the same-origin proxy route. */
  apiBase?: string
}

type LoadState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'ready'; tasks: CoAgentHubTaskView[] }
  | { kind: 'error'; message: string }

/** Map the API status to the copy shown on the status badge. */
export function statusLabel(status: string): string {
  if (status === 'queued') return '排队中'
  if (status === 'running') return '执行中'
  if (status === 'done') return '已完成'
  if (status === 'failed') return '失败'
  if (status === 'cancelled') return '已取消'
  return status
}

/** Executor display label: executorLabel when present, else executorKey. */
export function executorLabel(task: CoAgentHubTaskView): string {
  return (task.executorLabel !== undefined && task.executorLabel !== '') ? task.executorLabel : task.executorKey
}

/** Collapsed row summary: diffSummary.summary first, else brief, capped. */
export function taskSummary(task: CoAgentHubTaskView): string {
  const raw = task.diffSummary?.summary || task.brief || ''
  const text = raw.trim()
  return text.length > SUMMARY_LIMIT ? `${text.slice(0, SUMMARY_LIMIT)}…` : text
}

/** Expanded brief, capped at BRIEF_LIMIT. */
export function briefText(task: CoAgentHubTaskView): string {
  const text = (task.brief ?? '').trim()
  return text.length > BRIEF_LIMIT ? `${text.slice(0, BRIEF_LIMIT)}…` : text
}

/** One attempt as `第 N 次 <status> <error> <hash>`, the timeline step text. */
export function attemptStep(attempt: CoAgentHubTaskView['attempts'][number]): string {
  const parts = [`第 ${attempt.n} 次`, statusLabel(attempt.status)]
  if (attempt.error !== null && attempt.error !== '') parts.push(attempt.error)
  if (attempt.hash !== null && attempt.hash !== '') parts.push(attempt.hash.slice(0, 7))
  return parts.join(' ')
}

/** Render the attempt timeline as `第 1 次 失败 exit 1 → 第 2 次 成功 abc1234`. */
export function attemptTimeline(attempts: CoAgentHubTaskView['attempts']): string {
  return attempts.map(attemptStep).join(' → ')
}

/** Free-text detail (error / output tail) capped at OUTPUT_LIMIT. */
export function capOutput(text: string | null | undefined): string {
  const value = (text ?? '').trim()
  return value.length > OUTPUT_LIMIT ? `${value.slice(0, OUTPUT_LIMIT)}…` : value
}

/** `updatedAt` as a compact relative time, falling back to HH:MM / the raw value. */
export function formatUpdatedAt(iso: string, now: number = Date.now()): string {
  const time = new Date(iso).getTime()
  if (Number.isNaN(time)) return iso
  const diffMs = Math.max(0, now - time)
  if (diffMs < 60_000) return '刚刚'
  if (diffMs < 3_600_000) return `${Math.floor(diffMs / 60_000)} 分钟前`
  if (diffMs < 86_400_000) return `${Math.floor(diffMs / 3_600_000)} 小时前`
  const date = new Date(time)
  const hh = String(date.getHours()).padStart(2, '0')
  const mm = String(date.getMinutes()).padStart(2, '0')
  return `${hh}:${mm}`
}

/** Fetch `{apiBase}/groups/:id/tasks?includeOutput=1`, normalizing, throwing on failure. */
export async function fetchTasks(apiBase: string, groupId: string): Promise<CoAgentHubTaskView[]> {
  const response = await fetch(`${apiBase}/groups/${encodeURIComponent(groupId)}/tasks?includeOutput=1`)
  if (!response.ok) {
    const body = await response.text().catch(() => '')
    throw new Error(`HTTP ${response.status}${body !== '' ? `: ${body.slice(0, 200)}` : ''}`)
  }
  const data = (await response.json()) as CoAgentHubTaskView[] | { items?: CoAgentHubTaskView[] } | null
  if (Array.isArray(data)) return data
  if (data !== null && typeof data === 'object' && Array.isArray(data.items)) return data.items
  return []
}

/**
 * The CoAgentHub task panel: group selector (reusing the group-list fetch),
 * then the selected group's tasks with expandable details. Auto-refreshes
 * while a group is selected; the header 刷新 button forces a reload.
 */
export function CoAgentHubTaskPanel({ apiBase = DEFAULT_API_BASE }: CoAgentHubTaskPanelProps) {
  const [groups, setGroups] = useState<CoAgentHubGroupView[]>([])
  const [groupsError, setGroupsError] = useState<string | null>(null)
  const [groupId, setGroupId] = useState('')
  const [state, setState] = useState<LoadState>({ kind: 'idle' })
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [tick, setTick] = useState(0)

  // Load the group list once (reused by the dropdown).
  useEffect(() => {
    let alive = true
    fetchGroups(apiBase).then(
      (items) => { if (alive) { setGroups(items); setGroupsError(null) } },
      (error: unknown) => {
        if (alive) setGroupsError(error instanceof Error ? error.message : String(error))
      },
    )
    return () => { alive = false }
  }, [apiBase])

  // Load the selected group's tasks; `tick` drives manual + auto refresh.
  useEffect(() => {
    if (groupId === '') {
      setState({ kind: 'idle' })
      return
    }
    let alive = true
    setState({ kind: 'loading' })
    fetchTasks(apiBase, groupId).then(
      (tasks) => { if (alive) setState({ kind: 'ready', tasks }) },
      (error: unknown) => {
        if (alive) setState({ kind: 'error', message: error instanceof Error ? error.message : String(error) })
      },
    )
    return () => { alive = false }
  }, [apiBase, groupId, tick])

  // Auto-refresh every TASK_REFRESH_MS while a group is selected.
  useEffect(() => {
    if (groupId === '') return
    const timer = window.setInterval(() => setTick((v) => v + 1), TASK_REFRESH_MS)
    return () => window.clearInterval(timer)
  }, [groupId])

  const copyId = (id: string): void => {
    const clipboard = navigator.clipboard
    if (clipboard === undefined) return
    void clipboard.writeText(id).then(() => setCopiedId(id)).catch(() => {})
  }

  const toggleRow = (id: string): void => {
    setExpandedId((prev) => (prev === id ? null : id))
  }

  const tasks = state.kind === 'ready' ? state.tasks : []
  return (
    <section className={css.content} aria-label="CoAgentHub 任务面板">
      <div className={css.toolbar}>
        <select
          className={css.groupSelect}
          value={groupId}
          onChange={(event) => setGroupId(event.target.value)}
          aria-label="选择群组"
        >
          <option value="">请选择群组</option>
          {groups.map((group) => (
            <option key={group.id} value={group.id}>{group.title}</option>
          ))}
        </select>
        <button
          type="button"
          className={css.refresh}
          onClick={() => setTick((v) => v + 1)}
          disabled={groupId === ''}
          title="刷新"
        >
          刷新
        </button>
      </div>
      <div className={css.body}>
        {groupsError !== null && (
          <p className={css.error} role="alert">群列表加载失败:{groupsError}</p>
        )}
        {state.kind === 'idle' && <p className={css.empty}>请选择群组查看任务</p>}
        {state.kind === 'loading' && <p className={css.loading}>加载中…</p>}
        {state.kind === 'error' && (
          <p className={css.error} role="alert">任务加载失败:{state.message}</p>
        )}
        {state.kind === 'ready' && tasks.length === 0 && (
          <p className={css.empty}>暂无任务</p>
        )}
        {state.kind === 'ready' && tasks.length > 0 && (
          <ul className={css.list}>
            {tasks.map((task) => {
              const expanded = expandedId === task.id
              const diffError = task.diffSummary?.error ?? null
              const diffOutput = task.diffSummary?.outputTail ?? null
              return (
                <li key={task.id}>
                  <button
                    type="button"
                    className={css.row}
                    data-expanded={expanded || undefined}
                    onClick={() => toggleRow(task.id)}
                    aria-expanded={expanded}
                  >
                    <span className={css.rowMain}>
                      <span className={css.rowTop}>
                        <span className={css.badge} data-status={task.status}>
                          {task.status === 'running' && <span className={css.pulse} />}
                          {statusLabel(task.status)}
                        </span>
                        <span className={css.executor}>{executorLabel(task)}</span>
                        <span className={css.time}>{formatUpdatedAt(task.updatedAt)}</span>
                      </span>
                      <span className={css.summary}>{taskSummary(task)}</span>
                    </span>
                  </button>
                  {expanded && (
                    <div className={css.detail}>
                      {briefText(task) !== '' && <p className={css.detailBrief}>{briefText(task)}</p>}
                      {task.attempts.length > 0 && (
                        <p className={css.detailAttempts}>{attemptTimeline(task.attempts)}</p>
                      )}
                      {diffError !== '' && (
                        <pre className={css.detailError}>{capOutput(diffError)}</pre>
                      )}
                      {diffOutput !== '' && (
                        <pre className={css.detailOutput}>{capOutput(diffOutput)}</pre>
                      )}
                      <div className={css.rowActions}>
                        <button
                          type="button"
                          className={css.copyId}
                          data-copied={copiedId === task.id || undefined}
                          onClick={() => copyId(task.id)}
                          title={`${task.id}（复制）`}
                        >
                          {copiedId === task.id ? '已复制' : '复制 id'}
                        </button>
                      </div>
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </section>
  )
}
