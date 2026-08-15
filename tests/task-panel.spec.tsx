// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import {
  CoAgentHubTaskPanel,
  REMINDER_DISMISS_MS,
  TASK_REFRESH_MS,
  attemptTimeline,
  capOutput,
  diffTaskStatuses,
  fetchTasks,
  formatUpdatedAt,
  normalizeTaskView,
  notifyDesktop,
  parseFinalReport,
  rawOutputUrl,
  statusLabel,
  type CoAgentHubTaskView,
} from '../src/client-ui/CoAgentHubTaskPanel.tsx'
import { DEFAULT_API_BASE, GROUP_LIST_LIMIT } from '../src/client-ui/CoAgentHubGroupList.tsx'
import { groupFetchMock, jsonResponse, groups } from './helpers.ts'

function task(overrides: Partial<CoAgentHubTaskView> = {}): CoAgentHubTaskView {
  return {
    id: 't1',
    status: 'done',
    executorKey: 'atomcode',
    brief: '实现登录页',
    diffSummary: { summary: '', hash: 'abc123456789', error: null, outputTail: null },
    attempts: [],
    createdAt: '2026-08-14T10:00:00Z',
    updatedAt: '2026-08-14T10:00:00Z',
    retryCount: 0,
    ...overrides,
  }
}

