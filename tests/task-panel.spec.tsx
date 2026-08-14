// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import {
  CoAgentHubTaskPanel,
  TASK_REFRESH_MS,
  attemptTimeline,
  capOutput,
  formatUpdatedAt,
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

  it('expands a row into attempt timeline + diff output tail', async () => {
    const withAttempts = task({
      id: 't1',
      status: 'failed',
      brief: '实现登录页(带超长摘要,用于验证展开详情中的摘要截断)'.repeat(3),
      diffSummary: {
        summary: '登录页失败',
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
    expect(screen.getByText('第 1 次 失败 exit 1 → 第 2 次 已完成 abc1234')).toBeTruthy()
    expect(screen.getByText(/exit 1: build failed/)).toBeTruthy()
    // 展开详情中的 brief 摘要(前 300 字)可见
    expect(screen.getByText(/带超长摘要/)).toBeTruthy()
    // 输出 tail 超长截断到 2000 字
    const output = screen.getByText(/tail-line-1/)
    expect(output.textContent?.length).toBeLessThanOrEqual(2001)

    fireEvent.click(row)
    expect(screen.queryByText('第 1 次 失败 exit 1 → 第 2 次 已完成 abc1234')).toBeNull()
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

  it('caps free-text details at 2000 chars', () => {
    const long = 'o'.repeat(3000)
    expect(capOutput(long).length).toBe(2001)
    expect(capOutput('  short  ')).toBe('short')
    expect(capOutput(null)).toBe('')
  })

  it('formats updatedAt as relative time', () => {
    const now = Date.parse('2026-08-14T12:00:00Z')
    expect(formatUpdatedAt('2026-08-14T11:59:40Z', now)).toBe('刚刚')
    expect(formatUpdatedAt('2026-08-14T11:50:00Z', now)).toBe('10 分钟前')
    expect(formatUpdatedAt('2026-08-14T10:00:00Z', now)).toBe('2 小时前')
  })
})
