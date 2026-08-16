/**
 * Virtual-workspace client helpers (browser half). Fetches the workspace status
 * the host half exposes (`GET /coagenthub-api/workspace-status`: mapping rule +
 * per-group projection state), persists the active selection to localStorage
 * (and mirrors it to the host settings so the agent-side
 * `coagenthub_get_active_group` tool can read it), and detects Windows for the
 * one-click setup affordance.
 * @module @laizhixingxingdeli/dsh-coagenthub/client-ui/workspace-status
 */

/** Same-origin settings route served by the host half (GET/PUT). */
export const SETTINGS_PATH = '/coagenthub-api-config'

/** Same-origin workspace endpoints served by the host half (never forwarded). */
export const WORKSPACE_SETUP_PATH = '/coagenthub-api/workspace-setup'
export const WORKSPACE_STATUS_PATH = '/coagenthub-api/workspace-status'

/** localStorage key remembering the currently selected virtual workspace. */
export const ACTIVE_GROUP_STORAGE_KEY = 'coagenthub.activeGroupId'

/** localStorage key (dsh web front end) holding the current dsh session id. */
export const DSH_SESSION_STORAGE_KEY = 'dsh.sessions.current'

/** Per-session localStorage key prefix: `coagenthub.activeGroup.<sessionId>`. */
export const ACTIVE_GROUP_SESSION_KEY_PREFIX = 'coagenthub.activeGroup.'

/** Read the current dsh session id; null when absent or unparsable. */
export function getCurrentDshSessionId(): string | null {
  try {
    const raw = localStorage.getItem(DSH_SESSION_STORAGE_KEY)
    if (raw === null || raw === '') return null
    const parsed = JSON.parse(raw) as { sessionId?: unknown }
    return typeof parsed.sessionId === 'string' && parsed.sessionId !== '' ? parsed.sessionId : null
  } catch {
    return null
  }
}

/** Per-session localStorage key remembering the selected workspace. */
export function activeGroupSessionKey(sessionId: string): string {
  return `${ACTIVE_GROUP_SESSION_KEY_PREFIX}${sessionId}`
}

export interface PathMappingRuleView {
  macPrefix: string
  winPrefix: string
}

export interface WorkspaceStatusItemView {
  groupId: string
  groupTitle: string
  macPath: string
  winPath: string | null
  pathExists: boolean
  registered: boolean | null
}

export interface WorkspaceStatusView {
  mappingRule: PathMappingRuleView | null
  workspaces: WorkspaceStatusItemView[]
}

/** Fetch the workspace status; throws on non-ok; degrades missing fields. */
export async function fetchWorkspaceStatus(): Promise<WorkspaceStatusView> {
  const response = await fetch(WORKSPACE_STATUS_PATH)
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  const data = (await response.json()) as Partial<WorkspaceStatusView>
  return { mappingRule: data.mappingRule ?? null, workspaces: data.workspaces ?? [] }
}

/** Mirror the active selection to the host settings store (host tool reads it). */
export async function saveActiveGroupId(groupId: string | null): Promise<void> {
  const response = await fetch(SETTINGS_PATH, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    // 空串而非 undefined:JSON.stringify 会丢弃 undefined 键,导致 host 收不到
    // 清除信号、镜像里残留旧值;空串会被 host 的 clean() 丢弃,即清除。
    body: JSON.stringify({ activeGroupId: groupId ?? '' }),
  })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
}

/**
 * Read the remembered selection; null when absent or localStorage unusable.
 * Prefers the current dsh session's per-session key, falling back to the
 * global key (pre-session behavior) when no session or no per-session entry.
 */
export function readActiveGroupId(): string | null {
  try {
    const sessionId = getCurrentDshSessionId()
    if (sessionId !== null) {
      const perSession = localStorage.getItem(activeGroupSessionKey(sessionId))
      if (perSession !== null && perSession !== '') return perSession
    }
    const raw = localStorage.getItem(ACTIVE_GROUP_STORAGE_KEY)
    return raw !== null && raw !== '' ? raw : null
  } catch {
    return null
  }
}

/**
 * Remember the selection in localStorage (best-effort). Writes the current
 * dsh session's per-session key AND the global key (kept for compatibility
 * with the host mirror and pre-session consumers).
 */
export function writeActiveGroupId(groupId: string | null): void {
  try {
    const sessionId = getCurrentDshSessionId()
    if (groupId === null || groupId === '') {
      localStorage.removeItem(ACTIVE_GROUP_STORAGE_KEY)
      if (sessionId !== null) localStorage.removeItem(activeGroupSessionKey(sessionId))
    } else {
      localStorage.setItem(ACTIVE_GROUP_STORAGE_KEY, groupId)
      if (sessionId !== null) localStorage.setItem(activeGroupSessionKey(sessionId), groupId)
    }
  } catch {
    // 持久化失败不影响本次选择
  }
}

/** Whether the current browser platform is Windows (drives the setup affordance). */
export function isWindowsPlatform(platform: string = navigator.platform): boolean {
  return platform.toLowerCase().includes('win')
}
