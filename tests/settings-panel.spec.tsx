// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { CoAgentHubSettings, SETTINGS_PATH, fetchSettings, saveSettings } from '../src/client-ui/CoAgentHubSettings.tsx'
import { WORKSPACE_SETUP_PATH } from '../src/client-ui/workspace-status.ts'
import { jsonResponse } from './helpers.ts'

/** jsdom 默认非 Windows;测试里改过 navigator.platform 后要还原。 */
const NON_WINDOWS_PLATFORM = 'Linux x86_64'

afterEach(() => {
  cleanup()
  Object.defineProperty(navigator, 'platform', { value: NON_WINDOWS_PLATFORM, configurable: true })
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('CoAgentHubSettings', () => {
  it('loads the current settings into the form on mount', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ apiBase: 'http://192.168.31.92:3001/api', participantId: 'p-1' }))
    vi.stubGlobal('fetch', fetchMock)

    render(<CoAgentHubSettings />)

    expect(fetchMock).toHaveBeenCalledWith(SETTINGS_PATH)
    await waitFor(() => {
      expect((screen.getByLabelText('CoAgentHub 地址') as HTMLInputElement).value).toBe('http://192.168.31.92:3001/api')
    })
    expect((screen.getByLabelText('participantId') as HTMLInputElement).value).toBe('p-1')
  })

  it('saves the form via PUT and shows 已保存,立即生效 + calls onSaved', async () => {
    // 每次调用返回新的 Response(GET 预填 + PUT 保存共用同一 mock)
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(jsonResponse({ ok: true, settings: {} })))
    vi.stubGlobal('fetch', fetchMock)
    const onSaved = vi.fn()

    render(<CoAgentHubSettings onSaved={onSaved} />)

    fireEvent.change(screen.getByLabelText('CoAgentHub 地址'), { target: { value: 'http://192.168.31.92:3001/api' } })
    fireEvent.change(screen.getByLabelText('participantId'), { target: { value: 'win-1' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(SETTINGS_PATH, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiBase: 'http://192.168.31.92:3001/api', participantId: 'win-1' }),
      })
    })
    expect(await screen.findByText('已保存,立即生效')).toBeTruthy()
    expect(onSaved).toHaveBeenCalledTimes(1)
  })

  it('sends empty strings to clear the settings', async () => {
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(jsonResponse({ ok: true, settings: {} })))
    vi.stubGlobal('fetch', fetchMock)

    render(<CoAgentHubSettings />)

    fireEvent.click(screen.getByRole('button', { name: '保存' }))

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(SETTINGS_PATH, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiBase: '', participantId: '' }),
      })
    })
  })

  it('shows an error when the save fails', async () => {
    // GET 预填成功,PUT 返回 500 → 只出现一个「保存失败」alert
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({}))
      .mockResolvedValue(jsonResponse({ error: 'boom' }, 500))
    vi.stubGlobal('fetch', fetchMock)

    render(<CoAgentHubSettings />)
    await screen.findByLabelText('CoAgentHub 地址')

    fireEvent.change(screen.getByLabelText('CoAgentHub 地址'), { target: { value: 'http://x:1/api' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))

    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain('保存失败:HTTP 500')
    })
  })
})

describe('CoAgentHubSettings helpers', () => {
  it('fetchSettings parses the GET payload', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ apiBase: 'http://a:1/api', participantId: 'p' })))
    expect(await fetchSettings()).toEqual({ apiBase: 'http://a:1/api', participantId: 'p' })
  })

  it('saveSettings PUTs the patch and returns the saved settings', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: true, settings: { apiBase: 'http://a:1/api' } }))
    vi.stubGlobal('fetch', fetchMock)
    const saved = await saveSettings({ apiBase: 'http://a:1/api' })
    expect(saved).toEqual({ apiBase: 'http://a:1/api' })
    expect(fetchMock).toHaveBeenCalledWith(SETTINGS_PATH, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apiBase: 'http://a:1/api' }),
    })
  })
})

