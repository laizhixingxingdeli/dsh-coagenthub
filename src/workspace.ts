/**
 * Virtual-workspace host logic (Windows one-click setup). A virtual workspace
 * is a CoAgentHub group projection: the group's Mac `projectPath` re-rooted
 * through a path-mapping rule (`macPrefix` → `winPrefix`, e.g.
 * `/Users/apple/Desktop/Projects` → `Z:\`), so a Windows host can register the
 * mapped path in the dsh `workspaceRegistry` after mapping the Mac share as a
 * network drive (`net use Z: \\<mac-ip>\<shareName>`).
 *
 * The pure functions (prefix inference, path mapping, net-use args) are split
 * from the IO orchestration so the whole flow is unit-testable without a
 * real Windows box, real `net` binary, or a live dsh registry.
 * @module @laizhixingxingdeli/dsh-coagenthub/workspace
 */

import { execFile } from 'node:child_process'
import { stat } from 'node:fs/promises'
import type { CoAgentHubSettingsStore, PathMappingRule } from './config.ts'

/** Minimal structural face of one dsh workspace registry record. */
export interface WorkspaceLike {
  readonly id: string
  readonly path: string
  readonly title: string
  setTitle?(title: string): Promise<void>
}

/** Minimal structural face of the dsh `workspaceRegistry` cordis service. */
export interface WorkspaceRegistryLike {
  create(path: string, title?: string): Promise<WorkspaceLike>
  list(): WorkspaceLike[]
}

/** A CoAgentHub group carrying the Mac project path (when bound). */
export interface GroupWithPath {
  id: string
  title: string
  projectPath?: string | null
}

/** Runs `net use` with the given arguments; resolves stdout on exit 0. */
export type NetUseRunner = (args: string[]) => Promise<string>

/** Whether a Windows path currently exists and is a directory. */
export type PathExists = (winPath: string) => Promise<boolean>

/** Fatal setup failure carrying the HTTP status the proxy should reply with. */
export class WorkspaceSetupError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'WorkspaceSetupError'
    this.status = status
  }
}

/** Extract the hostname from an API base URL; null when unset or unparsable. */
export function extractApiHost(apiBase: string | null | undefined): string | null {
  if (apiBase === undefined || apiBase === null || apiBase.trim() === '') return null
  try {
    const hostname = new URL(apiBase.trim()).hostname
    return hostname === '' ? null : hostname
  } catch {
    return null
  }
}

function splitSegments(path: string): string[] {
  return path.split('/').filter(segment => segment !== '')
}

/**
 * Infer the shared Mac path prefix of several project paths, as a
 * segment-boundary prefix ending in `/`. A single path contributes its
 * directory (so its own winPath keeps the last segment); paths sharing no
 * common segment prefix yield `null`.
 */
export function inferMacPrefix(paths: readonly string[]): string | null {
  const unique = [...new Set(paths
    .map(path => path.trim().replace(/\/+$/, ''))
    .filter(path => path !== ''))]
  if (unique.length === 0) return null
  const segmentLists = unique.map(splitSegments)
  if (unique.length === 1) {
    const segments = segmentLists[0]!
    if (segments.length <= 1) return null
    return `/${segments.slice(0, -1).join('/')}/`
  }
  let common = segmentLists[0]!
  for (const segments of segmentLists.slice(1)) {
    let i = 0
    while (i < common.length && i < segments.length && common[i] === segments[i]) i++
    common = common.slice(0, i)
    if (common.length === 0) break
  }
  if (common.length === 0) return null
  return `/${common.join('/')}/`
}

/** Ensure a Windows prefix ends with a single backslash. */
export function normalizeWinPrefix(prefix: string): string {
  const trimmed = prefix.trim().replace(/[\\/]+$/, '')
  return trimmed === '' ? '\\' : `${trimmed}\\`
}

/**
 * Map a Mac path through the rule into a Windows path (`/` → `\`). Returns
 * null when the path lies outside the mapped prefix.
 */
