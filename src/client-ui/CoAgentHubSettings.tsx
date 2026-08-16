/**
 * CoAgentHub settings form (browser half). Reads the runtime settings from the
 * host (`/coagenthub-api-config`, served by the proxy plugin, never forwarded)
 * and saves them back. The host resolves its forward target per request, so a
 * save applies immediately — the 群列表 / 任务 / 执行器 tabs pick up the new
 * address on their next load, no cordis.yml edit or restart needed (Win 场景).
 * Below the form, the 「虚拟工作区」 section shows the mapping-rule status and
 * runs the one-click Windows setup (`POST /coagenthub-api/workspace-setup`).
 * @module @laizhixingxingdeli/dsh-coagenthub/client-ui
 */

import { useEffect, useState, type FormEvent } from 'react'
import css from './CoAgentHubSettings.module.css'
import {
  fetchWorkspaceStatus,
  isWindowsPlatform,
  SETTINGS_PATH,
  WORKSPACE_SETUP_PATH,
  type PathMappingRuleView,
  type WorkspaceStatusView,
} from './workspace-status.ts'

export { SETTINGS_PATH }

/** Settings shape exchanged with the host half. */
export interface CoAgentHubSettingsView {
  apiBase?: string
  participantId?: string
  mappingRule?: PathMappingRuleView
  activeGroupId?: string
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
  /**
   * 当前 dsh 会话记忆的工作区(由面板传入,面板已按会话切换刷新);缺省
   * (undefined)时回退 fetchSettings 的全局 activeGroupId。
   */
  activeGroupId?: string
}

type LoadState =
  | { kind: 'idle' }
  | { kind: 'ready' }
  | { kind: 'error'; message: string }

/** One-click setup result as returned by the host endpoint. */
export interface WorkspaceSetupResultView {
  ok: boolean
  mappingRule?: PathMappingRuleView
  mapped?: Array<{ groupTitle: string; winPath: string; registered: boolean }>
  failures?: Array<{ groupTitle: string; winPath: string | null; reason: string }>
}

type SetupState =
  | { kind: 'idle' }
  | { kind: 'running' }
  | { kind: 'done'; result: WorkspaceSetupResultView }
  | { kind: 'error'; message: string }

/**
 * The settings form: CoAgentHub 地址 + participantId(可空)+ 保存,plus the
 * 虚拟工作区 section (mapping status + one-click setup). Pre-fills from the
 * host on mount and shows「已保存,立即生效」after a successful save.
 */