describe('CoAgentHubSettings 当前身份与工作区 status area', () => {
  function statusAreaFetchMock(settings: Record<string, unknown>) {
    return vi.fn().mockImplementation((url: string) => {
      if (url.includes('/workspace-status')) {
        return Promise.resolve(jsonResponse({ mappingRule: null, workspaces: [] }))
      }
      return Promise.resolve(jsonResponse(settings))
    })
  }

  it('shows the participantId and a copy button when set', async () => {
    vi.stubGlobal('fetch', statusAreaFetchMock({ participantId: 'p-1' }))

    render(<CoAgentHubSettings />)

    expect((await screen.findByLabelText('当前 participantId')).textContent).toContain('p-1')
    expect(screen.getByRole('button', { name: '复制 participantId' })).toBeTruthy()
  })

  it('shows 未设置 when participantId is absent', async () => {
    vi.stubGlobal('fetch', statusAreaFetchMock({}))

    render(<CoAgentHubSettings />)

    expect((await screen.findByLabelText('当前 participantId')).textContent).toContain('未设置')
    expect(screen.queryByRole('button', { name: '复制 participantId' })).toBeNull()
  })

  it('shows the active group title when activeGroupId is set', async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/workspace-status')) {
        return Promise.resolve(jsonResponse({
          mappingRule: null,
          workspaces: [{ groupId: 'g1', groupTitle: 'dsh-coagenthub 插件开发' }],
        }))
      }
      return Promise.resolve(jsonResponse({ participantId: 'p-1', activeGroupId: 'g1' }))
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<CoAgentHubSettings />)

    expect((await screen.findByLabelText('当前工作区群名')).textContent).toContain('dsh-coagenthub 插件开发')
  })

  it('shows the group title from the activeGroupId prop when passed in', async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/workspace-status')) {
        return Promise.resolve(jsonResponse({
          mappingRule: null,
          workspaces: [{ groupId: 'g1', groupTitle: 'dsh-coagenthub 插件开发' }],
        }))
      }
      // fetchSettings 不返回 activeGroupId:显示完全由 prop 驱动。
      return Promise.resolve(jsonResponse({ participantId: 'p-1' }))
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<CoAgentHubSettings activeGroupId="g1" />)

    expect((await screen.findByLabelText('当前工作区群名')).textContent).toContain('dsh-coagenthub 插件开发')
  })

  it('prefers the activeGroupId prop over the fetchSettings global value', async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/workspace-status')) {
        return Promise.resolve(jsonResponse({
          mappingRule: null,
          workspaces: [{ groupId: 'g1', groupTitle: 'dsh-coagenthub 插件开发' }],
        }))
      }
      // 全局配置里的 activeGroupId 已过期,会话记忆(prop)才是当前值。
      return Promise.resolve(jsonResponse({ participantId: 'p-1', activeGroupId: 'g-stale' }))
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<CoAgentHubSettings activeGroupId="g1" />)

    expect((await screen.findByLabelText('当前工作区群名')).textContent).toContain('dsh-coagenthub 插件开发')
  })

  it('shows the raw group id when the prop value is not in the workspace list', async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/workspace-status')) {
        return Promise.resolve(jsonResponse({ mappingRule: null, workspaces: [] }))
      }
      return Promise.resolve(jsonResponse({}))
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<CoAgentHubSettings activeGroupId="g-unknown" />)

    expect((await screen.findByLabelText('当前工作区群名')).textContent).toContain('g-unknown')
  })

  it('shows 自动（按 cwd） when no active group is saved', async () => {
    vi.stubGlobal('fetch', statusAreaFetchMock({}))

    render(<CoAgentHubSettings />)

    expect((await screen.findByLabelText('当前工作区群名')).textContent).toContain('自动（按 cwd）')
  })

  it('面板传入空 activeGroupId(无保存记录)时显示「自动（按 cwd）」', async () => {
    vi.stubGlobal('fetch', statusAreaFetchMock({}))

    render(<CoAgentHubSettings activeGroupId="" />)

    expect((await screen.findByLabelText('当前工作区群名')).textContent).toContain('自动（按 cwd）')
  })
})

