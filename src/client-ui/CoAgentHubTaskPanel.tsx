/**
 * CoAgentHub task panel (browser half). Lists the tasks of a selected group:
 * status badge / executor / brief / updatedAt, with a detail expansion area —
 * 任务书 / attempt timeline / final report / terminal output — that opens
 * inside the panel (the panel widens via `onDetailChange` instead of covering
 * the conversation). Fetches through the same-origin proxy route the host half
 * registers (default `/coagenthub-api`), auto-refreshes running tasks every
 * 15s, copies a task id on demand, and opens the full output in a new browser
 * tab via `/coagenthub-api/raw/<taskId>`.
 * @module @laizhixingxingdeli/dsh-coagenthub/client-ui
 */

import { useEffect, useRef, useState, type ReactNode } from 'react'
import css from './CoAgentHubTaskPanel.module.css'
import { DEFAULT_API_BASE, fetchGroups, type CoAgentHubGroupView } from './CoAgentHubGroupList.tsx'

/** Auto-refresh interval (ms) while a group is selected and tasks are shown. */
export const TASK_REFRESH_MS = 15_000

/** Preview lengths for the collapsed summary / expanded brief / output tail. */
export const SUMMARY_LIMIT = 60
export const BRIEF_LIMIT = 400
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
  /** Reports whether a task detail is expanded so the panel can widen. */
  onDetailChange?: (open: boolean) => void
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

/** Expanded brief preview (任务书), capped at BRIEF_LIMIT with the toggle. */
export function briefText(task: CoAgentHubTaskView): string {
  const text = (task.brief ?? '').trim()
  return text.length > BRIEF_LIMIT ? `${text.slice(0, BRIEF_LIMIT)}…` : text
}

/** True when the brief is truncated and the 展开全文 toggle applies. */
export function isBriefTruncated(task: CoAgentHubTaskView): boolean {
  return (task.brief ?? '').trim().length > BRIEF_LIMIT
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

/** Same-origin URL of the full task output (opened in a new browser tab). */
export function rawOutputUrl(apiBase: string, taskId: string): string {
  return `${apiBase}/raw/${encodeURIComponent(taskId)}`
}

/** The final report of a task: 提交 / 测试 / 汇报 / 遗留, parsed from the summary. */
export interface FinalReport {
  提交: string | null
  测试: string | null
  汇报: string | null
  遗留: string | null
}

/**
 * Parse the diffSummary into labeled report sections. Lines like
 * `提交: …` / `测试: …` / `汇报: …` / `遗留: …` map to their label; when the
 * summary has no such markers it is shown whole as 汇报. 提交 falls back to the
 * short hash.
 */
export function parseFinalReport(
  summary: string | null | undefined,
  hash: string | null | undefined,
): FinalReport {
  const report: FinalReport = { 提交: null, 测试: null, 汇报: null, 遗留: null }
  if (hash !== null && hash !== undefined && hash !== '') report.提交 = hash.slice(0, 7)
  const text = (summary ?? '').trim()
  if (text === '') return report
  let matched = false
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^\s*(提交|测试|汇报|遗留)\s*[:：]\s*(.*)$/)
    if (match === null) continue
    const value = match[2]!.trim()
    switch (match[1]) {
      case '提交': report.提交 = value; break
      case '测试': report.测试 = value; break
      case '汇报': report.汇报 = value; break
      default: report.遗留 = value; break
    }
    matched = true
  }
  if (!matched) report.汇报 = text
  return report
}

/** Highlight every occurrence of `term` inside `line` (terminal search). */
export function highlightTerm(line: string, term: string, keyPrefix: string): ReactNode {
  if (term === '') return line
  const parts = line.split(term)
  const nodes: ReactNode[] = []
  parts.forEach((part, index) => {
    if (part !== '') nodes.push(<span key={`${keyPrefix}-t${index}`}>{part}</span>)
    if (index < parts.length - 1) nodes.push(<mark key={`${keyPrefix}-m${index}`} className={css.hit}>{term}</mark>)
  })
  return nodes
}

/**
 * The CoAgentHub task panel: group selector (reusing the group-list fetch),
 * then the selected group's tasks with a detail expansion area. Auto-refreshes
 * while a group is selected; the header 刷新 button forces a reload.
 */
