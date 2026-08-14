// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { CoAgentHubSettings, SETTINGS_PATH, fetchSettings, saveSettings } from '../src/client-ui/CoAgentHubSettings.tsx'
import { jsonResponse } from './helpers.ts'

afterEach(() => {
  cleanup()
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

  it('saves empty inputs as unset fields (clears the settings)', async () => {
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(jsonResponse({ ok: true, settings: {} })))
    vi.stubGlobal('fetch', fetchMock)

    render(<CoAgentHubSettings />)

    fireEvent.click(screen.getByRole('button', { name: '保存' }))

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(SETTINGS_PATH, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
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