describe('CoAgentHubSettings 虚拟工作区 section', () => {
  it('shows the mapping rule and the registered count', async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/workspace-status')) {
        return Promise.resolve(jsonResponse({
          mappingRule: { macPrefix: '/Users/apple/Desktop/Projects/', winPrefix: 'Z:\\' },
          workspaces: [
            {
              groupId: 'g1',
              groupTitle: 'dsh-coagenthub 插件开发',
              macPath: '/Users/apple/Desktop/Projects/dsh-coagenthub',
              winPath: 'Z:\\dsh-coagenthub',
              pathExists: true,
              registered: true,
            },
          ],
        }))
      }
      return Promise.resolve(jsonResponse({}))
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<CoAgentHubSettings />)

    expect(await screen.findByText('/Users/apple/Desktop/Projects/ → Z:\\')).toBeTruthy()
    expect(screen.getByText('已注册 1/1 个虚拟工作区')).toBeTruthy()
  })

  it('disables the one-click button and notes Windows-only on non-Windows', async () => {
    Object.defineProperty(navigator, 'platform', { value: 'MacIntel', configurable: true })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({})))

    render(<CoAgentHubSettings />)

    expect(await screen.findByText('自动映射仅 Windows 支持')).toBeTruthy()
    expect((screen.getByRole('button', { name: '一键设置' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('submits the one-click setup form and shows the result', async () => {
    Object.defineProperty(navigator, 'platform', { value: 'Win32', configurable: true })
    const setupResult = {
      ok: true,
      mappingRule: { macPrefix: '/Users/apple/Desktop/Projects/', winPrefix: 'Z:\\' },
      mapped: [{ groupTitle: 'dsh-coagenthub 插件开发', winPath: 'Z:\\dsh-coagenthub', registered: true }],
      failures: [{ groupTitle: '无目录', winPath: 'Z:\\ghost', reason: '路径不存在或不可访问' }],
    }
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/workspace-setup')) return Promise.resolve(jsonResponse(setupResult))
      if (url.includes('/workspace-status')) {
        return Promise.resolve(jsonResponse({ mappingRule: null, workspaces: [] }))
      }
      return Promise.resolve(jsonResponse({}))
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<CoAgentHubSettings />)
    await screen.findByLabelText('共享名')

    fireEvent.change(screen.getByLabelText('共享名'), { target: { value: 'Projects' } })
    fireEvent.change(screen.getByLabelText('盘符'), { target: { value: 'Y' } })
    fireEvent.click(screen.getByRole('button', { name: '一键设置' }))

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(WORKSPACE_SETUP_PATH, expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shareName: 'Projects', driveLetter: 'Y' }),
      }))
    })
    expect(await screen.findByText('设置完成:注册 1 个,失败 1 个')).toBeTruthy()
    expect(screen.getByText('无目录:路径不存在或不可访问')).toBeTruthy()
  })

  it('shows the setup error from the host as an alert', async () => {
    Object.defineProperty(navigator, 'platform', { value: 'Win32', configurable: true })
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/workspace-setup')) {
        return Promise.resolve(jsonResponse({ error: '未配置有效的 CoAgentHub 地址(apiBase)' }, 400))
      }
      if (url.includes('/workspace-status')) {
        return Promise.resolve(jsonResponse({ mappingRule: null, workspaces: [] }))
      }
      return Promise.resolve(jsonResponse({}))
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<CoAgentHubSettings />)
    await screen.findByLabelText('共享名')
    fireEvent.click(screen.getByRole('button', { name: '一键设置' }))

    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain('设置失败:未配置有效的 CoAgentHub 地址(apiBase)')
    })
  })
})
