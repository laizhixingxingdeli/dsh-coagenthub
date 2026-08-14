/**
 * CoAgentHub panel container (browser half). Hosts the 群列表 / 任务 / 执行器 /
 * 设置 content components behind a header + tab bar, so the shell overlay shows
 * a single floating panel instead of one per feature. The panel temporarily
 * widens while a task detail is expanded (data-detail-open), and a settings
 * save bumps a reload key so the data tabs refetch against the new address.
 * @module @laizhixingxingdeli/dsh-coagenthub/client-ui
 */

import { useEffect, useState } from 'react'
import css from './CoAgentHubPanel.module.css'
import { CoAgentHubGroupList, DEFAULT_API_BASE } from './CoAgentHubGroupList.tsx'
import { CoAgentHubTaskPanel } from './CoAgentHubTaskPanel.tsx'
import { CoAgentHubExecutorsPanel } from './CoAgentHubExecutorsPanel.tsx'
import { CoAgentHubSettings } from './CoAgentHubSettings.tsx'

/** Panel tabs: group list, task panel, executor management, and settings. */
export type CoAgentHubTab = 'groups' | 'tasks' | 'executors' | 'settings'

/** Panel props: only the API base is configurable; everything else is framework-injected. */
export interface CoAgentHubPanelProps {
  /** API base; defaults to the same-origin proxy route. */
  apiBase?: string
}

/** Tab order + copy, kept in one place for the tab bar and the tests. */
export const PANEL_TABS: ReadonlyArray<{ id: CoAgentHubTab; label: string }> = [
  { id: 'groups', label: '群列表' },
  { id: 'tasks', label: '任务' },
  { id: 'executors', label: '执行器' },
  { id: 'settings', label: '设置' },
]

/**
 * The CoAgentHub panel: header with a 群列表 | 任务 | 执行器 | 设置 tab bar over
 * the active content component. Keeps `aria-label="CoAgentHub 面板"` (phase-2
 * panel identity) so the overlay seat exposes a single labeled surface.
 */
export function CoAgentHubPanel({ apiBase = DEFAULT_API_BASE }: CoAgentHubPanelProps) {
  const [tab, setTab] = useState<CoAgentHubTab>('groups')
  const [taskDetailOpen, setTaskDetailOpen] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)

  // The task panel unmounts on tab switch; reset the widened-panel flag.
  useEffect(() => {
    if (tab !== 'tasks') setTaskDetailOpen(false)
  }, [tab])

  return (
    <section
      className={css.panel}
      data-detail-open={taskDetailOpen || undefined}
      aria-label="CoAgentHub 面板"
    >
      <header className={css.header}>
        <h2 className={css.title}>CoAgentHub</h2>
        <div className={css.tabs} role="tablist" aria-label="面板切换">
          {PANEL_TABS.map(({ id, label }) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              data-active={tab === id || undefined}
              className={css.tab}
              onClick={() => setTab(id)}
            >
              {label}
            </button>
          ))}
        </div>
      </header>
      <div className={css.body}>
        {tab === 'groups' && <CoAgentHubGroupList key={`groups-${reloadKey}`} apiBase={apiBase} />}
        {tab === 'tasks' && (
          <CoAgentHubTaskPanel
            key={`tasks-${reloadKey}`}
            apiBase={apiBase}
            onDetailChange={setTaskDetailOpen}
          />
        )}
        {tab === 'executors' && <CoAgentHubExecutorsPanel key={`executors-${reloadKey}`} apiBase={apiBase} />}
        {tab === 'settings' && <CoAgentHubSettings onSaved={() => setReloadKey((v) => v + 1)} />}
      </div>
    </section>
  )
}
