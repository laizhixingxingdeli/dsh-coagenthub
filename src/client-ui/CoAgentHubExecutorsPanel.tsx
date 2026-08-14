/**
 * CoAgentHub executors panel (browser half). Lists the registered executors —
 * key / agentName / bin / args (truncated) / builtin badge / model — lets a
 * non-builtin row be deleted after a confirm, copies the key to the clipboard,
 * and creates a new executor through a collapsible form. Fetches through the
 * same-origin proxy route the host half registers (default `/coagenthub-api`).
 * @module @laizhixingxingdeli/dsh-coagenthub/client-ui
 */

import { useEffect, useState, type FormEvent } from 'react'
import css from './CoAgentHubExecutorsPanel.module.css'
import { DEFAULT_API_BASE } from './CoAgentHubGroupList.tsx'

/** Row preview length for the joined args. */
export const ARGS_LIMIT = 60

/** Minimal executor shape read from `GET {apiBase}/executors`. */
export interface CoAgentHubExecutorView {
  key: string
  agentName: string
  type?: string
  kind?: string
  bin: string
  url?: string | null
  args?: string[]
  label?: string
  device?: string | null
  model?: string | null
  builtin: boolean
}

/** New-executor body for `POST {apiBase}/executors` (key and kind are required). */
export interface CoAgentHubExecutorInput {
  key: string
  kind: 'cli' | 'a2a'
  agentName?: string
  type?: string
  bin?: string
  args?: string[]
  label?: string
  device?: string
  model?: string
}

/** Panel props: only the API base is configurable; everything else is framework-injected. */
export interface CoAgentHubExecutorsPanelProps {
  /** API base; defaults to the same-origin proxy route. */
  apiBase?: string
}

type LoadState =
  | { kind: 'loading' }
  | { kind: 'ready'; executors: CoAgentHubExecutorView[] }
  | { kind: 'error'; message: string }

/** Join the args array into a preview string, capped at ARGS_LIMIT. */
export function argsPreview(args: string[] | undefined): string {
  const text = (args ?? []).join(' ')
  return text.length > ARGS_LIMIT ? `${text.slice(0, ARGS_LIMIT)}…` : text
}

/** Fetch `{apiBase}/executors`, normalizing into rows, throwing on failure. */
export async function fetchExecutors(apiBase: string): Promise<CoAgentHubExecutorView[]> {
  const response = await fetch(`${apiBase}/executors`)
  if (!response.ok) {
    const body = await response.text().catch(() => '')
    throw new Error(`HTTP ${response.status}${body !== '' ? `: ${body.slice(0, 200)}` : ''}`)
  }
  const data = (await response.json()) as CoAgentHubExecutorView[] | { items?: CoAgentHubExecutorView[] } | null
  if (Array.isArray(data)) return data
  if (data !== null && typeof data === 'object' && Array.isArray(data.items)) return data.items
  return []
}

