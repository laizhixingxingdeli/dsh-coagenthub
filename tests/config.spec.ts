import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CoAgentHubSettingsStore, CONFIG_FILE_NAME, defaultConfigFilePath } from '../src/config.ts'

afterEach(() => {
  vi.restoreAllMocks()
})

/**
 * Point the fallback path at a temp dir by overriding `$HOME`
 * (POSIX `os.homedir()` reads `$HOME` first), so tests never touch
 * the real user directory. Returns the previous value for restore.
 */
function stubHomedir(): { dir: string; previous: string | undefined } {
  const dir = mkdtempSync(join(tmpdir(), 'coagenthub-home-'))
  const previous = process.env.HOME
  process.env.HOME = dir
  return { dir, previous }
}

function restoreHome(previous: string | undefined) {
  if (previous === undefined) delete process.env.HOME
  else process.env.HOME = previous
}

describe('defaultConfigFilePath', () => {
  const previousDshHome = process.env.DSH_HOME

  afterEach(() => {
    if (previousDshHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previousDshHome
  })

  it('resolves under $DSH_HOME when the env var is set', () => {
    process.env.DSH_HOME = '/tmp/dsh-home'
    expect(defaultConfigFilePath()).toBe(join('/tmp/dsh-home', CONFIG_FILE_NAME))
  })

  it('falls back to ~/.dsh when DSH_HOME is unset', () => {
    delete process.env.DSH_HOME
    const { dir, previous } = stubHomedir()
    try {
      expect(defaultConfigFilePath()).toBe(join(dir, '.dsh', CONFIG_FILE_NAME))
    } finally {
      restoreHome(previous)
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('falls back to ~/.dsh when DSH_HOME is empty or blank', () => {
    process.env.DSH_HOME = ''
    const { dir, previous } = stubHomedir()
    try {
      expect(defaultConfigFilePath()).toBe(join(dir, '.dsh', CONFIG_FILE_NAME))
    } finally {
      restoreHome(previous)
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('CoAgentHubSettingsStore.set patch merge semantics', () => {
  it('set({ apiBase }) keeps participantId / mappingRule / activeGroupId untouched', () => {
    const store = new CoAgentHubSettingsStore(null)
    store.set({
      apiBase: 'http://a:1/api',
      participantId: 'win-1',
      mappingRule: { macPrefix: '/m/', winPrefix: 'Z:\\' },
      activeGroupId: 'g1',
    })
    store.set({ apiBase: 'http://b:2/api' })
    expect(store.get()).toEqual({
      apiBase: 'http://b:2/api',
      participantId: 'win-1',
      mappingRule: { macPrefix: '/m/', winPrefix: 'Z:\\' },
      activeGroupId: 'g1',
    })
  })

  it('set({ activeGroupId }) keeps apiBase / participantId / mappingRule untouched', () => {
    const store = new CoAgentHubSettingsStore(null)
    store.set({
      apiBase: 'http://a:1/api',
      participantId: 'win-1',
      mappingRule: { macPrefix: '/m/', winPrefix: 'Z:\\' },
      activeGroupId: 'g1',
    })
    store.set({ activeGroupId: 'g2' })
    expect(store.get()).toEqual({
      apiBase: 'http://a:1/api',
      participantId: 'win-1',
      mappingRule: { macPrefix: '/m/', winPrefix: 'Z:\\' },
      activeGroupId: 'g2',
    })
  })

  it('set({ participantId: \'\' }) clears only participantId', () => {
    const store = new CoAgentHubSettingsStore(null)
    store.set({ apiBase: 'http://a:1/api', participantId: 'win-1', activeGroupId: 'g1' })
    store.set({ participantId: '' })
    expect(store.get()).toEqual({ apiBase: 'http://a:1/api', activeGroupId: 'g1' })
  })

  it('set({ apiBase: undefined }) treats the field as not provided and keeps the old value', () => {
    const store = new CoAgentHubSettingsStore(null)
    store.set({ apiBase: 'http://a:1/api' })
    store.set({ apiBase: undefined, participantId: 'p-1' })
    expect(store.get()).toEqual({ apiBase: 'http://a:1/api', participantId: 'p-1' })
  })

  it('set({ mappingRule: null }) clears the mapping rule', () => {
    const store = new CoAgentHubSettingsStore(null)
    store.set({ mappingRule: { macPrefix: '/m/', winPrefix: 'Z:\\' }, activeGroupId: 'g1' })
    store.set({ mappingRule: null } as never)
    expect(store.get()).toEqual({ activeGroupId: 'g1' })
  })
})

describe('CoAgentHubSettingsStore (fallback path)', () => {
  it('persists settings under ~/.dsh and reloads them after restart when DSH_HOME is unset', () => {
    const previousDshHome = process.env.DSH_HOME
    delete process.env.DSH_HOME
    const { dir, previous } = stubHomedir()
    try {
      const first = new CoAgentHubSettingsStore() // default path → ~/.dsh/coagenthub-config.json
      first.set({ apiBase: 'http://192.168.31.92:3001/api', participantId: 'win-1', activeGroupId: 'g1' })

      const reloaded = new CoAgentHubSettingsStore() // simulates a dsh web restart
      expect(reloaded.get()).toEqual({
        apiBase: 'http://192.168.31.92:3001/api',
        participantId: 'win-1',
        activeGroupId: 'g1',
      })
    } finally {
      restoreHome(previous)
      rmSync(dir, { recursive: true, force: true })
      if (previousDshHome === undefined) delete process.env.DSH_HOME
      else process.env.DSH_HOME = previousDshHome
    }
  })
})
