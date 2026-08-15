import { describe, expect, it, vi } from 'vitest'
import { CoAgentHubSettingsStore } from '../src/config.ts'
import {
  buildMappingRule,
  buildNetUseArgs,
  buildWorkspaceStatus,
  extractApiHost,
  findGroupByWorkspaceCwd,
  groupProjectWinPath,
  inferMacPrefix,
  isWindowsLocalPath,
  projectToWinPath,
  runWorkspaceSetup,
  sameWindowsPath,
  WorkspaceSetupError,
  type GroupWithPath,
  type PathExists,
  type WorkspaceRegistryLike,
  type WorkspaceRouteDeps,
} from '../src/workspace.ts'

const MAC_PATHS = [
  '/Users/apple/Desktop/Projects/dsh-coagenthub',
  '/Users/apple/Desktop/Projects/deepseek-harness',
]

const BOUND_GROUPS: GroupWithPath[] = [
  { id: 'g1', title: 'dsh-coagenthub 插件开发', projectPath: MAC_PATHS[0] },
  { id: 'g2', title: 'dsh 实测-0814', projectPath: MAC_PATHS[1] },
]

interface MakeDepsOptions {
  platform?: string
  apiBase?: string | null
  netUse?: ReturnType<typeof vi.fn>
  registry?: WorkspaceRegistryLike | null
  pathExists?: PathExists
  groups?: GroupWithPath[]
}

function makeDeps(options: MakeDepsOptions = {}): WorkspaceRouteDeps {
  const store = new CoAgentHubSettingsStore(null)
  const registry = options.registry === undefined
    ? { create: vi.fn().mockResolvedValue({ id: 'w1', path: 'Z:\\x', title: 'x' }), list: vi.fn().mockReturnValue([]) }
    : options.registry
  return {
    getPlatform: () => options.platform ?? 'win32',
    getApiBase: () => options.apiBase === undefined ? 'http://192.168.31.92:3001/api' : options.apiBase,
    runNetUse: options.netUse ?? vi.fn().mockResolvedValue('ok'),
    pathExists: options.pathExists ?? (async () => true),
    getRegistry: () => registry,
    store,
    listGroups: async () => options.groups ?? BOUND_GROUPS,
  }
}

describe('virtual workspace pure functions', () => {
  it('infers the common Mac prefix of several project paths', () => {
    expect(inferMacPrefix(MAC_PATHS)).toBe('/Users/apple/Desktop/Projects/')
  })

  it('infers the parent directory as prefix for a single project path', () => {
    expect(inferMacPrefix([MAC_PATHS[0]!])).toBe('/Users/apple/Desktop/Projects/')
  })

  it('returns null when the paths share no common prefix', () => {
    expect(inferMacPrefix(['/Users/apple/a', '/tmp/bob/b'])).toBeNull()
  })

  it('maps a Mac path through the rule into a Windows path', () => {
    expect(projectToWinPath(MAC_PATHS[0]!, '/Users/apple/Desktop/Projects/', 'Z:\\'))
      .toBe('Z:\\dsh-coagenthub')
  })

  it('returns null when the path lies outside the mapped prefix', () => {
    expect(projectToWinPath('/Users/other/x', '/Users/apple/Desktop/Projects/', 'Z:\\')).toBeNull()
  })

  it('builds the mapping rule with an uppercased drive letter', () => {
    expect(buildMappingRule(MAC_PATHS, 'z')).toEqual({
      macPrefix: '/Users/apple/Desktop/Projects/',
      winPrefix: 'Z:\\',
    })
  })

  it('builds net use args with and without credentials', () => {
    expect(buildNetUseArgs('192.168.31.92', 'Projects', 'z')).toEqual([
      'use', 'Z:', '\\\\192.168.31.92\\Projects', '/persistent:yes',
    ])
    expect(buildNetUseArgs('192.168.31.92', 'Projects', 'Z', { user: 'mac-1', password: 'pw' })).toEqual([
      'use', 'Z:', '\\\\192.168.31.92\\Projects', 'pw', '/user:mac-1', '/persistent:yes',
    ])
  })

  it('extracts the Mac IP from the apiBase', () => {
    expect(extractApiHost('http://192.168.31.92:3001/api')).toBe('192.168.31.92')
    expect(extractApiHost('')).toBeNull()
    expect(extractApiHost('not a url')).toBeNull()
  })
})

