// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import {
  CoAgentHubExecutorsPanel,
  fetchExecutors,
  argsPreview,
  type CoAgentHubExecutorView,
} from '../src/client-ui/CoAgentHubExecutorsPanel.tsx'
import { DEFAULT_API_BASE } from '../src/client-ui/CoAgentHubGroupList.tsx'
import { jsonResponse } from './helpers.ts'

function executor(overrides: Partial<CoAgentHubExecutorView> = {}): CoAgentHubExecutorView {
  return {
    key: 'executor',
    agentName: 'AtomCode 执行器',
    bin: 'atomcode',
    args: ['-y', '-p', '{ticket}'],
    builtin: true,
    ...overrides,
  }
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('CoAgentHubExecutorsPanel', () => {
  it('fetches the executor list on mount and renders key / bin / builtin badge / model', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse([
      executor({ key: 'executor', agentName: 'AtomCode 执行器', bin: 'atomcode' }),
      executor({ key: 'dsh', agentName: 'DSh 执行器', bin: 'node', args: ['--profile', 'headless'], builtin: false, model: 'deepseek-chat' }),
    ]))
    vi.stubGlobal('fetch', fetchMock)

    render(<CoAgentHubExecutorsPanel />)

    expect(fetchMock).toHaveBeenCalledWith(`${DEFAULT_API_BASE}/executors`)
    expect(screen.getByRole('heading', { name: 'CoAgentHub 执行器' })).toBeTruthy()
    await waitFor(() => {
      expect(screen.getByText('executor')).toBeTruthy()
    })
    // 内置行显示「内置」徽章,非内置行不显示
    const builtinBadges = screen.getAllByText('内置')
    expect(builtinBadges).toHaveLength(1)
    expect(screen.getByText('AtomCode 执行器')).toBeTruthy()
    expect(screen.getByText('atomcode')).toBeTruthy()
    expect(screen.getByText('node')).toBeTruthy()
    // model 有则显示,无则不显示
    expect(screen.getByText('deepseek-chat')).toBeTruthy()
    // 只有非内置行有删除按钮
    expect(screen.getAllByRole('button', { name: '删除' })).toHaveLength(1)
  })

  it('renders the empty state when the API returns no executors', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse([])))

    render(<CoAgentHubExecutorsPanel />)

    await waitFor(() => {
      expect(screen.getByText('暂无执行器')).toBeTruthy()
    })
    expect(screen.getByRole('button', { name: '刷新' })).toBeTruthy()
    expect(screen.queryAllByRole('button', { name: '复制 key' })).toHaveLength(0)
  })

  it('renders an error summary when the fetch fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))

    render(<CoAgentHubExecutorsPanel />)

    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toBe('加载失败:Failed to fetch')
    })
    expect(screen.queryByText('暂无执行器')).toBeNull()
  })

  it('renders the loading state before the fetch settles', async () => {
    let resolveFetch: (value: Response) => void = () => {}
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((resolve) => { resolveFetch = resolve })))

    render(<CoAgentHubExecutorsPanel />)

    expect(screen.getByText('加载中…')).toBeTruthy()
    resolveFetch(jsonResponse([executor()]))
    await waitFor(() => {
      expect(screen.queryByText('加载中…')).toBeNull()
    })
    expect(screen.getByText('executor')).toBeTruthy()
  })

  it('deletes a non-builtin executor after confirm, then reloads', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse([executor({ key: 'dsh', builtin: false })]))
      .mockResolvedValueOnce(jsonResponse({ ok: true }))
      .mockResolvedValueOnce(jsonResponse([]))
    vi.stubGlobal('fetch', fetchMock)
    vi.spyOn(window, 'confirm').mockReturnValue(true)

    render(<CoAgentHubExecutorsPanel />)

    fireEvent.click(await screen.findByRole('button', { name: '删除' }))
    expect(window.confirm).toHaveBeenCalledWith('删除执行器 dsh?')

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(`${DEFAULT_API_BASE}/executors/dsh`, { method: 'DELETE' })
    })
    expect(fetchMock).toHaveBeenCalledWith(`${DEFAULT_API_BASE}/executors`)
    await waitFor(() => {
      expect(screen.getByText('暂无执行器')).toBeTruthy()
    })
  })

  it('skips the DELETE when confirm is dismissed', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse([executor({ key: 'dsh', builtin: false })]))
    vi.stubGlobal('fetch', fetchMock)
    vi.spyOn(window, 'confirm').mockReturnValue(false)

    render(<CoAgentHubExecutorsPanel />)

    fireEvent.click(await screen.findByRole('button', { name: '删除' }))
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(fetchMock).not.toHaveBeenCalledWith(`${DEFAULT_API_BASE}/executors/dsh`, expect.anything())
  })

  it('shows an error when the delete fails (e.g. builtin rejection)', async () => {
    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url === `${DEFAULT_API_BASE}/executors` && init === undefined) {
        return Promise.resolve(jsonResponse([executor({ key: 'dsh', builtin: false })]))
      }
      return Promise.resolve(jsonResponse({ code: 'CONFLICT', message: '内置执行器不可删除: dsh' }, 409))
    })
    vi.stubGlobal('fetch', fetchMock)
    vi.spyOn(window, 'confirm').mockReturnValue(true)

    render(<CoAgentHubExecutorsPanel />)

    fireEvent.click(await screen.findByRole('button', { name: '删除' }))

    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain('删除失败:HTTP 409')
    })
  })

  it('submits the create form and reloads + clears fields on success', async () => {
    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (init !== undefined && init.method === 'POST') {
        return Promise.resolve(jsonResponse({ ok: true }))
      }
      return Promise.resolve(jsonResponse([executor()]))
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<CoAgentHubExecutorsPanel />)

    fireEvent.click(screen.getByRole('button', { name: '新增执行器' }))
    fireEvent.change(screen.getByLabelText('新增 key'), { target: { value: 'demo-1' } })
    fireEvent.change(screen.getByLabelText('新增 agentName'), { target: { value: 'Demo 执行器' } })
    fireEvent.change(screen.getByLabelText('新增 bin'), { target: { value: 'demo' } })
    fireEvent.change(screen.getByLabelText('新增 args'), { target: { value: '-y -p {ticket}' } })
    fireEvent.change(screen.getByLabelText('新增 model'), { target: { value: 'deepseek-chat' } })
    fireEvent.click(screen.getByRole('button', { name: '添加' }))

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(`${DEFAULT_API_BASE}/executors`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          key: 'demo-1',
          kind: 'cli',
          agentName: 'Demo 执行器',
          bin: 'demo',
          model: 'deepseek-chat',
          args: ['-y', '-p', '{ticket}'],
        }),
      })
    })
    // 成功后重新拉列表并清空表单
    expect(fetchMock).toHaveBeenCalledWith(`${DEFAULT_API_BASE}/executors`)
    await waitFor(() => {
      expect((screen.getByLabelText('新增 key') as HTMLInputElement).value).toBe('')
    })
  })

  it('blocks the create submit without a key', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse([]))
    vi.stubGlobal('fetch', fetchMock)

    render(<CoAgentHubExecutorsPanel />)

    fireEvent.click(screen.getByRole('button', { name: '新增执行器' }))
    fireEvent.click(screen.getByRole('button', { name: '添加' }))

    expect(screen.getByRole('alert').textContent).toBe('key 必填')
    const postCalls = fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST')
    expect(postCalls).toHaveLength(0)
  })

  it('shows an error when the create POST fails', async () => {
    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (init !== undefined && init.method === 'POST') {
        return Promise.resolve(jsonResponse({ error: 'duplicate key' }, 409))
      }
      return Promise.resolve(jsonResponse([]))
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<CoAgentHubExecutorsPanel />)

    fireEvent.click(screen.getByRole('button', { name: '新增执行器' }))
    fireEvent.change(screen.getByLabelText('新增 key'), { target: { value: 'demo-dup' } })
    fireEvent.click(screen.getByRole('button', { name: '添加' }))

    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain('HTTP 409')
    })
  })

  it('copies the executor key to the clipboard', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse([executor({ key: 'executor' })])))

    render(<CoAgentHubExecutorsPanel />)

    fireEvent.click(await screen.findByRole('button', { name: '复制 key' }))

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith('executor')
    })
    expect(await screen.findByText('已复制')).toBeTruthy()
  })
})

describe('CoAgentHubExecutorsPanel helpers', () => {
  it('joins args into a preview capped at 60 chars', () => {
    expect(argsPreview(['-y', '-p', '{ticket}'])).toBe('-y -p {ticket}')
    const long = ['a'.repeat(70)]
    expect(argsPreview(long)).toBe(`${'a'.repeat(60)}…`)
    expect(argsPreview(undefined)).toBe('')
  })

  it('fetchExecutors accepts a bare array, items envelope, or null', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse([executor()])))
    await expect(fetchExecutors('/base')).resolves.toHaveLength(1)

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ items: [executor()] })))
    await expect(fetchExecutors('/base')).resolves.toHaveLength(1)

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(null)))
    await expect(fetchExecutors('/base')).resolves.toEqual([])
  })
})