/** Wait until the group dropdown is populated, then pick a group. */
async function selectGroup(value: string): Promise<void> {
  await screen.findByRole('option', { name: 'dsh-coagenthub 插件开发' })
  fireEvent.change(screen.getByLabelText('选择群组'), { target: { value } })
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('CoAgentHubTaskPanel', () => {
  it('loads the group dropdown on mount and fetches tasks after a group is selected', async () => {
    const fetchMock = groupFetchMock([task()])
    vi.stubGlobal('fetch', fetchMock)

    render(<CoAgentHubTaskPanel />)

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(`${DEFAULT_API_BASE}/groups?limit=${GROUP_LIST_LIMIT}`)
    })
    expect(screen.getByText('请选择群组查看任务')).toBeTruthy()

    await selectGroup('g1')

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(`${DEFAULT_API_BASE}/groups/g1/tasks?includeOutput=1`)
    })
    expect(await screen.findByText('实现登录页')).toBeTruthy()
  })

  it('renders the status badge copy + pulse for every task status', async () => {
    const tasks = [
      task({ id: 't-queued', status: 'queued' }),
      task({ id: 't-running', status: 'running' }),
      task({ id: 't-done', status: 'done' }),
      task({ id: 't-failed', status: 'failed' }),
      task({ id: 't-cancelled', status: 'cancelled' }),
    ]
    vi.stubGlobal('fetch', groupFetchMock(tasks))

    render(<CoAgentHubTaskPanel />)
    await selectGroup('g1')

    await screen.findByText('排队中')
    expect(screen.getByText('执行中')).toBeTruthy()
    expect(screen.getByText('已完成')).toBeTruthy()
    expect(screen.getByText('失败')).toBeTruthy()
    expect(screen.getByText('已取消')).toBeTruthy()

    const runningBadge = screen.getByText('执行中')
    expect(runningBadge.getAttribute('data-status')).toBe('running')
    expect(runningBadge.querySelector('[class*="pulse"]')).toBeTruthy()
  })

  it('expands a row into 任务书 + attempt timeline + final report + terminal output', async () => {
    const withAttempts = task({
      id: 't1',
      status: 'failed',
      brief: '实现登录页(带超长摘要,用于验证展开详情中的摘要截断)'.repeat(3),
      diffSummary: {
        summary: '提交: abc123456789\n测试: 12 passed\n汇报: 登录页失败原因已修复\n遗留: 无',
        hash: 'abc123456789',
        error: 'exit 1: build failed',
        outputTail: 'tail-line-1\ntail-line-2\n'.repeat(400),
      },
      attempts: [
        { n: 1, startedAt: '2026-08-14T09:00:00Z', endedAt: '2026-08-14T09:01:00Z', status: 'failed', error: 'exit 1', summary: null, hash: null },
        { n: 2, startedAt: '2026-08-14T10:00:00Z', endedAt: '2026-08-14T10:02:00Z', status: 'done', error: null, summary: 'ok', hash: 'abc123456789' },
      ],
    })
    vi.stubGlobal('fetch', groupFetchMock([withAttempts]))

    render(<CoAgentHubTaskPanel />)
    await selectGroup('g1')

    const row = await screen.findByRole('button', { name: /登录页失败/ })
    expect(row.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(row)

    expect(row.getAttribute('aria-expanded')).toBe('true')
    const detail = screen.getByTestId('task-detail')
    // 时间线节点:第 N 次 + 状态 + 原因 + 短提交
    expect(within(detail).getByText('第 1 次')).toBeTruthy()
    expect(within(detail).getByText('第 2 次')).toBeTruthy()
    expect(within(detail).getByText('已完成')).toBeTruthy()
    expect(within(detail).getByText('exit 1')).toBeTruthy()
    expect(within(detail).getByText('abc1234')).toBeTruthy()
    // 失败原因
    expect(within(detail).getByText(/exit 1: build failed/)).toBeTruthy()
    // 最终汇报:提交/测试/汇报/遗留 各段
    expect(within(detail).getByText('12 passed')).toBeTruthy()
    expect(within(detail).getByText(/登录页失败原因已修复/)).toBeTruthy()
    // 展开详情中的 brief 摘要(前 400 字)可见
    expect(within(detail).getByText(/带超长摘要/)).toBeTruthy()
    // 输出 tail 超长截断到 8000 字
    const output = within(detail).getByLabelText('过程输出')
    expect(output.textContent?.length).toBeLessThanOrEqual(8001)

    fireEvent.click(row)
    expect(screen.queryByText('第 1 次')).toBeNull()
  })

  it('opens the full output in a new browser tab via the raw proxy route', async () => {
    const openSpy = vi.spyOn(window, 'open').mockReturnValue(null)
    vi.stubGlobal('fetch', groupFetchMock([task({ id: 'task-42' })]))

    render(<CoAgentHubTaskPanel />)
    await selectGroup('g1')
    fireEvent.click(await screen.findByRole('button', { name: /实现登录页/ }))

    fireEvent.click(screen.getByRole('button', { name: '打开完整输出' }))

    expect(openSpy).toHaveBeenCalledWith(rawOutputUrl(DEFAULT_API_BASE, 'task-42'), '_blank', 'noopener')
  })

  it('filters the terminal output with the search box and highlights matches', async () => {
    const withOutput = task({
      diffSummary: { summary: '', hash: null, error: null, outputTail: 'line-alpha-1\nline-beta-2\nline-alpha-3' },
    })
    vi.stubGlobal('fetch', groupFetchMock([withOutput]))

    render(<CoAgentHubTaskPanel />)
    await selectGroup('g1')
    fireEvent.click(await screen.findByRole('button', { name: /实现登录页/ }))

    const detail = screen.getByTestId('task-detail')
    fireEvent.change(within(detail).getByLabelText('搜索输出'), { target: { value: 'alpha' } })

    // 命中行保留、未命中行被过滤(文本被 mark 拆分,用 textContent 断言)
    const terminal = within(detail).getByLabelText('过程输出')
    expect(terminal.textContent).toContain('line-alpha-1')
    expect(terminal.textContent).toContain('line-alpha-3')
    expect(terminal.textContent).not.toContain('line-beta-2')
    // 命中以 <mark> 高亮
    expect(within(detail).getAllByText('alpha')).toHaveLength(2)
  })

  it('toggles the terminal follow-scroll button', async () => {
    vi.stubGlobal('fetch', groupFetchMock([task({ diffSummary: { summary: '', hash: null, error: null, outputTail: 'some log' } })]))

    render(<CoAgentHubTaskPanel />)
    await selectGroup('g1')
    fireEvent.click(await screen.findByRole('button', { name: /实现登录页/ }))

    const follow = screen.getByRole('button', { name: '跟随滚动' })
    expect(follow.getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(follow)
    expect(follow.getAttribute('aria-pressed')).toBe('false')
  })

  it('expands the full brief beyond the 400-char preview', async () => {
    const longBrief = '长任务书内容'.repeat(100)
    vi.stubGlobal('fetch', groupFetchMock([task({ brief: longBrief })]))

    render(<CoAgentHubTaskPanel />)
    await selectGroup('g1')
    fireEvent.click(await screen.findByRole('button', { name: /长任务书内容/ }))

    const detail = screen.getByTestId('task-detail')
    expect(within(detail).getByText(/长任务书内容/).textContent?.length).toBe(401)
    fireEvent.click(within(detail).getByRole('button', { name: '展开全文' }))
    expect(within(detail).getByText(/长任务书内容/).textContent?.length).toBe(600)
    fireEvent.click(within(detail).getByRole('button', { name: '收起' }))
    expect(within(detail).getByText(/长任务书内容/).textContent?.length).toBe(401)
  })

  it('renders the final report sections parsed from the diffSummary summary', async () => {
    const withReport = task({
      diffSummary: {
        summary: '提交: a1b2c3d\n测试: 12 passed\n汇报: 完成登录页\n遗留: 无',
        hash: 'abcdef123456',
        error: null,
        outputTail: null,
      },
    })
    vi.stubGlobal('fetch', groupFetchMock([withReport]))

    render(<CoAgentHubTaskPanel />)
    await selectGroup('g1')
    fireEvent.click(await screen.findByRole('button', { name: /提交: a1b2c3d/ }))

    const detail = screen.getByTestId('task-detail')
    expect(within(detail).getByText('提交')).toBeTruthy()
    expect(within(detail).getByText('测试')).toBeTruthy()
    expect(within(detail).getByText('汇报')).toBeTruthy()
    expect(within(detail).getByText('遗留')).toBeTruthy()
    expect(within(detail).getByText('a1b2c3d')).toBeTruthy()
    expect(within(detail).getByText('12 passed')).toBeTruthy()
    expect(within(detail).getByText('完成登录页')).toBeTruthy()
    expect(within(detail).getByText('无')).toBeTruthy()
  })

  it('reports the detail-open state so the panel container can widen', async () => {
    const onDetailChange = vi.fn()
    vi.stubGlobal('fetch', groupFetchMock([task()]))

    render(<CoAgentHubTaskPanel onDetailChange={onDetailChange} />)
    await selectGroup('g1')
    fireEvent.click(await screen.findByRole('button', { name: /实现登录页/ }))
    await waitFor(() => expect(onDetailChange).toHaveBeenLastCalledWith(true))

    fireEvent.click(screen.getByRole('button', { name: /实现登录页/ }))
    await waitFor(() => expect(onDetailChange).toHaveBeenLastCalledWith(false))
  })

  it('renders the empty state for a group without tasks', async () => {
    vi.stubGlobal('fetch', groupFetchMock([]))

    render(<CoAgentHubTaskPanel />)
    await selectGroup('g1')

    await screen.findByText('暂无任务')
  })

  it('renders an error summary when the task fetch fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string) => {
      if (url.includes('/groups?')) {
        return Promise.resolve(jsonResponse(groups([
          { id: 'g1', title: 'dsh-coagenthub 插件开发', status: 'active' },
        ])))
      }
      return Promise.reject(new TypeError('Failed to fetch'))
    }))

    render(<CoAgentHubTaskPanel />)
    await selectGroup('g1')

    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toBe('任务加载失败:Failed to fetch')
    })
  })

  it('reloads tasks when the refresh button is clicked', async () => {
    const tasksUrl = `${DEFAULT_API_BASE}/groups/g1/tasks?includeOutput=1`
    const fetchMock = groupFetchMock([task()])
    vi.stubGlobal('fetch', fetchMock)

    render(<CoAgentHubTaskPanel />)
    await selectGroup('g1')
    await screen.findByText('实现登录页')

    const tasksCalls = () => fetchMock.mock.calls.filter(([url]) => url === tasksUrl).length
    expect(tasksCalls()).toBe(1)

    fireEvent.click(screen.getByRole('button', { name: '刷新' }))
    await waitFor(() => expect(tasksCalls()).toBe(2))
  })

  it('auto-refreshes tasks every 15s while a group is selected', async () => {
    vi.useFakeTimers()
    const tasksUrl = `${DEFAULT_API_BASE}/groups/g1/tasks?includeOutput=1`
    const fetchMock = groupFetchMock([task({ status: 'running' })])
    vi.stubGlobal('fetch', fetchMock)

    render(<CoAgentHubTaskPanel />)
    // flush the mount effect so the dropdown is populated before selecting
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    fireEvent.change(screen.getByLabelText('选择群组'), { target: { value: 'g1' } })
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })

    const tasksCalls = () => fetchMock.mock.calls.filter(([url]) => url === tasksUrl).length
    expect(tasksCalls()).toBe(1)

    await act(async () => { await vi.advanceTimersByTimeAsync(TASK_REFRESH_MS) })
    expect(tasksCalls()).toBe(2)
  })

  it('shows the loading state on first load after selecting a group', async () => {
    const resolvers: Array<(value: Response) => void> = []
    const fetchMock = vi.fn((url: string) => {
      if (url.includes('/groups?')) {
        return Promise.resolve(jsonResponse(groups([
          { id: 'g1', title: 'dsh-coagenthub 插件开发', status: 'active' },
        ])))
      }
      return new Promise<Response>((resolve) => { resolvers.push(resolve) })
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<CoAgentHubTaskPanel />)
    await selectGroup('g1')

    expect(screen.getByText('加载中…')).toBeTruthy()
    await act(async () => { resolvers[0]!(jsonResponse([task()])) })
    expect(await screen.findByText('实现登录页')).toBeTruthy()
  })

  it('keeps the task list visible during a manual refresh (no flicker)', async () => {
    const resolvers: Array<(value: Response) => void> = []
    const fetchMock = vi.fn((url: string) => {
      if (url.includes('/groups?')) {
        return Promise.resolve(jsonResponse(groups([
          { id: 'g1', title: 'dsh-coagenthub 插件开发', status: 'active' },
        ])))
      }
      return new Promise<Response>((resolve) => { resolvers.push(resolve) })
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<CoAgentHubTaskPanel />)
    await selectGroup('g1')
    await act(async () => { resolvers[0]!(jsonResponse([task()])) })
    await screen.findByText('实现登录页')

    // 手动刷新:第二次请求挂起期间旧列表仍然可见,不出现“加载中…”闪烁
    fireEvent.click(screen.getByRole('button', { name: '刷新' }))
    expect(resolvers).toHaveLength(2)
    expect(screen.queryByText('加载中…')).toBeNull()
    expect(screen.getByText('实现登录页')).toBeTruthy()

    await act(async () => { resolvers[1]!(jsonResponse([task({ id: 't2', brief: '刷新后的新任务' })])) })
    expect(await screen.findByText('刷新后的新任务')).toBeTruthy()
  })

  it('keeps the task list visible during auto-refresh (no flicker)', async () => {
    vi.useFakeTimers()
    const resolvers: Array<(value: Response) => void> = []
    const fetchMock = vi.fn((url: string) => {
      if (url.includes('/groups?')) {
        return Promise.resolve(jsonResponse(groups([
          { id: 'g1', title: 'dsh-coagenthub 插件开发', status: 'active' },
        ])))
      }
      return new Promise<Response>((resolve) => { resolvers.push(resolve) })
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<CoAgentHubTaskPanel />)
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    fireEvent.change(screen.getByLabelText('选择群组'), { target: { value: 'g1' } })
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    await act(async () => { resolvers[0]!(jsonResponse([task()])) })
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    expect(screen.getByText('实现登录页')).toBeTruthy()

    // 15s 自动刷新:第二次请求挂起期间旧列表仍然可见,不出现“加载中…”闪烁
    await act(async () => { await vi.advanceTimersByTimeAsync(TASK_REFRESH_MS) })
    expect(resolvers).toHaveLength(2)
    expect(screen.queryByText('加载中…')).toBeNull()
    expect(screen.getByText('实现登录页')).toBeTruthy()

    await act(async () => { resolvers[1]!(jsonResponse([task({ id: 't2', brief: '自动刷新后的新任务' })])) })
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    expect(screen.getByText('自动刷新后的新任务')).toBeTruthy()
  })

  it('keeps the previous list when a refresh fails', async () => {
    let tasksCall = 0
    const fetchMock = vi.fn((url: string) => {
      if (url.includes('/groups?')) {
        return Promise.resolve(jsonResponse(groups([
          { id: 'g1', title: 'dsh-coagenthub 插件开发', status: 'active' },
        ])))
      }
      tasksCall += 1
      if (tasksCall === 1) return Promise.resolve(jsonResponse([task()]))
      return Promise.reject(new TypeError('Failed to fetch'))
    })
    vi.stubGlobal('fetch', fetchMock)
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    render(<CoAgentHubTaskPanel />)
    await selectGroup('g1')
    await screen.findByText('实现登录页')

    fireEvent.click(screen.getByRole('button', { name: '刷新' }))
    await waitFor(() => expect(tasksCall).toBe(2))
    await waitFor(() => expect(warnSpy).toHaveBeenCalled())

    // 刷新失败:旧列表保留,无 error 提示、无 loading
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.queryByText('加载中…')).toBeNull()
    expect(screen.getByText('实现登录页')).toBeTruthy()
  })

  it('shows loading instead of the previous group list when switching groups', async () => {
    const resolvers: Array<(value: Response) => void> = []
    const fetchMock = vi.fn((url: string) => {
      if (url.includes('/groups?')) {
        return Promise.resolve(jsonResponse(groups([
          { id: 'g1', title: 'dsh-coagenthub 插件开发', status: 'active' },
          { id: 'g2', title: '第二个群组', status: 'active' },
        ])))
      }
      return new Promise<Response>((resolve) => { resolvers.push(resolve) })
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<CoAgentHubTaskPanel />)
    await selectGroup('g1')
    await act(async () => { resolvers[0]!(jsonResponse([task()])) })
    await screen.findByText('实现登录页')

    // 切到 g2:显示 loading,不再保留 g1 的列表
    fireEvent.change(screen.getByLabelText('选择群组'), { target: { value: 'g2' } })
    expect(screen.getByText('加载中…')).toBeTruthy()
    expect(screen.queryByText('实现登录页')).toBeNull()

    await act(async () => { resolvers[1]!(jsonResponse([task({ id: 'g2-task', brief: '群组二的任务' })])) })
    expect(await screen.findByText('群组二的任务')).toBeTruthy()
  })

  it('shows an error when switching to a group whose first load fails', async () => {
    let tasksCall = 0
    const fetchMock = vi.fn((url: string) => {
      if (url.includes('/groups?')) {
        return Promise.resolve(jsonResponse(groups([
          { id: 'g1', title: 'dsh-coagenthub 插件开发', status: 'active' },
          { id: 'g2', title: '第二个群组', status: 'active' },
        ])))
      }
      tasksCall += 1
      if (tasksCall === 1) return Promise.resolve(jsonResponse([task()]))
      return Promise.reject(new TypeError('Failed to fetch'))
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<CoAgentHubTaskPanel />)
    await selectGroup('g1')
    await screen.findByText('实现登录页')

    // 切到 g2 且首次加载失败:显示 error,而不是静默保留 g1 的列表
    fireEvent.change(screen.getByLabelText('选择群组'), { target: { value: 'g2' } })
    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toBe('任务加载失败:Failed to fetch')
    })
    expect(screen.queryByText('实现登录页')).toBeNull()
  })

  it('copies the task id to the clipboard from the expanded row', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    vi.stubGlobal('fetch', groupFetchMock([task({ id: 'task-42' })]))

    render(<CoAgentHubTaskPanel />)
    await selectGroup('g1')
    fireEvent.click(await screen.findByRole('button', { name: /实现登录页/ }))

    fireEvent.click(screen.getByRole('button', { name: '复制 id' }))

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith('task-42')
    })
    expect(await screen.findByText('已复制')).toBeTruthy()
  })

  it('renders rows from raw task rows that omit attempts and other display fields', async () => {
    // 服务端任务表原始行没有 attempts / brief / executorKey / updatedAt 等展示字段
    vi.stubGlobal('fetch', groupFetchMock([
      { id: 't1', status: 'done', createdAt: '2026-08-14T10:00:00Z', retryCount: 0 },
    ]))

    render(<CoAgentHubTaskPanel />)
    await selectGroup('g1')

    // 归一化后列表行正常渲染,展开详情不崩溃
    const row = await screen.findByRole('button', { name: /已完成/ })
    fireEvent.click(row)
    const detail = screen.getByTestId('task-detail')

    // 没有 attempts 时不渲染执行历史,也不报错
    expect(within(detail).queryByText('执行历史')).toBeNull()
    expect(within(detail).queryByText('第 1 次')).toBeNull()
    expect(within(detail).queryByText('任务书')).toBeNull()
  })
})

