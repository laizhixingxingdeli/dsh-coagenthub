/**
 * CoAgentHub panel container (browser half). Hosts the 群列表 and 任务 content
 * components behind a header + tab bar, so the shell overlay shows a single
 * floating panel instead of one per feature.
 * @module @laizhixingxingdeli/dsh-coagenthub/client-ui
 */

import { useState } from 'react'
import css from './CoAgentHubPanel.module.css'
import { CoAgentHubGroupList, DEFAULT_API_BASE } from './CoAgentHubGroupList.tsx'
import { CoAgentHubTaskPanel } from './CoAgentHubTaskPanel.tsx'

/** Panel tabs: group list and task panel. */
export type CoAgentHubTab = 'groups' | 'tasks'

/** Panel props: only the API base is configurable; everything else is framework-injected. */
export interface CoAgentHubPanelProps {
  /** API base; defaults to the same-origin proxy route. */
  apiBase?: string
}

/** Tab order + copy, kept in one place for the tab bar and the tests. */
export const PANEL_TABS: ReadonlyArray<{ id: CoAgentHubTab; label: string }> = [
  { id: 'groups', label: '群列表' },
  { id: 'tasks', label: '任务' },
]

/**
 * The CoAgentHub panel: header with a 群列表 | 任务 tab bar over the active
 * content component. Keeps `aria-label="CoAgentHub 面板"` (phase-2 panel
 * identity) so the overlay seat exposes a single labeled surface.
 */
export function CoAgentHubPanel({ apiBase = DEFAULT_API_BASE }: CoAgentHubPanelProps) {
  const [tab, setTab] = useState<CoAgentHubTab>('groups')

  return (
    <section className={css.panel} aria-label="CoAgentHub 面板">
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
        {tab === 'groups'
          ? <CoAgentHubGroupList apiBase={apiBase} />
          : <CoAgentHubTaskPanel apiBase={apiBase} />}
      </div>
    </section>
  )
}