describe('runWorkspaceSetup', () => {
  it('maps the drive, persists the rule, and registers each existing winPath', async () => {
    const deps = makeDeps()
    const result = await runWorkspaceSetup({ shareName: 'Projects' }, deps)

    expect(deps.runNetUse).toHaveBeenCalledWith([
      'use', 'Z:', '\\\\192.168.31.92\\Projects', '/persistent:yes',
    ])
    expect(deps.store.get().mappingRule).toEqual({
      macPrefix: '/Users/apple/Desktop/Projects/',
      winPrefix: 'Z:\\',
    })
    const registry = deps.getRegistry()!
    expect(registry.create).toHaveBeenCalledTimes(2)
    expect(registry.create).toHaveBeenCalledWith('Z:\\dsh-coagenthub', 'dsh-coagenthub 插件开发')
    expect(registry.create).toHaveBeenCalledWith('Z:\\deepseek-harness', 'dsh 实测-0814')
    expect(result).toEqual({
      ok: true,
      mappingRule: { macPrefix: '/Users/apple/Desktop/Projects/', winPrefix: 'Z:\\' },
      mapped: [
        { groupTitle: 'dsh-coagenthub 插件开发', winPath: 'Z:\\dsh-coagenthub', registered: true },
        { groupTitle: 'dsh 实测-0814', winPath: 'Z:\\deepseek-harness', registered: true },
      ],
      failures: [],
    })
  })

  it('is idempotent: an existing registration is title-updated, not re-created', async () => {
    const setTitle = vi.fn().mockResolvedValue(undefined)
    const existing = {
      id: 'w1',
      path: 'Z:\\dsh-coagenthub',
      title: '旧标题',
      setTitle,
    }
    const registry: WorkspaceRegistryLike = {
      create: vi.fn(),
      list: vi.fn().mockReturnValue([existing]),
    }
    const deps = makeDeps({ registry })
    const result = await runWorkspaceSetup({ shareName: 'Projects' }, deps)

    expect(registry.create).toHaveBeenCalledTimes(1)
    expect(registry.create).toHaveBeenCalledWith('Z:\\deepseek-harness', 'dsh 实测-0814')
    expect(setTitle).toHaveBeenCalledWith('dsh-coagenthub 插件开发')
    expect(result.mapped).toEqual([
      { groupTitle: 'dsh-coagenthub 插件开发', winPath: 'Z:\\dsh-coagenthub', registered: true },
      { groupTitle: 'dsh 实测-0814', winPath: 'Z:\\deepseek-harness', registered: true },
    ])
    expect(result.failures).toEqual([])
  })

  it('skips groups whose winPath does not exist and lists them as failures', async () => {
    const deps = makeDeps({ pathExists: async () => false })
    const result = await runWorkspaceSetup({ shareName: 'Projects' }, deps)

    expect(deps.getRegistry()!.create).not.toHaveBeenCalled()
    expect(result.mapped).toEqual([])
    expect(result.failures).toEqual([
      { groupTitle: 'dsh-coagenthub 插件开发', winPath: 'Z:\\dsh-coagenthub', reason: '路径不存在或不可访问' },
      { groupTitle: 'dsh 实测-0814', winPath: 'Z:\\deepseek-harness', reason: '路径不存在或不可访问' },
    ])
  })

  it('rejects on non-Windows platforms with 400', async () => {
    const deps = makeDeps({ platform: 'darwin' })
    await expect(runWorkspaceSetup({ shareName: 'Projects' }, deps)).rejects.toMatchObject({
      status: 400,
      message: expect.stringContaining('仅 Windows'),
    })
  })

  it('rejects when the apiBase yields no host', async () => {
    const deps = makeDeps({ apiBase: null })
    await expect(runWorkspaceSetup({ shareName: 'Projects' }, deps)).rejects.toMatchObject({
      status: 400,
      message: expect.stringContaining('apiBase'),
    })
  })

  it('passes through net use failures with 502', async () => {
    const netUse = vi.fn().mockRejectedValue(new Error('Access is denied'))
    const deps = makeDeps({ netUse })
    await expect(runWorkspaceSetup({ shareName: 'Projects' }, deps)).rejects.toMatchObject({
      status: 502,
      message: expect.stringContaining('Access is denied'),
    })
    expect(deps.getRegistry()!.create).not.toHaveBeenCalled()
  })

  it('rejects with 400 when no group carries a project path', async () => {
    const deps = makeDeps({ groups: [{ id: 'g1', title: '无绑定', projectPath: null }] })
    await expect(runWorkspaceSetup({ shareName: 'Projects' }, deps)).rejects.toMatchObject({
      status: 400,
      message: expect.stringContaining('公共前缀'),
    })
  })

  it('fails fatally with 503 when the registry service is unavailable', async () => {
    const deps = makeDeps({ registry: null })
    const error: WorkspaceSetupError | null = await runWorkspaceSetup({ shareName: 'Projects' }, deps)
      .then(() => null)
      .catch((caught: unknown) => caught as WorkspaceSetupError)
    expect(error?.status).toBe(503)
  })
})