describe('CoAgentHubTaskPanel reminders', () => {
  /** Fetch mock answering the group list first, then tasks whose status flips after the first call. */
  function flipFetchMock(initialStatus: string, nextStatus: string) {
    let tasksCall = 0
    return vi.fn((url: string) => {
      if (url.includes('/groups?')) {
        return Promise.resolve(jsonResponse(groups([
          { id: 'g1', title: 'dsh-coagenthub 插件开发', status: 'active' },
        ])))
      }
      tasksCall += 1
      return Promise.resolve(jsonResponse([task({ id: 't1', status: tasksCall === 1 ? initialStatus : nextStatus })]))
    })
  }

  it('does not show a reminder banner on initial load, even for terminal tasks', async () => {
    vi.stubGlobal('fetch', groupFetchMock([task({ id: 't-done', status: 'done' })]))
    render(<CoAgentHubTaskPanel />)
    await selectGroup('g1')
    await screen.findByText('实现登录页')
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('shows a reminder banner when a task transitions running → done on refresh', async () => {
    vi.stubGlobal('fetch', flipFetchMock('running', 'done'))
    render(<CoAgentHubTaskPanel />)
    await selectGroup('g1')
    await screen.findByText('执行中')
    expect(screen.queryByRole('status')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: '刷新' }))

    const banner = await screen.findByRole('status')
    expect(within(banner).getByText('已完成')).toBeTruthy()
    expect(within(banner).getByText('atomcode')).toBeTruthy()
    expect(within(banner).getByText('实现登录页')).toBeTruthy()
  })

  it('does not remind twice for the same task and status', async () => {
    const fetchMock = flipFetchMock('running', 'done')
    vi.stubGlobal('fetch', fetchMock)
    render(<CoAgentHubTaskPanel />)
    await selectGroup('g1')
    await screen.findByText('执行中')

    fireEvent.click(screen.getByRole('button', { name: '刷新' }))
    await screen.findByRole('status')
    expect(screen.getAllByRole('status')).toHaveLength(1)

    // 再次刷新,任务仍为 done:同一任务同一状态不重复提醒
    fireEvent.click(screen.getByRole('button', { name: '刷新' }))
    await waitFor(() => expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(3))
    expect(screen.getAllByRole('status')).toHaveLength(1)
  })

  it('dismisses a reminder banner via its close button', async () => {
    vi.stubGlobal('fetch', flipFetchMock('running', 'done'))
    render(<CoAgentHubTaskPanel />)
    await selectGroup('g1')
    await screen.findByText('执行中')

    fireEvent.click(screen.getByRole('button', { name: '刷新' }))
    const banner = await screen.findByRole('status')

    fireEvent.click(within(banner).getByRole('button', { name: '关闭提醒' }))
    await waitFor(() => expect(screen.queryByRole('status')).toBeNull())
  })

  it('auto-dismisses a reminder banner after ~8 seconds', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', flipFetchMock('running', 'done'))
    render(<CoAgentHubTaskPanel />)
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    fireEvent.change(screen.getByLabelText('选择群组'), { target: { value: 'g1' } })
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    expect(screen.getByText('执行中')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '刷新' }))
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    expect(screen.getAllByRole('status')).toHaveLength(1)

    await act(async () => { await vi.advanceTimersByTimeAsync(REMINDER_DISMISS_MS) })
    expect(screen.queryByRole('status')).toBeNull()
  })
})