export function projectToWinPath(macPath: string, macPrefix: string, winPrefix: string): string | null {
  const path = macPath.trim().replace(/\/+$/, '')
  const prefix = macPrefix.trim().replace(/\/+$/, '')
  if (path !== prefix && !path.startsWith(`${prefix}/`)) return null
  const root = normalizeWinPrefix(winPrefix)
  const relative = path === prefix ? '' : path.slice(prefix.length + 1)
  if (relative === '') return root
  return root + relative.replaceAll('/', '\\')
}

/** Build the mapping rule for a drive letter; null when no common prefix. */
export function buildMappingRule(
  projectPaths: readonly string[],
  driveLetter: string,
): PathMappingRule | null {
  const macPrefix = inferMacPrefix(projectPaths)
  if (macPrefix === null) return null
  const letter = driveLetter.trim().toUpperCase()
  return { macPrefix, winPrefix: `${letter}:\\` }
}

export interface NetUseCredentials {
  user?: string
  password?: string
}

/**
 * `net use <D>: \\<ip>\<share> [password] /user:<user> /persistent:yes` as an
 * argv array (no shell, so the password cannot inject commands).
 */
export function buildNetUseArgs(
  ip: string,
  shareName: string,
  driveLetter: string,
  credentials?: NetUseCredentials,
): string[] {
  const letter = driveLetter.trim().toUpperCase()
  const args = ['use', `${letter}:`, `\\\\${ip}\\${shareName}`]
  if (credentials?.password !== undefined && credentials.password !== '') args.push(credentials.password)
  if (credentials?.user !== undefined && credentials.user !== '') args.push(`/user:${credentials.user}`)
  args.push('/persistent:yes')
  return args
}

/** Real `net use` runner: resolves stdout, rejects with the captured stderr. */
export const defaultNetUse: NetUseRunner = args =>
  new Promise((resolve, reject) => {
    execFile('net', args, { windowsHide: true }, (error, stdout, stderr) => {
      if (error !== null) {
        const message = stderr.trim() !== '' ? stderr.trim() : error.message
        reject(new Error(message))
        return
      }
      resolve(stdout)
    })
  })

/** Real path check: the mapped Windows path must exist and be a directory. */
export const defaultPathExists: PathExists = async winPath => {
  try {
    return (await stat(winPath)).isDirectory()
  } catch {
    return false
  }
}

/** Case-insensitive path comparison (Windows paths are case-insensitive). */
function samePath(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase()
}

export interface WorkspaceRouteDeps {
  /** Effective platform (`process.platform`); non-win32 is rejected. */
  getPlatform(): string
  /** Effective CoAgentHub API base; used to extract the Mac IP. */
  getApiBase(): string | null
  runNetUse: NetUseRunner
  pathExists: PathExists
  /** The dsh workspace registry service, or null when unavailable. */
  getRegistry(): WorkspaceRegistryLike | null
  store: CoAgentHubSettingsStore
  listGroups(): Promise<GroupWithPath[]>
}

export interface WorkspaceSetupInput {
  shareName?: string
  macUser?: string
  macPassword?: string
  driveLetter?: string
}

export interface WorkspaceMappedItem {
  groupTitle: string
  winPath: string
  registered: boolean
}

export interface WorkspaceFailureItem {
  groupTitle: string
  winPath: string | null
  reason: string
}

export interface WorkspaceSetupResult {
  ok: true
  mappingRule: PathMappingRule
  mapped: WorkspaceMappedItem[]
  failures: WorkspaceFailureItem[]
}

function projectGroups(groups: GroupWithPath[]): GroupWithPath[] {
  return groups.filter(group => group.projectPath !== undefined && group.projectPath !== null && group.projectPath.trim() !== '')
}

/**
 * One-click setup: map the network drive, infer + persist the mapping rule,
 * then register every group whose mapped path exists in the dsh workspace
 * registry (name = group title; existing registrations get their title
 * updated instead of being duplicated). Throws {@link WorkspaceSetupError}
 * on fatal conditions; per-group problems land in `failures`.
 */
