/**
 * CoAgentHub runtime settings (host half): an in-memory map persisted to
 * `$DSH_HOME/coagenthub-config.json` so address changes survive restarts.
 * Read/write failures never block — memory is the fallback. Shared by the
 * proxy plugin (per-request forward target) and the tools plugin (client),
 * so saving from the panel takes effect without editing cordis.yml.
 * @module @laizhixingxingdeli/dsh-coagenthub/config
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
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
}

/** File name of the persisted settings under `$DSH_HOME`. */
export const CONFIG_FILE_NAME = 'coagenthub-config.json'

/** Resolve the config file path from `$DSH_HOME`; null when unset (memory only). */
export function defaultConfigFilePath(): string | null {
  const home = process.env.DSH_HOME
  if (home === undefined || home.trim() === '') return null
  return join(home, CONFIG_FILE_NAME)
}

/** Drop empty strings, unknown keys, and malformed mapping rules so persistence stays clean. */
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

  /** Merge a patch, persist best-effort, and apply immediately. */
  set(patch: CoAgentHubSettings): CoAgentHubSettings {
    this.settings = clean({
      ...this.settings,
      apiBase: patch.apiBase,
      participantId: patch.participantId,
      mappingRule: patch.mappingRule,
      activeGroupId: patch.activeGroupId,
    })
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
