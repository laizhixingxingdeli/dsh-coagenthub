// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { CoAgentHubGroupList, DEFAULT_API_BASE, GROUP_LIST_LIMIT } from '../src/client-ui/CoAgentHubGroupList.tsx'
import { CoAgentHubPanel, PANEL_POSITION_KEY, PANEL_TABS } from '../src/client-ui/CoAgentHubPanel.tsx'
import {
  ACTIVE_GROUP_STORAGE_KEY,
  ACTIVE_GROUP_SESSION_KEY_PREFIX,
  activeGroupSessionKey,
  getCurrentDshSessionId,
  readActiveGroupId,
  readSessionActiveGroupId,
  saveActiveGroupId,
  writeActiveGroupId,
} from '../src/client-ui/workspace-status.ts'
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

  it('默认选中「自动（按 cwd）」:无保存记录时清空 host activeGroupId(不写本地存储)', async () => {
    const fetchMock = workspacePanelFetchMock([PROJECTION])
    vi.stubGlobal('fetch', fetchMock)

    render(<CoAgentHubPanel />)

    const select = (await screen.findByLabelText('当前工作区')) as HTMLSelectElement
    await waitFor(() => {
      expect(select.querySelectorAll('option')).toHaveLength(2)
    })
    // 无 per-session 保存记录 → 默认「自动（按 cwd）」
    expect(select.value).toBe('')
    expect(select.textContent).toContain('自动（按 cwd）')
    // 本地存储不写入任何 per-session/全局 key
    expect(localStorage.getItem(ACTIVE_GROUP_STORAGE_KEY)).toBeNull()
    // 但 host 镜像被清空(null → 空串),避免沿用上一会话的残留
    expect(fetchMock).toHaveBeenCalledWith('/coagenthub-api-config', expect.objectContaining({
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ activeGroupId: '' }),
    }))
  })

  it('手动选择群只更新草稿:点「保存」才写 per-session 并镜像 host', async () => {
    const fetchMock = workspacePanelFetchMock([PROJECTION])
    vi.stubGlobal('fetch', fetchMock)

    render(<CoAgentHubPanel />)

    const select = (await screen.findByLabelText('当前工作区')) as HTMLSelectElement
    await waitFor(() => {
      expect(select.querySelectorAll('option')).toHaveLength(2)
    })
    fireEvent.change(select, { target: { value: 'g1' } })

    // 未保存:下拉变了,但没有写入任何存储,也没有镜像 g1(mount 时仅清空过 host)
    expect(select.value).toBe('g1')
    expect(localStorage.getItem(ACTIVE_GROUP_STORAGE_KEY)).toBeNull()
    expect(fetchMock).not.toHaveBeenCalledWith('/coagenthub-api-config', expect.objectContaining({
      method: 'PUT',
      body: JSON.stringify({ activeGroupId: 'g1' }),
    }))

    // 出现「保存工作区」按钮,点了才写 localStorage 并镜像 host
    fireEvent.click(screen.getByRole('button', { name: '保存工作区' }))

    await waitFor(() => {
      expect(localStorage.getItem(ACTIVE_GROUP_STORAGE_KEY)).toBe('g1')
    })
    expect(fetchMock).toHaveBeenCalledWith('/coagenthub-api-config', expect.objectContaining({
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ activeGroupId: 'g1' }),
    }))
  })

  it('新会话无 per-session 保存值时,挂载即清空 host activeGroupId', async () => {
    const fetchMock = workspacePanelFetchMock([PROJECTION])
    vi.stubGlobal('fetch', fetchMock)
    // 模拟残留:全局 key 还留着上一个会话手动选的值,但新会话没有 per-session 记忆
    localStorage.setItem(ACTIVE_GROUP_STORAGE_KEY, 'g-stale')
    localStorage.setItem('dsh.sessions.current', JSON.stringify({ sessionId: 'session-new' }))

    render(<CoAgentHubPanel />)

    // host 被清空(null → 空串),agent 侧工具回落按会话 cwd 自动解析
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/coagenthub-api-config', expect.objectContaining({
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ activeGroupId: '' }),
      }))
    })
    // 只清空 host,不写任何 per-session 记忆
    expect(localStorage.getItem(activeGroupSessionKey('session-new'))).toBeNull()
  })

  it('新会话有 per-session 保存值时,挂载镜像该值到 host activeGroupId', async () => {
    const fetchMock = workspacePanelFetchMock([PROJECTION])
    vi.stubGlobal('fetch', fetchMock)
    localStorage.setItem('dsh.sessions.current', JSON.stringify({ sessionId: 'session-a' }))
    localStorage.setItem(activeGroupSessionKey('session-a'), 'g1')

    render(<CoAgentHubPanel />)

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/coagenthub-api-config', expect.objectContaining({
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ activeGroupId: 'g1' }),
      }))
    })
  })

  it('切换会话时,host activeGroupId 按目标会话的 per-session 值同步', async () => {
    const fetchMock = workspacePanelFetchMock([PROJECTION])
    vi.stubGlobal('fetch', fetchMock)
    localStorage.setItem('dsh.sessions.current', JSON.stringify({ sessionId: 'session-a' }))
    localStorage.setItem(activeGroupSessionKey('session-a'), 'g1')

    render(<CoAgentHubPanel />)

    // 初始:session-a 的记忆 g1 镜像到 host
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/coagenthub-api-config', expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({ activeGroupId: 'g1' }),
      }))
    })

    // 切到 session-b:该会话无记忆 → host 被清空,回落 cwd 自动解析
    localStorage.setItem('dsh.sessions.current', JSON.stringify({ sessionId: 'session-b' }))
    window.dispatchEvent(new Event('focus'))
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/coagenthub-api-config', expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({ activeGroupId: '' }),
      }))
    })

    // session-b 有了自己的记忆后,focus 刷新应镜像该值(不同值,证明是新的同步)
    localStorage.setItem(activeGroupSessionKey('session-b'), 'g2')
    window.dispatchEvent(new Event('focus'))
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/coagenthub-api-config', expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({ activeGroupId: 'g2' }),
      }))
    })
  })

  it('有保存记录时,任务面板默认选中该群', async () => {
    localStorage.setItem('dsh.sessions.current', JSON.stringify({ sessionId: 'session-a' }))
    localStorage.setItem(activeGroupSessionKey('session-a'), 'g1')
    vi.stubGlobal('fetch', workspacePanelFetchMock([PROJECTION]))

    render(<CoAgentHubPanel />)

    fireEvent.click(screen.getByRole('tab', { name: '任务' }))
    await waitFor(() => {
      expect((screen.getByLabelText('选择群组') as HTMLSelectElement).value).toBe('g1')
    })
  })

  it('无保存记录时,任务面板不强制选群(保持空值)', async () => {
    vi.stubGlobal('fetch', workspacePanelFetchMock([PROJECTION]))

    render(<CoAgentHubPanel />)

    fireEvent.click(screen.getByRole('tab', { name: '任务' }))
    await waitFor(() => {
      expect((screen.getByLabelText('选择群组') as HTMLSelectElement).value).toBe('')
    })
  })

  it('sessionId 变化时面板重新读取新会话记忆的工作区', async () => {
    localStorage.setItem('dsh.sessions.current', JSON.stringify({ sessionId: 'session-a' }))
    localStorage.setItem(activeGroupSessionKey('session-a'), 'g1')
    vi.stubGlobal('fetch', workspacePanelFetchMock([PROJECTION]))

    render(<CoAgentHubPanel />)

    const select = (await screen.findByLabelText('当前工作区')) as HTMLSelectElement
    await waitFor(() => {
      expect(select.querySelectorAll('option')).toHaveLength(2)
    })
    expect(select.value).toBe('g1')

    // 切换到 session-b:该会话没有记忆 → 自动(按 cwd)
    localStorage.setItem('dsh.sessions.current', JSON.stringify({ sessionId: 'session-b' }))
    window.dispatchEvent(new Event('focus'))

    await waitFor(() => {
      expect(select.value).toBe('')
    })

    // session-b 有了自己的记忆后,focus 刷新应恢复它
    localStorage.setItem(activeGroupSessionKey('session-b'), 'g1')
    window.dispatchEvent(new Event('focus'))
    await waitFor(() => {
      expect(select.value).toBe('g1')
    })
  })

  it('未保存的手动选择在切换会话后丢弃,回到「自动（按 cwd）」', async () => {
    localStorage.setItem('dsh.sessions.current', JSON.stringify({ sessionId: 'session-a' }))
    vi.stubGlobal('fetch', workspacePanelFetchMock([PROJECTION]))

    render(<CoAgentHubPanel />)

    const select = (await screen.findByLabelText('当前工作区')) as HTMLSelectElement
    await waitFor(() => {
      expect(select.querySelectorAll('option')).toHaveLength(2)
    })
    // 手动选 g1,但不点保存
    fireEvent.change(select, { target: { value: 'g1' } })
    expect(select.value).toBe('g1')
    expect(localStorage.getItem(activeGroupSessionKey('session-a'))).toBeNull()

    // 切换到 session-b(无记忆):草稿丢弃,回到自动(按 cwd),且未写入任何记忆
    localStorage.setItem('dsh.sessions.current', JSON.stringify({ sessionId: 'session-b' }))
    window.dispatchEvent(new Event('focus'))

    await waitFor(() => {
      expect(select.value).toBe('')
    })
    expect(localStorage.getItem(activeGroupSessionKey('session-a'))).toBeNull()
    expect(localStorage.getItem(activeGroupSessionKey('session-b'))).toBeNull()
  })

  it('切换会话后设置页「当前工作区」同步显示新会话记忆的群名', async () => {
    const PROJECTION_B = {
      groupId: 'g2',
      groupTitle: 'dsh 实测-0814',
      macPath: '/Users/apple/Desktop/Projects/qiuzhi',
      winPath: 'Z:\\qiuzhi',
      pathExists: true,
      registered: true,
    }
    localStorage.setItem('dsh.sessions.current', JSON.stringify({ sessionId: 'session-a' }))
    localStorage.setItem(activeGroupSessionKey('session-a'), 'g1')
    vi.stubGlobal('fetch', workspacePanelFetchMock([PROJECTION, PROJECTION_B]))

    render(<CoAgentHubPanel />)

    // 进入设置页:显示 session-a 记忆的 g1 群名
    fireEvent.click(screen.getByRole('tab', { name: '设置' }))
    const statusValue = await screen.findByLabelText('当前工作区群名')
    await waitFor(() => {
      expect(statusValue.textContent).toContain('dsh-coagenthub 插件开发')
    })

    // 切换到 session-b(记忆 g2):focus 刷新后设置页应显示新群名
    localStorage.setItem('dsh.sessions.current', JSON.stringify({ sessionId: 'session-b' }))
    localStorage.setItem(activeGroupSessionKey('session-b'), 'g2')
    window.dispatchEvent(new Event('focus'))

    await waitFor(() => {
      expect(statusValue.textContent).toContain('dsh 实测-0814')
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

describe('dsh 会话隔离工作区记忆', () => {
  const SESSION_STORAGE_KEY = 'dsh.sessions.current'

  it('getCurrentDshSessionId 解析 localStorage 中的 sessionId', () => {
    expect(getCurrentDshSessionId()).toBeNull()
    localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify({ sessionId: 'session-abc' }))
    expect(getCurrentDshSessionId()).toBe('session-abc')
    // 空 sessionId / 非法 JSON 都回退 null
    localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify({ sessionId: '' }))
    expect(getCurrentDshSessionId()).toBeNull()
    localStorage.setItem(SESSION_STORAGE_KEY, 'not-json')
    expect(getCurrentDshSessionId()).toBeNull()
  })

  it('readSessionActiveGroupId 只读当前会话 per-session 记忆,不回退全局 key', () => {
    localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify({ sessionId: 'session-abc' }))
    localStorage.setItem(ACTIVE_GROUP_STORAGE_KEY, 'g-global')

    // 该会话没有记忆 → 面板默认「自动（按 cwd）」,不回退全局
    expect(readSessionActiveGroupId()).toBeNull()

    // 该会话有记忆 → 返回 per-session 值
    localStorage.setItem(activeGroupSessionKey('session-abc'), 'g-per')
    expect(readSessionActiveGroupId()).toBe('g-per')
  })

  it('无 sessionId 时 readSessionActiveGroupId 返回 null', () => {
    expect(getCurrentDshSessionId()).toBeNull()
    localStorage.setItem(ACTIVE_GROUP_STORAGE_KEY, 'g-global')
    expect(readSessionActiveGroupId()).toBeNull()
  })

  it('有 sessionId 时读写 coagenthub.activeGroup.<sessionId>,同时保留全局 key', () => {
    localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify({ sessionId: 'session-abc' }))

    writeActiveGroupId('g1')

    expect(localStorage.getItem(activeGroupSessionKey('session-abc'))).toBe('g1')
    expect(localStorage.getItem(ACTIVE_GROUP_STORAGE_KEY)).toBe('g1')
    // 清除时两个 key 一起清
    writeActiveGroupId(null)
    expect(localStorage.getItem(activeGroupSessionKey('session-abc'))).toBeNull()
    expect(localStorage.getItem(ACTIVE_GROUP_STORAGE_KEY)).toBeNull()
  })

  it('有 sessionId 时读取优先 per-session key,无记录时回退全局 key', () => {
    localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify({ sessionId: 'session-abc' }))
    localStorage.setItem(ACTIVE_GROUP_STORAGE_KEY, 'g-global')

    // 该会话没有记忆 → 回退全局
    expect(readActiveGroupId()).toBe('g-global')

    // 该会话有记忆 → 优先 per-session
    localStorage.setItem(activeGroupSessionKey('session-abc'), 'g-per')
    expect(readActiveGroupId()).toBe('g-per')
  })

  it('无 sessionId 时读写只走全局 key', () => {
    expect(getCurrentDshSessionId()).toBeNull()

    writeActiveGroupId('g1')
    expect(localStorage.getItem(ACTIVE_GROUP_STORAGE_KEY)).toBe('g1')
    // 不产生任何 per-session key
    expect(Object.keys(localStorage).filter((key) => key.startsWith(ACTIVE_GROUP_SESSION_KEY_PREFIX))).toHaveLength(0)

    expect(readActiveGroupId()).toBe('g1')
  })
})