describe('CoAgentHubTaskPanel reminder helpers', () => {
  it('diffs task statuses across refresh rounds: baseline, transitions, dedupe', () => {
    const baseline = new Set<string>()
    const prevStatus = new Map<string, string>()
    const reminded = new Set<string>()

    // 首次加载:只记录基线,不提醒
    expect(diffTaskStatuses(baseline, prevStatus, reminded, 'g1', [
      task({ id: 't1', status: 'running' }),
      task({ id: 't2', status: 'done' }),
    ])).toEqual([])

    // running → done 提醒;done → done 不重复;首次出现的新任务(done)无上一轮状态不提醒
    const round2 = diffTaskStatuses(baseline, prevStatus, reminded, 'g1', [
      task({ id: 't1', status: 'done' }),
      task({ id: 't2', status: 'done' }),
      task({ id: 't3', status: 'done' }),
    ])
    expect(round2).toHaveLength(1)
    expect(round2[0]!.taskId).toBe('t1')
    expect(round2[0]!.status).toBe('done')
    expect(round2[0]!.executor).toBe('atomcode')
    expect(round2[0]!.summary).toBe('实现登录页')

    // failed / cancelled 也会提醒
    const round3 = diffTaskStatuses(baseline, prevStatus, reminded, 'g1', [
      task({ id: 't1', status: 'failed' }),
      task({ id: 't2', status: 'cancelled' }),
    ])
    expect(round3.map((r) => r.status).sort()).toEqual(['cancelled', 'failed'])

    // 相同状态再次出现:不再提醒
    expect(diffTaskStatuses(baseline, prevStatus, reminded, 'g1', [
      task({ id: 't1', status: 'failed' }),
      task({ id: 't2', status: 'cancelled' }),
    ])).toEqual([])
  })

  it('treats each group as its own baseline, so switching groups does not spam reminders', () => {
    const baseline = new Set<string>()
    const prevStatus = new Map<string, string>()
    const reminded = new Set<string>()
    const doneTask = task({ id: 't1', status: 'done' })

    expect(diffTaskStatuses(baseline, prevStatus, reminded, 'g1', [doneTask])).toEqual([])
    // 另一个群首次加载也是基线;切回 g1 时任务早已 done,不重复提醒
    expect(diffTaskStatuses(baseline, prevStatus, reminded, 'g2', [doneTask])).toEqual([])
    expect(diffTaskStatuses(baseline, prevStatus, reminded, 'g1', [doneTask])).toEqual([])
  })

  it('notifyDesktop sends a system notification only when hidden and permission is granted', () => {
    const NotificationCtor = vi.fn()
    const reminder = { key: 'g1:t1:done', taskId: 't1', status: 'done', executor: 'atomcode', summary: '实现登录页' }

    // 无权限:不发
    vi.stubGlobal('Notification', Object.assign(vi.fn(), { permission: 'denied' }))
    notifyDesktop([reminder])
    expect(NotificationCtor).not.toHaveBeenCalled()

    // 有权限但页面可见(jsdom document.hidden === false):不发
    vi.stubGlobal('Notification', Object.assign(NotificationCtor, { permission: 'granted' }))
    notifyDesktop([reminder])
    expect(NotificationCtor).not.toHaveBeenCalled()

    // 有权限且页面隐藏:发一条系统桌面通知
    const own = Object.getOwnPropertyDescriptor(document, 'hidden')
    Object.defineProperty(document, 'hidden', { value: true, configurable: true })
    try {
      notifyDesktop([reminder])
      expect(NotificationCtor).toHaveBeenCalledWith('CoAgentHub 任务已完成', { body: 'atomcode 实现登录页' })
    } finally {
      if (own !== undefined) Object.defineProperty(document, 'hidden', own)
      else delete (document as unknown as Record<string, unknown>).hidden
    }
  })
})

