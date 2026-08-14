/**
 * CoAgentHub settings form (browser half). Reads the runtime settings from the
 * host (`/coagenthub-api-config`, served by the proxy plugin, never forwarded)
 * and saves them back. The host resolves its forward target per request, so a
 * save applies immediately — the 群列表 / 任务 / 执行器 tabs pick up the new
 * address on their next load, no cordis.yml edit or restart needed (Win 场景).
 * @module @laizhixingxingdeli/dsh-coagenthub/client-ui
 */

import { useEffect, useState, type FormEvent } from 'react'
import css from './CoAgentHubSettings.module.css'

/** Same-origin settings route served by the host half (GET/PUT). */
export const SETTINGS_PATH = '/coagenthub-api-config'

/** Settings shape exchanged with the host half. */
export interface CoAgentHubSettingsView {
  apiBase?: string
  participantId?: string
}

/** Fetch the current settings; throws on non-ok. */
export async function fetchSettings(): Promise<CoAgentHubSettingsView> {
  const response = await fetch(SETTINGS_PATH)
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  return (await response.json()) as CoAgentHubSettingsView
}

/** Save a settings patch; returns the saved settings. */
export async function saveSettings(patch: CoAgentHubSettingsView): Promise<CoAgentHubSettingsView> {
  const response = await fetch(SETTINGS_PATH, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  const data = (await response.json()) as { ok?: boolean; settings?: CoAgentHubSettingsView }
  return data.settings ?? patch
}

export interface CoAgentHubSettingsProps {
  /** Called after a successful save; the panel uses it to reload the other tabs. */
  onSaved?: () => void
}

type LoadState =
  | { kind: 'idle' }
  | { kind: 'ready' }
  | { kind: 'error'; message: string }

/**
 * The settings form: CoAgentHub 地址 + participantId(可空)+ 保存. Pre-fills
 * from the host on mount and shows「已保存,立即生效」after a successful save.
 */
export function CoAgentHubSettings({ onSaved }: CoAgentHubSettingsProps) {
  const [apiBase, setApiBase] = useState('')
  const [participantId, setParticipantId] = useState('')
  const [loadState, setLoadState] = useState<LoadState>({ kind: 'idle' })
  const [saveState, setSaveState] = useState<LoadState>({ kind: 'idle' })

  useEffect(() => {
    let alive = true
    fetchSettings().then(
      (settings) => {
        if (!alive) return
        setApiBase(settings.apiBase ?? '')
        setParticipantId(settings.participantId ?? '')
        setLoadState({ kind: 'ready' })
      },
      (error: unknown) => {
        if (alive) setLoadState({ kind: 'error', message: error instanceof Error ? error.message : String(error) })
      },
    )
    return () => { alive = false }
  }, [])

  const handleSubmit = (event: FormEvent): void => {
    event.preventDefault()
    void saveSettings({
      apiBase: apiBase.trim() === '' ? undefined : apiBase.trim(),
      participantId: participantId.trim() === '' ? undefined : participantId.trim(),
    }).then(
      () => {
        setSaveState({ kind: 'ready' })
        onSaved?.()
      },
      (error: unknown) => {
        setSaveState({ kind: 'error', message: error instanceof Error ? error.message : String(error) })
      },
    )
  }

  return (
    <section className={css.content} aria-label="CoAgentHub 设置">
      <header className={css.header}>
        <h2 className={css.title}>CoAgentHub 设置</h2>
      </header>
      <form className={css.form} onSubmit={handleSubmit}>
        <label className={css.field}>
          <span className={css.label}>CoAgentHub 地址</span>
          <input
            className={css.input}
            value={apiBase}
            onChange={(event) => setApiBase(event.target.value)}
            placeholder="http://localhost:3001/api"
            aria-label="CoAgentHub 地址"
          />
        </label>
        <label className={css.field}>
          <span className={css.label}>participantId</span>
          <input
            className={css.input}
            value={participantId}
            onChange={(event) => setParticipantId(event.target.value)}
            placeholder="可选"
            aria-label="participantId"
          />
        </label>
        <div className={css.actions}>
          <button type="submit" className={css.save}>保存</button>
          {saveState.kind === 'ready' && <p className={css.saved} role="status">已保存,立即生效</p>}
        </div>
        {loadState.kind === 'error' && (
          <p className={css.error} role="alert">设置加载失败:{loadState.message}</p>
        )}
        {saveState.kind === 'error' && (
          <p className={css.error} role="alert">保存失败:{saveState.message}</p>
        )}
      </form>
    </section>
  )
}
