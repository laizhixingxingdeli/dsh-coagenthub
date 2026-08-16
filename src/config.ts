/**
 * CoAgentHub runtime settings (host half): an in-memory map persisted to
 * `$DSH_HOME/coagenthub-config.json` (or `~/.dsh/coagenthub-config.json` when
 * `DSH_HOME` is unset) so address changes survive restarts.
 * Read/write failures never block — memory is the fallback. Shared by the
 * proxy plugin (per-request forward target) and the tools plugin (client),
 * so saving from the panel takes effect without editing cordis.yml.
 * @module @laizhixingxingdeli/dsh-coagenthub/config
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

/** Mac→Win path mapping rule used to project group paths onto a Windows host. */
export interface PathMappingRule {
  /** Mac path prefix (segment boundary, trailing `/`), e.g. `/Users/apple/Desktop/Projects/`. */
  macPrefix: string
  /** Windows path prefix (trailing `\`), e.g. `Z:\`. */
  winPrefix: string
}

export interface CoAgentHubSettings {
  /** CoAgentHub API base URL; absent means unset (falls through the chain). */
  apiBase?: string
  /** Participant identity sent as `X-Participant-Id`; absent means unset. */
  participantId?: string
  /** Mac→Win path mapping rule for virtual workspaces; absent means unset. */
  mappingRule?: PathMappingRule
  /** Currently selected virtual workspace (group id); mirrored host-side. */
  activeGroupId?: string
  /**
   * Per-dsh-session workspace mapping: key=sessionId, value=groupId. 面板按
   * 当前 sessionId 保存手动选择,host 工具按当前会话 session.id 查询,彻底避免
   * 全局 activeGroupId 跨会话污染。空值(由 set 合并时以空串清除)不出现在这里。
   */
  sessionActiveGroups?: Record<string, string>
}

/** File name of the persisted settings under `$DSH_HOME` (or `~/.dsh`). */
export const CONFIG_FILE_NAME = 'coagenthub-config.json'

/**
 * Resolve the config file path: `$DSH_HOME/coagenthub-config.json` when
 * `DSH_HOME` is set, else fall back to `~/.dsh/coagenthub-config.json`
 * so settings still persist when dsh web runs without `DSH_HOME`.
 */
export function defaultConfigFilePath(): string {
  const home = process.env.DSH_HOME
  if (home !== undefined && home.trim() !== '') return join(home, CONFIG_FILE_NAME)
  return join(homedir(), '.dsh', CONFIG_FILE_NAME)
}

/**
 * Drop empty strings, unknown keys, and malformed mapping rules so persistence
 * stays clean. `sessionActiveGroups` is cleaned per entry: empty keys, non-string
 * values, and empty-string values are dropped; a non-object value drops the
 * whole record; an empty result drops the field entirely.
 */
function clean(settings: CoAgentHubSettings): CoAgentHubSettings {
  const out: CoAgentHubSettings = {}
  if (settings.apiBase !== undefined && settings.apiBase.trim() !== '') out.apiBase = settings.apiBase.trim()
  if (settings.participantId !== undefined && settings.participantId.trim() !== '') out.participantId = settings.participantId.trim()
  if (
    settings.activeGroupId !== undefined
    && typeof settings.activeGroupId === 'string'
    && settings.activeGroupId.trim() !== ''
  ) out.activeGroupId = settings.activeGroupId.trim()
  const rule = settings.mappingRule
  if (
    rule !== undefined
    && rule !== null
    && typeof rule.macPrefix === 'string' && rule.macPrefix.trim() !== ''
    && typeof rule.winPrefix === 'string' && rule.winPrefix.trim() !== ''
  ) {
    out.mappingRule = { macPrefix: rule.macPrefix.trim(), winPrefix: rule.winPrefix.trim() }
  }
  const record = settings.sessionActiveGroups
  if (
    record !== undefined
    && record !== null
    && typeof record === 'object'
    && !Array.isArray(record)
  ) {
    const cleaned: Record<string, string> = {}
    for (const [key, value] of Object.entries(record)) {
      if (typeof key !== 'string' || key.trim() === '') continue
      if (typeof value !== 'string' || value.trim() === '') continue
      cleaned[key] = value.trim()
    }
    if (Object.keys(cleaned).length > 0) out.sessionActiveGroups = cleaned
  }
  return out
}