export function CoAgentHubSettings({ onSaved, activeGroupId: sessionActiveGroupId }: CoAgentHubSettingsProps) {
  const [apiBase, setApiBase] = useState('')
  const [participantId, setParticipantId] = useState('')
  const [activeGroupId, setActiveGroupId] = useState('')
  const [loadState, setLoadState] = useState<LoadState>({ kind: 'idle' })
  const [saveState, setSaveState] = useState<LoadState>({ kind: 'idle' })

  const [status, setStatus] = useState<WorkspaceStatusView | null>(null)
  const [statusError, setStatusError] = useState<string | null>(null)
  const [shareName, setShareName] = useState('')
  const [macUser, setMacUser] = useState('')
  const [macPassword, setMacPassword] = useState('')
  const [driveLetter, setDriveLetter] = useState('Z')
  const [setup, setSetup] = useState<SetupState>({ kind: 'idle' })

  // 设置加载 effect 先声明,保证 mock 的响应顺序在测试里可预期。
  useEffect(() => {
    let alive = true
    fetchSettings().then(
      (settings) => {
        if (!alive) return
        setApiBase(settings.apiBase ?? '')
        setParticipantId(settings.participantId ?? '')
        setActiveGroupId(settings.activeGroupId ?? '')
        setLoadState({ kind: 'ready' })
      },
      (error: unknown) => {
        if (alive) setLoadState({ kind: 'error', message: error instanceof Error ? error.message : String(error) })
      },
    )
    return () => { alive = false }
  }, [])

  // 虚拟工作区状态加载(mapping 规则 + 每个群的投影状态)。
  useEffect(() => {
    let alive = true
    fetchWorkspaceStatus().then(
      (view) => {
        if (!alive) return
        setStatus(view)
        setStatusError(null)
      },
      (error: unknown) => {
        if (alive) setStatusError(error instanceof Error ? error.message : String(error))
      },
    )
    return () => { alive = false }
  }, [])

  const handleSubmit = (event: FormEvent): void => {
    event.preventDefault()
    void saveSettings({
      apiBase: apiBase.trim() === '' ? '' : apiBase.trim(),
      participantId: participantId.trim() === '' ? '' : participantId.trim(),
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

  const handleSetup = (event: FormEvent): void => {
    event.preventDefault()
    setSetup({ kind: 'running' })
    void fetch(WORKSPACE_SETUP_PATH, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        shareName: shareName.trim(),
        macUser: macUser.trim() === '' ? undefined : macUser.trim(),
        macPassword: macPassword === '' ? undefined : macPassword,
        driveLetter: driveLetter.trim() === '' ? undefined : driveLetter.trim(),
      }),
    }).then(
      async (response) => {
        const body = (await response.json().catch(() => ({}))) as WorkspaceSetupResultView & { error?: string }
        if (!response.ok) {
          setSetup({ kind: 'error', message: body.error ?? `HTTP ${response.status}` })
          return
        }
        setSetup({ kind: 'done', result: body })
        // 设置成功后刷新状态,让「已注册数」反映最新注册结果。
        try {
          setStatus(await fetchWorkspaceStatus())
          setStatusError(null)
        } catch (error) {
          setStatusError(error instanceof Error ? error.message : String(error))
        }
      },
      (error: unknown) => {
        setSetup({ kind: 'error', message: error instanceof Error ? error.message : String(error) })
      },
    )
  }

  const windows = isWindowsPlatform()
  const workspaces = status?.workspaces ?? []
  const registeredCount = workspaces.filter(workspace => workspace.registered === true).length

  // 只读状态区数据:participantId 来自 fetchSettings();「当前工作区」优先用面板
  // 传入的会话记忆值(切换会话时面板已刷新),缺省时回退 fetchSettings 的全局
  // activeGroupId;群名在 workspace-status 的群列表里反查(找不到时回退显示 id)。
  // 空值(无保存记录)=「自动(按 cwd)」,由 agent 工具按会话 cwd 解析。
  const displayGroupId = sessionActiveGroupId !== undefined ? sessionActiveGroupId : activeGroupId
  const activeWorkspace = workspaces.find(workspace => workspace.groupId === displayGroupId)
  const activeGroupTitle = displayGroupId.trim() === ''
    ? '自动（按 cwd）'
    : activeWorkspace?.groupTitle ?? displayGroupId

  const handleCopyParticipantId = (): void => {
    const value = participantId.trim()
    if (value === '') return
    void navigator.clipboard?.writeText(value).catch(() => {})
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
      <section className={css.statusSection} aria-label="当前身份与工作区">
        <h3 className={css.wsTitle}>当前身份与工作区</h3>
        <div className={css.statusRow}>
          <span className={css.label}>当前 participantId</span>
          <span className={css.statusValue} aria-label="当前 participantId">
            {participantId.trim() === '' ? '未设置' : participantId}
          </span>
          {participantId.trim() !== '' && (
            <button type="button" className={css.copy} onClick={handleCopyParticipantId} aria-label="复制 participantId">
              复制
            </button>
          )}
        </div>
        <div className={css.statusRow}>
          <span className={css.label}>当前工作区</span>
          <span className={css.statusValue} aria-label="当前工作区群名">
            {activeGroupTitle}
          </span>
        </div>
      </section>
      <section className={css.wsSection} aria-label="虚拟工作区">
        <h3 className={css.wsTitle}>虚拟工作区</h3>
        {statusError !== null && <p className={css.wsError}>{statusError}</p>}
        {status !== null && (
          <div className={css.wsStatus}>
            {status.mappingRule !== null ? (
              <p className={css.wsRule}>{status.mappingRule.macPrefix} → {status.mappingRule.winPrefix}</p>
            ) : (
              <p className={css.wsRule}>未配置路径映射规则</p>
            )}
            <p className={css.wsMeta}>已注册 {registeredCount}/{workspaces.length} 个虚拟工作区</p>
          </div>
        )}
        {!windows && <p className={css.wsNote}>自动映射仅 Windows 支持</p>}
        <form className={css.wsForm} onSubmit={handleSetup}>
          <label className={css.field}>
            <span className={css.label}>共享名(Share Name)</span>
            <input
              className={css.input}
              value={shareName}
              onChange={(event) => setShareName(event.target.value)}
              placeholder="Projects"
              aria-label="共享名"
            />
          </label>
          <label className={css.field}>
            <span className={css.label}>Mac 账号(可选)</span>
            <input
              className={css.input}
              value={macUser}
              onChange={(event) => setMacUser(event.target.value)}
              aria-label="Mac 账号"
            />
          </label>
          <label className={css.field}>
            <span className={css.label}>Mac 密码(可选)</span>
            <input
              className={css.input}
              type="password"
              value={macPassword}
              onChange={(event) => setMacPassword(event.target.value)}
              aria-label="Mac 密码"
            />
          </label>
          <label className={css.field}>
            <span className={css.label}>盘符</span>
            <input
              className={css.input}
              value={driveLetter}
              onChange={(event) => setDriveLetter(event.target.value)}
              placeholder="Z"
              aria-label="盘符"
            />
          </label>
          <div className={css.actions}>
            <button
              type="submit"
              className={css.save}
              disabled={!windows || setup.kind === 'running'}
              aria-label="一键设置"
            >
              {setup.kind === 'running' ? '设置中…' : '一键设置'}
            </button>
            {setup.kind === 'error' && <p className={css.wsError} role="alert">设置失败:{setup.message}</p>}
            {setup.kind === 'done' && (
              <div className={css.wsResult}>
                <p className={css.wsOk} role="status">
                  设置完成:注册 {setup.result.mapped?.length ?? 0} 个,失败 {setup.result.failures?.length ?? 0} 个
                </p>
                {(setup.result.failures?.length ?? 0) > 0 && (
                  <ul className={css.wsFailures}>
                    {setup.result.failures!.map(failure => (
                      <li key={failure.groupTitle}>{failure.groupTitle}:{failure.reason}</li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
        </form>
      </section>
    </section>
  )
}
