/**
 * CoAgentHub group-list content (browser half). Fetches the group list from the
 * same-origin proxy route the host half registers (default `/coagenthub-api`),
 * renders title + status per group, and copies a group id on row click. Mounted
 * inside the CoAgentHub panel's 群列表 tab (the panel container owns the
 * floating chrome).
 * @module @laizhixingxingdeli/dsh-coagenthub/client-ui
 */

import { useEffect, useState } from 'react'
import css from './CoAgentHubGroupList.module.css'

/** Same-origin proxy prefix the host half exposes over the CoAgentHub API. */
export const DEFAULT_API_BASE = '/coagenthub-api'

/** Page size used for the group-list fetch. */
export const GROUP_LIST_LIMIT = 50

/** Minimal group shape read from `GET {apiBase}/groups?limit=…`. */
export interface CoAgentHubGroupView {
  id: string
  title: string
  status: string
}

/** Panel props: only the API base is configurable; everything else is framework-injected. */
export interface CoAgentHubGroupListProps {
  /** API base; defaults to the same-origin proxy route. */
  apiBase?: string
}

type LoadState =
  | { kind: 'loading' }
  | { kind: 'ready'; groups: CoAgentHubGroupView[] }
  | { kind: 'error'; message: string }

/** Map the API status to the copy shown on the status badge. */
function statusLabel(status: string): string {
  if (status === 'active') return '进行中'
  if (status === 'archived') return '已归档'
  return status
}

/** Fetch `{apiBase}/groups?limit=…` and normalize into rows, throwing on failure. */
export async function fetchGroups(apiBase: string): Promise<CoAgentHubGroupView[]> {
  const response = await fetch(`${apiBase}/groups?limit=${GROUP_LIST_LIMIT}`)
  if (!response.ok) {
    const body = await response.text().catch(() => '')
    throw new Error(`HTTP ${response.status}${body !== '' ? `: ${body.slice(0, 200)}` : ''}`)
  }
  const data = (await response.json()) as { items?: CoAgentHubGroupView[] }
  return data.items ?? []
}

/**
 * The CoAgentHub group list panel: mounts, loads the group list once, and
 * renders rows whose click copies the group id to the clipboard.
 */
export function CoAgentHubGroupList({ apiBase = DEFAULT_API_BASE }: CoAgentHubGroupListProps) {
  const [state, setState] = useState<LoadState>({ kind: 'loading' })
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    let alive = true
    setState({ kind: 'loading' })
    fetchGroups(apiBase).then(
      (groups) => {
        if (alive) setState({ kind: 'ready', groups })
      },
      (error: unknown) => {
        if (alive) setState({ kind: 'error', message: error instanceof Error ? error.message : String(error) })
      },
    )
    return () => {
      alive = false
    }
  }, [apiBase, tick])

  const copyId = (id: string): void => {
    const clipboard = navigator.clipboard
    if (clipboard === undefined) return
    void clipboard.writeText(id).then(() => setCopiedId(id)).catch(() => {})
  }

  const groups = state.kind === 'ready' ? state.groups : []
  return (
    <section className={css.content} aria-label="CoAgentHub 群列表">
      <header className={css.header}>
        <div className={css.titleWrap}>
          <h2 className={css.title}>CoAgentHub 群列表</h2>
          {state.kind === 'ready' && <span className={css.count}>{groups.length}</span>}
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
      <div className={css.body}>
        {state.kind === 'loading' && <p className={css.loading}>加载中…</p>}
        {state.kind === 'error' && (
          <p className={css.error} role="alert">加载失败:{state.message}</p>
        )}
        {state.kind === 'ready' && groups.length === 0 && (
          <p className={css.empty}>暂无群组</p>
        )}
        {state.kind === 'ready' && groups.length > 0 && (
          <ul className={css.list}>
            {groups.map((group) => (
              <li key={group.id}>
                <button
                  type="button"
                  className={css.row}
                  data-copied={copiedId === group.id || undefined}
                  onClick={() => copyId(group.id)}
                  title={`${group.id}（点击复制）`}
                >
                  <span className={css.rowMain}>
                    <span className={css.title}>{group.title}</span>
                    <span className={css.meta}>
                      <span className={css.dot} data-state={group.status} />
                      <span className={css.statusText}>{statusLabel(group.status)}</span>
                    </span>
                  </span>
                  {copiedId === group.id && <span className={css.copied}>已复制</span>}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}
