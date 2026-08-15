// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { CoAgentHubGroupList, DEFAULT_API_BASE, GROUP_LIST_LIMIT } from '../src/client-ui/CoAgentHubGroupList.tsx'
import { CoAgentHubPanel, PANEL_POSITION_KEY, PANEL_TABS } from '../src/client-ui/CoAgentHubPanel.tsx'
import { ACTIVE_GROUP_STORAGE_KEY, saveActiveGroupId } from '../src/client-ui/workspace-status.ts'
import { groupFetchMock, jsonResponse, groups } from './helpers.ts'

afterEach(() => {
  cleanup()
  localStorage.clear()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('CoAgentHubGroupList', () => {
  it('fetches the group list on mount and renders title + status per row', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(groups([
      { id: 'g1', title: 'dsh-coagenthub 插件开发', status: 'active' },
      { id: 'g2', title: 'dsh 实测-0814', status: 'archived' },
    ])))
    vi.stubGlobal('fetch', fetchMock)

    render(<CoAgentHubGroupList />)

    expect(fetchMock).toHaveBeenCalledWith(`${DEFAULT_API_BASE}/groups?limit=${GROUP_LIST_LIMIT}`)
    expect(screen.getByRole('heading', { name: 'CoAgentHub 群列表' })).toBeTruthy()
    await waitFor(() => {
      expect(screen.getByText('dsh-coagenthub 插件开发')).toBeTruthy()
    })
    expect(screen.getByText('dsh 实测-0814')).toBeTruthy()
    expect(screen.getByText('进行中')).toBeTruthy()
    expect(screen.getByText('已归档')).toBeTruthy()
  })

  it('renders the empty state when the API returns no groups', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(groups([]))))

    render(<CoAgentHubGroupList />)

    await waitFor(() => {
      expect(screen.getByText('暂无群组')).toBeTruthy()
    })
    // 空态没有列表行,但 header 的刷新按钮存在
    expect(screen.queryByRole('button', { name: '刷新' })).toBeTruthy()
    expect(screen.queryAllByRole('button', { name: /复制/ })).toHaveLength(0)
  })

  it('renders an error summary when the fetch fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))

    render(<CoAgentHubGroupList />)

    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toBe('加载失败:Failed to fetch')
    })
    expect(screen.queryByText('暂无群组')).toBeNull()
  })

  it('renders the loading state before the fetch settles', async () => {
    let resolveFetch: (value: Response) => void = () => {}
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((resolve) => { resolveFetch = resolve })))

    render(<CoAgentHubGroupList />)

    expect(screen.getByText('加载中…')).toBeTruthy()
    resolveFetch(jsonResponse(groups([{ id: 'g1', title: 'dsh 实测-0814', status: 'active' }])))
    await waitFor(() => {
      expect(screen.queryByText('加载中…')).toBeNull()
    })
    expect(screen.getByText('dsh 实测-0814')).toBeTruthy()
  })

  it('copies the group id when a row is clicked', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(groups([
      { id: 'g1', title: 'dsh-coagenthub 插件开发', status: 'active' },
    ]))))
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })

    render(<CoAgentHubGroupList />)

    const row = await screen.findByRole('button', { name: /dsh-coagenthub 插件开发/ })
    fireEvent.click(row)

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith('g1')
    })
  })
})