/** POST `{apiBase}/executors` with the new-executor body, throwing on failure. */
export async function createExecutor(apiBase: string, input: CoAgentHubExecutorInput): Promise<void> {
  const response = await fetch(`${apiBase}/executors`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  if (!response.ok) {
    const body = await response.text().catch(() => '')
    throw new Error(`HTTP ${response.status}${body !== '' ? `: ${body.slice(0, 200)}` : ''}`)
  }
}

/** DELETE `{apiBase}/executors/:key`; builtin rows are rejected with 403. */
export async function deleteExecutor(apiBase: string, key: string): Promise<void> {
  const response = await fetch(`${apiBase}/executors/${encodeURIComponent(key)}`, { method: 'DELETE' })
  if (!response.ok) {
    const body = await response.text().catch(() => '')
    throw new Error(`HTTP ${response.status}${body !== '' ? `: ${body.slice(0, 200)}` : ''}`)
  }
}

/**
 * The CoAgentHub executors panel: header (title + count + refresh) over the
 * executor list, a collapsible create form below the header, and per-row
 * copy-key / (non-builtin) delete actions.
 */
export function CoAgentHubExecutorsPanel({ apiBase = DEFAULT_API_BASE }: CoAgentHubExecutorsPanelProps) {
  const [state, setState] = useState<LoadState>({ kind: 'loading' })
  const [copiedKey, setCopiedKey] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [tick, setTick] = useState(0)
  const [formOpen, setFormOpen] = useState(false)
  const [formKey, setFormKey] = useState('')
  const [formAgentName, setFormAgentName] = useState('')
  const [formBin, setFormBin] = useState('')
  const [formKind, setFormKind] = useState<'cli' | 'a2a'>('cli')
  const [formArgs, setFormArgs] = useState('')
  const [formModel, setFormModel] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    setState({ kind: 'loading' })
    fetchExecutors(apiBase).then(
      (executors) => {
        if (alive) setState({ kind: 'ready', executors })
      },
      (error: unknown) => {
        if (alive) setState({ kind: 'error', message: error instanceof Error ? error.message : String(error) })
      },
    )
    return () => {
      alive = false
    }
  }, [apiBase, tick])

  const copyKey = (key: string): void => {
    const clipboard = navigator.clipboard
    if (clipboard === undefined) return
    void clipboard.writeText(key).then(() => setCopiedKey(key)).catch(() => {})
  }

  const handleDelete = (executor: CoAgentHubExecutorView): void => {
    if (!window.confirm(`删除执行器 ${executor.key}?`)) return
    deleteExecutor(apiBase, executor.key).then(
      () => {
        setActionError(null)
        setTick((v) => v + 1)
      },
      (error: unknown) => {
        setActionError(`删除失败:${error instanceof Error ? error.message : String(error)}`)
      },
    )
  }

  const handleSubmit = (event: FormEvent): void => {
    event.preventDefault()
    const key = formKey.trim()
    if (key === '') {
      setSubmitError('key 必填')
      return
    }
    setSubmitError(null)
    setSubmitting(true)
    const input: CoAgentHubExecutorInput = { key, kind: formKind }
    if (formAgentName.trim() !== '') input.agentName = formAgentName.trim()
    if (formBin.trim() !== '') input.bin = formBin.trim()
    if (formModel.trim() !== '') input.model = formModel.trim()
    input.args = formArgs.trim() === '' ? [] : formArgs.trim().split(/\s+/)
    createExecutor(apiBase, input).then(
      () => {
        setSubmitting(false)
        setFormKey('')
        setFormAgentName('')
        setFormBin('')
        setFormArgs('')
        setFormModel('')
        setTick((v) => v + 1)
      },
      (error: unknown) => {
        setSubmitting(false)
        setSubmitError(error instanceof Error ? error.message : String(error))
      },
    )
  }

  const executors = state.kind === 'ready' ? state.executors : []
  return (
    <section className={css.content} aria-label="CoAgentHub 执行器">
      <header className={css.header}>
        <div className={css.titleWrap}>
          <h2 className={css.title}>CoAgentHub 执行器</h2>
          {state.kind === 'ready' && <span className={css.count}>{executors.length}</span>}
        </div>
        <button
          type="button"
          className={css.refresh}
          onClick={() => setTick((v) => v + 1)}
          title="刷新"
        >
          刷新
        </button>
      </header>
      <div className={css.toolbar}>
        <button
          type="button"
          className={css.addToggle}
          data-open={formOpen || undefined}
          onClick={() => setFormOpen((v) => !v)}
          aria-expanded={formOpen}
        >
          {formOpen ? '收起新增表单' : '新增执行器'}
        </button>
      </div>
      {formOpen && (
        <form className={css.form} onSubmit={handleSubmit}>
          <label className={css.field}>
            <span className={css.fieldLabel}>key *</span>
            <input
              className={css.input}
              value={formKey}
              onChange={(event) => setFormKey(event.target.value)}
              placeholder="执行器唯一 key"
              aria-label="新增 key"
            />
          </label>
          <label className={css.field}>
            <span className={css.fieldLabel}>agentName</span>
            <input
              className={css.input}
              value={formAgentName}
              onChange={(event) => setFormAgentName(event.target.value)}
              placeholder="展示名"
              aria-label="新增 agentName"
            />
          </label>
          <label className={css.field}>
            <span className={css.fieldLabel}>bin</span>
            <input
              className={css.input}
              value={formBin}
              onChange={(event) => setFormBin(event.target.value)}
              placeholder="可执行文件"
              aria-label="新增 bin"
            />
          </label>
          <label className={css.field}>
            <span className={css.fieldLabel}>kind</span>
            <select
              className={css.input}
              value={formKind}
              onChange={(event) => setFormKind(event.target.value as 'cli' | 'a2a')}
              aria-label="新增 kind"
            >
              <option value="cli">cli</option>
              <option value="a2a">a2a</option>
            </select>
          </label>
          <label className={css.field}>
            <span className={css.fieldLabel}>args</span>
            <input
              className={css.input}
              value={formArgs}
              onChange={(event) => setFormArgs(event.target.value)}
              placeholder="空格分隔,如 -y -p {ticket}"
              aria-label="新增 args"
            />
          </label>
          <label className={css.field}>
            <span className={css.fieldLabel}>model</span>
            <input
              className={css.input}
              value={formModel}
              onChange={(event) => setFormModel(event.target.value)}
              placeholder="可选"
              aria-label="新增 model"
            />
          </label>
          {submitError !== null && <p className={css.error} role="alert">{submitError}</p>}
          <button type="submit" className={css.submit} disabled={submitting}>
            {submitting ? '提交中…' : '添加'}
          </button>
        </form>
      )}
      <div className={css.body}>
        {actionError !== null && <p className={css.error} role="alert">{actionError}</p>}
        {state.kind === 'loading' && <p className={css.loading}>加载中…</p>}
        {state.kind === 'error' && (
          <p className={css.error} role="alert">加载失败:{state.message}</p>
        )}
        {state.kind === 'ready' && executors.length === 0 && (
          <p className={css.empty}>暂无执行器</p>
        )}
        {state.kind === 'ready' && executors.length > 0 && (
          <ul className={css.list}>
            {executors.map((executor) => (
              <li key={executor.key}>
                <div className={css.row} data-builtin={executor.builtin || undefined}>
                  <div className={css.rowMain}>
                    <div className={css.rowTop}>
                      <span className={css.key}>{executor.key}</span>
                      {executor.builtin && <span className={css.builtin}>内置</span>}
                      {executor.model !== undefined && executor.model !== null && executor.model !== '' && (
                        <span className={css.model}>{executor.model}</span>
                      )}
                    </div>
                    <div className={css.meta}>
                      <span className={css.agentName}>{executor.agentName}</span>
                      <span className={css.bin}>{executor.bin}</span>
                    </div>
                    {argsPreview(executor.args) !== '' && <div className={css.args}>{argsPreview(executor.args)}</div>}
                  </div>
                  <div className={css.rowActions}>
                    <button
                      type="button"
                      className={css.copy}
                      data-copied={copiedKey === executor.key || undefined}
                      onClick={() => copyKey(executor.key)}
                      title={`${executor.key}（复制）`}
                    >
                      {copiedKey === executor.key ? '已复制' : '复制 key'}
                    </button>
                    {!executor.builtin && (
                      <button
                        type="button"
                        className={css.delete}
                        onClick={() => handleDelete(executor)}
                        title="删除"
                      >
                        删除
                      </button>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}