export function CoAgentHubTaskPanel({ apiBase = DEFAULT_API_BASE, onDetailChange }: CoAgentHubTaskPanelProps) {
  const [groups, setGroups] = useState<CoAgentHubGroupView[]>([])
  const [groupsError, setGroupsError] = useState<string | null>(null)
  const [groupId, setGroupId] = useState('')
  const [state, setState] = useState<LoadState>({ kind: 'idle' })
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [briefExpanded, setBriefExpanded] = useState(false)
  const [followOutput, setFollowOutput] = useState(true)
  const [searchTerm, setSearchTerm] = useState('')
  const [tick, setTick] = useState(0)
  const outputRef = useRef<HTMLPreElement | null>(null)

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

  // Report detail-open state so the panel container can widen.
  useEffect(() => {
    onDetailChange?.(expandedId !== null)
  }, [expandedId, onDetailChange])

  // Follow-scroll: keep the terminal pinned to the bottom while enabled.
  useEffect(() => {
    if (followOutput && outputRef.current !== null) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight
    }
  }, [followOutput, state, searchTerm])

  const copyId = (id: string): void => {
    const clipboard = navigator.clipboard
    if (clipboard === undefined) return
    void clipboard.writeText(id).then(() => setCopiedId(id)).catch(() => {})
  }

  const openFullOutput = (taskId: string): void => {
    window.open(rawOutputUrl(apiBase, taskId), '_blank', 'noopener')
  }

  const toggleRow = (id: string): void => {
    setExpandedId((prev) => (prev === id ? null : id))
    setBriefExpanded(false)
    setSearchTerm('')
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
              const fullBrief = (task.brief ?? '').trim()
              const report = parseFinalReport(task.diffSummary?.summary, task.diffSummary?.hash)
              const hasReport = report.提交 !== null || report.测试 !== null || report.汇报 !== null || report.遗留 !== null
              const term = searchTerm.trim()
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
                    <div className={css.detail} data-testid="task-detail">
                      <div className={css.detailHeader}>
                        <span className={css.badge} data-status={task.status}>
                          {task.status === 'running' && <span className={css.pulse} />}
                          {statusLabel(task.status)}
                        </span>
                        <span className={css.executor}>{executorLabel(task)}</span>
                        <div className={css.detailActions}>
                          <button
                            type="button"
                            className={css.action}
                            data-copied={copiedId === task.id || undefined}
                            onClick={() => copyId(task.id)}
                            title={`${task.id}（复制）`}
                          >
                            {copiedId === task.id ? '已复制' : '复制 id'}
                          </button>
                          <button
                            type="button"
                            className={css.action}
                            onClick={() => openFullOutput(task.id)}
                            title="新标签页打开完整输出"
                          >
                            打开完整输出
                          </button>
                        </div>
                      </div>

                      {fullBrief !== '' && (
                        <div className={css.section}>
                          <h4 className={css.sectionTitle}>任务书</h4>
                          <p className={css.detailBrief}>{briefExpanded ? fullBrief : briefText(task)}</p>
                          {isBriefTruncated(task) && (
                            <button
                              type="button"
                              className={css.textToggle}
                              onClick={() => setBriefExpanded((v) => !v)}
                            >
                              {briefExpanded ? '收起' : '展开全文'}
                            </button>
                          )}
                        </div>
                      )}

                      {task.attempts.length > 0 && (
                        <div className={css.section}>
                          <h4 className={css.sectionTitle}>执行历史</h4>
                          <ol className={css.timeline}>
                            {task.attempts.map((attempt) => {
                              const ok = attempt.status === 'done'
                              return (
                                <li key={attempt.n} className={css.timelineItem}>
                                  <span className={css.timelineNode} data-ok={ok || undefined} />
                                  <span className={css.timelineText}>
                                    <span className={css.timelineStep}>第 {attempt.n} 次</span>
                                    <span className={css.timelineStatus} data-ok={ok || undefined}>
                                      {statusLabel(attempt.status)}
                                    </span>
                                    {attempt.error !== null && attempt.error !== '' && (
                                      <span className={css.timelineReason}>{attempt.error}</span>
                                    )}
                                    {attempt.hash !== null && attempt.hash !== '' && (
                                      <span className={css.timelineHash}>{attempt.hash.slice(0, 7)}</span>
                                    )}
                                  </span>
                                </li>
                              )
                            })}
                          </ol>
                        </div>
                      )}

                      {hasReport && (
                        <div className={css.section}>
                          <h4 className={css.sectionTitle}>最终汇报</h4>
                          <div className={css.report}>
                            {report.提交 !== null && (
                              <div className={css.reportRow}>
                                <span className={css.reportLabel}>提交</span>
                                <span className={css.reportValue}>{report.提交}</span>
                              </div>
                            )}
                            {report.测试 !== null && (
                              <div className={css.reportRow}>
                                <span className={css.reportLabel}>测试</span>
                                <span className={css.reportValue}>{report.测试}</span>
                              </div>
                            )}
                            {report.汇报 !== null && (
                              <div className={css.reportRow}>
                                <span className={css.reportLabel}>汇报</span>
                                <span className={css.reportValue}>{report.汇报}</span>
                              </div>
                            )}
                            {report.遗留 !== null && (
                              <div className={css.reportRow}>
                                <span className={css.reportLabel}>遗留</span>
                                <span className={css.reportValue}>{report.遗留}</span>
                              </div>
                            )}
                          </div>
                        </div>
                      )}

                      {diffError !== '' && (
                        <div className={css.section}>
                          <h4 className={css.sectionTitle}>失败原因</h4>
                          <pre className={css.detailError}>{capOutput(diffError)}</pre>
                        </div>
                      )}

                      {diffOutput !== '' && (
                        <div className={css.section}>
                          <div className={css.outputToolbar}>
                            <input
                              className={css.search}
                              value={searchTerm}
                              onChange={(event) => setSearchTerm(event.target.value)}
                              placeholder="搜索输出"
                              aria-label="搜索输出"
                            />
                            <button
                              type="button"
                              className={css.toggle}
                              data-on={followOutput || undefined}
                              aria-pressed={followOutput}
                              onClick={() => setFollowOutput((v) => !v)}
                            >
                              跟随滚动
                            </button>
                          </div>
                          <pre className={css.terminal} ref={outputRef} aria-label="过程输出">
                            {term === ''
                              ? capOutput(diffOutput)
                              : capOutput(diffOutput).split('\n').filter((line) => line.includes(term)).map(
                                  (line, index) => (
                                    <div key={index} className={css.termLine}>
                                      {highlightTerm(line, term, `l${index}`)}
                                    </div>
                                  ),
                                )}
                          </pre>
                        </div>
                      )}
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