describe('CoAgentHubPanel', () => {
  it('keeps the panel identity and renders the 群列表 tab first', async () => {
    vi.stubGlobal('fetch', groupFetchMock())

    render(<CoAgentHubPanel />)

    expect(screen.getByLabelText('CoAgentHub 面板')).toBeTruthy()
    expect(PANEL_TABS.map((t) => t.label)).toEqual(['群列表', '任务', '执行器', '设置'])
    expect(screen.getByRole('tab', { name: '群列表' }).getAttribute('aria-selected')).toBe('true')
    expect(screen.getByRole('heading', { name: 'CoAgentHub 群列表' })).toBeTruthy()
    await waitFor(() => {
      expect(screen.getByText('dsh-coagenthub 插件开发')).toBeTruthy()
    })
  })

  it('switches to the 任务 tab and back', async () => {
    vi.stubGlobal('fetch', groupFetchMock())

    render(<CoAgentHubPanel />)
    await waitFor(() => {
      expect(screen.getByText('dsh-coagenthub 插件开发')).toBeTruthy()
    })

    fireEvent.click(screen.getByRole('tab', { name: '任务' }))
    expect(screen.getByRole('tab', { name: '任务' }).getAttribute('aria-selected')).toBe('true')
    // 任务面板:群选择下拉 + 未选群时的空态
    expect(screen.getByLabelText('选择群组')).toBeTruthy()
    expect(screen.getByText('请选择群组查看任务')).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'CoAgentHub 群列表' })).toBeNull()

    fireEvent.click(screen.getByRole('tab', { name: '群列表' }))
    expect(screen.getByRole('heading', { name: 'CoAgentHub 群列表' })).toBeTruthy()
  })

  it('switches to the 执行器 tab', async () => {
    vi.stubGlobal('fetch', groupFetchMock())

    render(<CoAgentHubPanel />)
    await waitFor(() => {
      expect(screen.getByText('dsh-coagenthub 插件开发')).toBeTruthy()
    })

    fireEvent.click(screen.getByRole('tab', { name: '执行器' }))
    expect(screen.getByRole('tab', { name: '执行器' }).getAttribute('aria-selected')).toBe('true')
    // 执行器面板:标题 + 新增表单开关
    expect(screen.getByRole('heading', { name: 'CoAgentHub 执行器' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '新增执行器' })).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'CoAgentHub 群列表' })).toBeNull()
  })

  it('switches to the 设置 tab with the settings form', async () => {
    vi.stubGlobal('fetch', groupFetchMock())

    render(<CoAgentHubPanel />)
    await waitFor(() => {
      expect(screen.getByText('dsh-coagenthub 插件开发')).toBeTruthy()
    })

    fireEvent.click(screen.getByRole('tab', { name: '设置' }))
    expect(screen.getByRole('tab', { name: '设置' }).getAttribute('aria-selected')).toBe('true')
    expect(screen.getByRole('heading', { name: 'CoAgentHub 设置' })).toBeTruthy()
    expect(screen.getByLabelText('CoAgentHub 地址')).toBeTruthy()
    expect(screen.getByLabelText('participantId')).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'CoAgentHub 群列表' })).toBeNull()
  })
})

describe('CoAgentHubPanel 拖动移动', () => {
  /**
   * 模拟从 (from) 拖到 (to)。jsdom 无 PointerEvent,fireEvent.pointerMove 会退回
   * 裸 Event、丢掉 clientX/Y;这里直接派发带坐标的 MouseEvent(type 仍用
   * pointerdown/move/up),组件监听的是事件名,坐标即可正常传递。
   */
  function dragTitle(from: { x: number; y: number }, to: { x: number; y: number }) {
    const title = screen.getByRole('heading', { name: 'CoAgentHub' })
    title.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true, clientX: from.x, clientY: from.y }))
    window.dispatchEvent(new MouseEvent('pointermove', { clientX: to.x, clientY: to.y }))
    window.dispatchEvent(new MouseEvent('pointerup', { clientX: to.x, clientY: to.y }))
  }

  it('dragging the title bar saves the position to localStorage', async () => {
    vi.stubGlobal('fetch', groupFetchMock())
    render(<CoAgentHubPanel />)
    await waitFor(() => {
      expect(screen.getByText('dsh-coagenthub 插件开发')).toBeTruthy()
    })

    dragTitle({ x: 0, y: 0 }, { x: 100, y: 50 })

    expect(localStorage.getItem(PANEL_POSITION_KEY)).toBe(JSON.stringify({ left: 100, top: 50 }))
  })

  it('restores the saved position on refresh', async () => {
    localStorage.setItem(PANEL_POSITION_KEY, JSON.stringify({ left: 100, top: 50 }))
    vi.stubGlobal('fetch', groupFetchMock())

    render(<CoAgentHubPanel />)

    const panel = screen.getByLabelText('CoAgentHub 面板') as HTMLElement
    expect(panel.style.left).toBe('100px')
    expect(panel.style.top).toBe('50px')
  })

  it('clamps the position so at least 48px stays inside the viewport', async () => {
    vi.stubGlobal('fetch', groupFetchMock())
    render(<CoAgentHubPanel />)
    await waitFor(() => {
      expect(screen.getByText('dsh-coagenthub 插件开发')).toBeTruthy()
    })

    dragTitle({ x: 0, y: 0 }, { x: 9999, y: 9999 })

    const saved = JSON.parse(localStorage.getItem(PANEL_POSITION_KEY)!) as { left: number; top: number }
    expect(saved.left).toBe(window.innerWidth - 48)
    expect(saved.top).toBe(window.innerHeight - 48)
  })
})