describe('CoAgentHubTaskPanel helpers', () => {
  it('maps statuses to the badge copy', () => {
    expect(statusLabel('queued')).toBe('排队中')
    expect(statusLabel('running')).toBe('执行中')
    expect(statusLabel('done')).toBe('已完成')
    expect(statusLabel('failed')).toBe('失败')
    expect(statusLabel('cancelled')).toBe('已取消')
    expect(statusLabel('unknown-status')).toBe('unknown-status')
  })

  it('renders the attempt timeline with error + short hash', () => {
    const timeline = attemptTimeline([
      { n: 1, startedAt: 'x', endedAt: null, status: 'failed', error: 'exit 1', summary: null, hash: null },
      { n: 2, startedAt: 'x', endedAt: 'x', status: 'done', error: null, summary: 'ok', hash: 'abc123456789' },
    ])
    expect(timeline).toBe('第 1 次 失败 exit 1 → 第 2 次 已完成 abc1234')
  })

  it('caps free-text details at 8000 chars', () => {
    const long = 'o'.repeat(9000)
    expect(capOutput(long).length).toBe(8001)
    expect(capOutput('  short  ')).toBe('short')
    expect(capOutput(null)).toBe('')
  })

  it('formats updatedAt as relative time', () => {
    const now = Date.parse('2026-08-14T12:00:00Z')
    expect(formatUpdatedAt('2026-08-14T11:59:40Z', now)).toBe('刚刚')
    expect(formatUpdatedAt('2026-08-14T11:50:00Z', now)).toBe('10 分钟前')
    expect(formatUpdatedAt('2026-08-14T10:00:00Z', now)).toBe('2 小时前')
  })

  it('parses the final report sections from diffSummary summary lines', () => {
    expect(parseFinalReport('提交: xyz\n测试: 5 passed\n汇报: ok\n遗留: 无', 'abcdef123456')).toEqual({
      提交: 'xyz',
      测试: '5 passed',
      汇报: 'ok',
      遗留: '无',
    })
    // 无标签行时整体作为汇报;提交回退到短 hash
    expect(parseFinalReport('plain summary text', 'abcdef123456')).toEqual({
      提交: 'abcdef1',
      测试: null,
      汇报: 'plain summary text',
      遗留: null,
    })
    expect(parseFinalReport(null, null)).toEqual({ 提交: null, 测试: null, 汇报: null, 遗留: null })
  })
})