/** Best-effort load; on any failure return `{}` (memory fallback). */
function loadFromDisk(filePath: string | null): CoAgentHubSettings {
  if (filePath === null) return {}
  try {
    const parsed = JSON.parse(readFileSync(filePath, 'utf8')) as Partial<CoAgentHubSettings>
    return clean({
      apiBase: parsed.apiBase,
      participantId: parsed.participantId,
      mappingRule: parsed.mappingRule,
      activeGroupId: parsed.activeGroupId,
      sessionActiveGroups: parsed.sessionActiveGroups,
    })
  } catch {
    return {}
  }
}

/** Best-effort persist; failures are swallowed (memory remains authoritative). */
function persistToDisk(filePath: string | null, settings: CoAgentHubSettings): void {
  if (filePath === null) return
  try {
    mkdirSync(dirname(filePath), { recursive: true })
    writeFileSync(filePath, JSON.stringify(settings, null, 2), 'utf8')
  } catch {
    // non-fatal: keep serving from memory
  }
}

/** Runtime settings store: memory map + best-effort disk persistence. */
export class CoAgentHubSettingsStore {
  private readonly filePath: string | null
  private settings: CoAgentHubSettings

  constructor(filePath: string | null = defaultConfigFilePath()) {
    this.filePath = filePath
    this.settings = loadFromDisk(filePath)
  }

  /** Current settings (copy; absent keys are `undefined`). */
  get(): CoAgentHubSettings {
    return { ...this.settings }
  }

  /**
   * Merge a patch, persist best-effort, and apply immediately.
   * A key whose patch value is `undefined` counts as "not provided" and keeps
   * its previous value; only explicitly provided values (including `''` or
   * `null`) are written, so a partial PUT never wipes other settings.
   *
   * `sessionActiveGroups` merges per sessionId: only the entries present in the
   * patch are written, other sessions' mappings stay untouched. An entry whose
   * value is `''`/`null` clears that session's mapping; `null` as the whole
   * patch value clears the entire record (mirrors `mappingRule: null`).
   */
  set(patch: CoAgentHubSettings): CoAgentHubSettings {
    const next: CoAgentHubSettings = { ...this.settings }
    if (patch.apiBase !== undefined) next.apiBase = patch.apiBase
    if (patch.participantId !== undefined) next.participantId = patch.participantId
    if (patch.mappingRule !== undefined) next.mappingRule = patch.mappingRule
    if (patch.activeGroupId !== undefined) next.activeGroupId = patch.activeGroupId
    if (patch.sessionActiveGroups !== undefined) {
      const record = patch.sessionActiveGroups
      if (record === null || typeof record !== 'object' || Array.isArray(record)) {
        // 不合法 record(null / 数组 / 非对象):与 clean() 一致,整体丢弃。
        delete next.sessionActiveGroups
      } else {
        const merged: Record<string, string> = { ...(next.sessionActiveGroups ?? {}) }
        for (const [sessionId, groupId] of Object.entries(record)) {
          if (typeof sessionId !== 'string' || sessionId.trim() === '') continue
          if (typeof groupId === 'string' && groupId.trim() !== '') merged[sessionId] = groupId.trim()
          else delete merged[sessionId]
        }
        next.sessionActiveGroups = merged
      }
    }
    this.settings = clean(next)
    persistToDisk(this.filePath, this.settings)
    return this.get()
  }
}

let sharedStore: CoAgentHubSettingsStore | null = null

/** Module-level singleton so the proxy and tools plugins share one store. */
export function getCoAgentHubSettingsStore(): CoAgentHubSettingsStore {
  if (sharedStore === null) sharedStore = new CoAgentHubSettingsStore()
  return sharedStore
}