describe('buildWorkspaceStatus', () => {
  it('reports the rule plus per-group existence and registration state', async () => {
    const store = new CoAgentHubSettingsStore(null)
    store.set({ mappingRule: { macPrefix: '/Users/apple/Desktop/Projects/', winPrefix: 'Z:\\' } })
    const registry: WorkspaceRegistryLike = {
      create: vi.fn(),
      list: vi.fn().mockReturnValue([{ id: 'w1', path: 'z:\\dsh-coagenthub', title: 'dsh-coagenthub 插件开发' }]),
    }
    const deps: WorkspaceRouteDeps = {
      getPlatform: () => 'win32',
      getApiBase: () => 'http://192.168.31.92:3001/api',
      runNetUse: vi.fn(),
      pathExists: async path => path === 'Z:\\dsh-coagenthub',
      getRegistry: () => registry,
      store,
      listGroups: async () => BOUND_GROUPS,
    }
    const status = await buildWorkspaceStatus(deps)
    expect(status.mappingRule).toEqual({ macPrefix: '/Users/apple/Desktop/Projects/', winPrefix: 'Z:\\' })
    expect(status.workspaces).toEqual([
      {
        groupId: 'g1',
        groupTitle: 'dsh-coagenthub 插件开发',
        macPath: MAC_PATHS[0],
        winPath: 'Z:\\dsh-coagenthub',
        pathExists: true,
        registered: true,
      },
      {
        groupId: 'g2',
        groupTitle: 'dsh 实测-0814',
        macPath: MAC_PATHS[1],
        winPath: 'Z:\\deepseek-harness',
        pathExists: false,
        registered: false,
      },
    ])
  })

  it('degrades to empty workspaces when no rule is configured', async () => {
    const deps = makeDeps()
    const status = await buildWorkspaceStatus(deps)
    expect(status.mappingRule).toBeNull()
    expect(status.workspaces).toEqual([
      expect.objectContaining({ groupId: 'g1', winPath: null, pathExists: false, registered: null }),
      expect.objectContaining({ groupId: 'g2', winPath: null, pathExists: false, registered: null }),
    ])
  })
})

describe('workspace cwd lookup pure functions', () => {
  it('sameWindowsPath ignores case, slash direction and trailing separators', () => {
    expect(sameWindowsPath('C:\\Projects\\dsh-coagenthub', 'c:/projects/dsh-coagenthub')).toBe(true)
    expect(sameWindowsPath('Y:\\dsh-coagenthub\\', 'y:\\dsh-coagenthub')).toBe(true)
    expect(sameWindowsPath('//server/share/a', '\\\\server\\share\\a')).toBe(true)
    expect(sameWindowsPath('C:\\a', 'C:\\b')).toBe(false)
  })

  it('isWindowsLocalPath recognizes drive-letter and UNC absolute paths only', () => {
    expect(isWindowsLocalPath('C:\\projects\\x')).toBe(true)
    expect(isWindowsLocalPath('c:/projects/x')).toBe(true)
    expect(isWindowsLocalPath('\\\\server\\share')).toBe(true)
    expect(isWindowsLocalPath('/Users/apple/x')).toBe(false)
    expect(isWindowsLocalPath('projects\\x')).toBe(false)
    expect(isWindowsLocalPath('')).toBe(false)
  })

  it('groupProjectWinPath maps via the rule, keeps native Windows paths, else null', () => {
    const rule = { macPrefix: '/Users/apple/Desktop/Projects/', winPrefix: 'Y:\\' }
    expect(groupProjectWinPath('/Users/apple/Desktop/Projects/dsh-coagenthub', rule)).toBe('Y:\\dsh-coagenthub')
    expect(groupProjectWinPath('C:\\projects\\dsh-coagenthub', undefined)).toBe('C:\\projects\\dsh-coagenthub')
    expect(groupProjectWinPath('/Users/apple/Desktop/Projects/dsh-coagenthub', undefined)).toBeNull()
    expect(groupProjectWinPath(null, rule)).toBeNull()
  })

  it('findGroupByWorkspaceCwd matches mapped winPath or native Windows path against cwd', () => {
    const rule = { macPrefix: '/Users/apple/Desktop/Projects/', winPrefix: 'Y:\\' }
    const groups: GroupWithPath[] = [
      { id: 'g1', title: 'mapped', projectPath: '/Users/apple/Desktop/Projects/dsh-coagenthub' },
      { id: 'g2', title: 'native', projectPath: 'C:\\projects\\other' },
    ]
    expect(findGroupByWorkspaceCwd(groups, 'Y:\\dsh-coagenthub', rule)?.id).toBe('g1')
    expect(findGroupByWorkspaceCwd(groups, 'c:/Projects/OTHER', undefined)?.id).toBe('g2')
    expect(findGroupByWorkspaceCwd(groups, 'D:\\nowhere', undefined)).toBeNull()
    expect(findGroupByWorkspaceCwd(groups, null, rule)).toBeNull()
  })
})