describe('CoAgentHubPanel 当前工作区 dropdown', () => {
  /** URL-routed fetch mock: groups / workspace-status / settings config. */
  function workspacePanelFetchMock(workspaces: unknown[]) {
    return vi.fn().mockImplementation((url: string) => {
      if (url.includes('/groups?')) {
        return Promise.resolve(jsonResponse(groups([
          { id: 'g1', title: 'dsh-coagenthub 插件开发', status: 'active' },
        ])))
      }
      if (url.includes('/workspace-status')) {
        return Promise.resolve(jsonResponse({
          mappingRule: { macPrefix: '/Users/apple/Desktop/Projects/', winPrefix: 'Z:\\' },
          workspaces,
        }))
      }
      return Promise.resolve(jsonResponse({}))
    })
  }

  const PROJECTION = {
    groupId: 'g1',
    groupTitle: 'dsh-coagenthub 插件开发',
    macPath: '/Users/apple/Desktop/Projects/dsh-coagenthub',
    winPath: 'Z:\\dsh-coagenthub',
    pathExists: true,
    registered: true,
  }

  it('renders the virtual workspace projections as options', async () => {
    vi.stubGlobal('fetch', workspacePanelFetchMock([PROJECTION]))

    render(<CoAgentHubPanel />)

    const select = (await screen.findByLabelText('当前工作区')) as HTMLSelectElement
    await waitFor(() => {
      expect(select.querySelectorAll('option')).toHaveLength(2)
    })
    expect(select.textContent).toContain('dsh-coagenthub 插件开发')
    expect(select.textContent).toContain('Z:\\dsh-coagenthub')
  })

  it('persists the selection to localStorage and mirrors it to the host settings', async () => {
    const fetchMock = workspacePanelFetchMock([PROJECTION])
    vi.stubGlobal('fetch', fetchMock)

    render(<CoAgentHubPanel />)

    const select = (await screen.findByLabelText('当前工作区')) as HTMLSelectElement
    await waitFor(() => {
      expect(select.querySelectorAll('option')).toHaveLength(2)
    })
    fireEvent.change(select, { target: { value: 'g1' } })

    await waitFor(() => {
      expect(localStorage.getItem(ACTIVE_GROUP_STORAGE_KEY)).toBe('g1')
    })
    expect(fetchMock).toHaveBeenCalledWith('/coagenthub-api-config', expect.objectContaining({
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ activeGroupId: 'g1' }),
    }))
  })

  it('defaults the 任务 tab group selection to the active workspace', async () => {
    localStorage.setItem(ACTIVE_GROUP_STORAGE_KEY, 'g1')
    vi.stubGlobal('fetch', workspacePanelFetchMock([PROJECTION]))

    render(<CoAgentHubPanel />)

    fireEvent.click(screen.getByRole('tab', { name: '任务' }))
    await waitFor(() => {
      expect((screen.getByLabelText('选择群组') as HTMLSelectElement).value).toBe('g1')
    })
  })
})

describe('workspace selection helpers', () => {
  it('clears the host mirror with an empty string when deselected', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: true, settings: {} }))
    vi.stubGlobal('fetch', fetchMock)

    await saveActiveGroupId(null)

    expect(fetchMock).toHaveBeenCalledWith('/coagenthub-api-config', expect.objectContaining({
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ activeGroupId: '' }),
    }))
  })
})