describe('fetchTasks normalization', () => {
  it('fills missing display fields with safe defaults', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse([
      { id: 't1', status: 'done', createdAt: '2026-08-14T10:00:00Z', retryCount: 0 },
    ])))

    const tasks = await fetchTasks(DEFAULT_API_BASE, 'g1')

    expect(tasks).toEqual([{
      id: 't1',
      status: 'done',
      executorKey: '',
      executorLabel: '',
      brief: '',
      diffSummary: null,
      attempts: [],
      createdAt: '2026-08-14T10:00:00Z',
      updatedAt: '2026-08-14T10:00:00Z',
      retryCount: 0,
    }])
  })

  it('falls back to createdAt when updatedAt is missing', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse([
      { id: 't1', status: 'running', createdAt: '2026-08-14T10:00:00Z' },
    ])))

    const tasks = await fetchTasks(DEFAULT_API_BASE, 'g1')

    expect(tasks[0]!.updatedAt).toBe('2026-08-14T10:00:00Z')
  })

  it('keeps attempts / diffSummary / executor fields when the server sends them', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse([
      {
        id: 't1',
        status: 'failed',
        executorKey: 'atomcode',
        brief: '实现登录页',
        diffSummary: { summary: '提交: abc', hash: 'abc123456789', error: 'exit 1', outputTail: 'tail' },
        attempts: [
          { n: 1, startedAt: '2026-08-14T09:00:00Z', endedAt: '2026-08-14T09:01:00Z', status: 'failed', error: 'exit 1', summary: null, hash: null },
        ],
        createdAt: '2026-08-14T10:00:00Z',
        updatedAt: '2026-08-14T11:00:00Z',
        retryCount: 1,
      },
    ])))

    const tasks = await fetchTasks(DEFAULT_API_BASE, 'g1')

    expect(tasks[0]!.attempts).toHaveLength(1)
    expect(tasks[0]!.diffSummary?.hash).toBe('abc123456789')
    expect(tasks[0]!.executorKey).toBe('atomcode')
    expect(tasks[0]!.updatedAt).toBe('2026-08-14T11:00:00Z')
  })

  it('normalizes the { items } response wrapper too', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({
      items: [{ id: 't1', status: 'done', createdAt: '2026-08-14T10:00:00Z' }],
    })))

    const tasks = await fetchTasks(DEFAULT_API_BASE, 'g1')

    expect(tasks).toHaveLength(1)
    expect(tasks[0]!.attempts).toEqual([])
    expect(tasks[0]!.diffSummary).toBeNull()
  })

  it('normalizeTaskView maps a raw row to the full view shape', () => {
    expect(normalizeTaskView({ id: 't1', status: 'queued' })).toEqual({
      id: 't1',
      status: 'queued',
      executorKey: '',
      executorLabel: '',
      brief: '',
      diffSummary: null,
      attempts: [],
      createdAt: '',
      updatedAt: '',
      retryCount: 0,
    })
  })
})
