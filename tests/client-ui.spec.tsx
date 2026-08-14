// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { CoAgentHubGroupList, DEFAULT_API_BASE, GROUP_LIST_LIMIT } from '../src/client-ui/CoAgentHubGroupList.tsx'
import { CoAgentHubPanel, PANEL_TABS } from '../src/client-ui/CoAgentHubPanel.tsx'
import { groupFetchMock, jsonResponse, groups } from './helpers.ts'

afterEach(() => {
  cleanup()
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