export async function runWorkspaceSetup(
  input: WorkspaceSetupInput,
  deps: WorkspaceRouteDeps,
): Promise<WorkspaceSetupResult> {
  if (deps.getPlatform() !== 'win32') {
    throw new WorkspaceSetupError(400, '仅 Windows 支持自动映射')
  }
  const shareName = input.shareName?.trim() ?? ''
  if (shareName === '') throw new WorkspaceSetupError(400, 'shareName 不能为空')
  const driveLetter = (input.driveLetter?.trim() || 'Z').toUpperCase()
  if (!/^[A-Z]$/.test(driveLetter)) throw new WorkspaceSetupError(400, `非法盘符:${driveLetter}`)

  const ip = extractApiHost(deps.getApiBase())
  if (ip === null) throw new WorkspaceSetupError(400, '未配置有效的 CoAgentHub 地址(apiBase)')

  const args = buildNetUseArgs(ip, shareName, driveLetter, { user: input.macUser, password: input.macPassword })
  try {
    await deps.runNetUse(args)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new WorkspaceSetupError(502, `net use 失败:${message}`)
  }

  let groups: GroupWithPath[]
  try {
    groups = await deps.listGroups()
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new WorkspaceSetupError(502, `拉取群列表失败:${message}`)
  }
  const bound = projectGroups(groups)

  const mappingRule = buildMappingRule(bound.map(group => group.projectPath!), driveLetter)
  if (mappingRule === null) {
    throw new WorkspaceSetupError(400, '无法从群路径推断公共前缀,请手动配置路径映射规则')
  }
  deps.store.set({ mappingRule })

  const registry = deps.getRegistry()
  if (registry === null) throw new WorkspaceSetupError(503, 'workspaceRegistry 服务不可用')

  const mapped: WorkspaceMappedItem[] = []
  const failures: WorkspaceFailureItem[] = []
  for (const group of bound) {
    const projectPath = group.projectPath!
    const winPath = projectToWinPath(projectPath, mappingRule.macPrefix, mappingRule.winPrefix)
    if (winPath === null) {
      failures.push({ groupTitle: group.title, winPath: null, reason: '路径不在映射前缀内' })
      continue
    }
    if (!(await deps.pathExists(winPath))) {
      failures.push({ groupTitle: group.title, winPath, reason: '路径不存在或不可访问' })
      continue
    }
    const existing = registry.list().find(workspace => samePath(workspace.path, winPath))
    try {
      if (existing !== undefined) {
        await existing.setTitle?.(group.title)
        mapped.push({ groupTitle: group.title, winPath, registered: true })
      } else {
        await registry.create(winPath, group.title)
        mapped.push({ groupTitle: group.title, winPath, registered: true })
      }
    } catch (error) {
      failures.push({
        groupTitle: group.title,
        winPath,
        reason: error instanceof Error ? error.message : String(error),
      })
    }
  }

  return { ok: true, mappingRule, mapped, failures }
}

export interface WorkspaceStatusItem {
  groupId: string
  groupTitle: string
  macPath: string
  winPath: string | null
  pathExists: boolean
  registered: boolean | null
}

export interface WorkspaceStatusView {
  mappingRule: PathMappingRule | null
  workspaces: WorkspaceStatusItem[]
}

/**
 * Read-only status: the persisted mapping rule plus, per bound group, the
 * mapped winPath, whether it exists on this host, and whether the dsh
 * registry already knows it (`null` when the registry is unavailable).
 */
export async function buildWorkspaceStatus(deps: WorkspaceRouteDeps): Promise<WorkspaceStatusView> {
  const mappingRule = deps.store.get().mappingRule ?? null
  const registry = deps.getRegistry()
  const registeredPaths = new Set(
    registry === null ? [] : registry.list().map(workspace => workspace.path.toLowerCase()),
  )
  let groups: GroupWithPath[] = []
  try {
    groups = await deps.listGroups()
  } catch {
    // status is read-only: an unreachable API degrades to an empty list
  }
  const workspaces: WorkspaceStatusItem[] = []
  for (const group of projectGroups(groups)) {
    const macPath = group.projectPath!
    const winPath = mappingRule === null
      ? null
      : projectToWinPath(macPath, mappingRule.macPrefix, mappingRule.winPrefix)
    const pathExists = winPath === null ? false : await deps.pathExists(winPath)
    const registered = winPath === null || registry === null
      ? null
      : registeredPaths.has(winPath.toLowerCase())
    workspaces.push({ groupId: group.id, groupTitle: group.title, macPath, winPath, pathExists, registered })
  }
  return { mappingRule, workspaces }
}
