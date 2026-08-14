/**
 * CoAgentHub panel container (browser half). Hosts the 群列表 / 任务 / 执行器 /
 * 设置 content components behind a header + tab bar, so the shell overlay shows
 * a single floating panel instead of one per feature. The panel temporarily
 * widens while a task detail is expanded (data-detail-open), and a settings
 * save bumps a reload key so the data tabs refetch against the new address.
 * @module @laizhixingxingdeli/dsh-coagenthub/client-ui
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import css from './CoAgentHubPanel.module.css'
import { CoAgentHubGroupList, DEFAULT_API_BASE } from './CoAgentHubGroupList.tsx'
import { CoAgentHubTaskPanel } from './CoAgentHubTaskPanel.tsx'
import { CoAgentHubExecutorsPanel } from './CoAgentHubExecutorsPanel.tsx'
import { CoAgentHubSettings, fetchSettings } from './CoAgentHubSettings.tsx'
import {
  fetchWorkspaceStatus,
  isWindowsPlatform,
  readActiveGroupId,
  saveActiveGroupId,
  writeActiveGroupId,
  type WorkspaceStatusView,
} from './workspace-status.ts'

/** Panel tabs: group list, task panel, executor management, and settings. */
export type CoAgentHubTab = 'groups' | 'tasks' | 'executors' | 'settings'

/** Panel props: only the API base is configurable; everything else is framework-injected. */
export interface CoAgentHubPanelProps {
  /** API base; defaults to the same-origin proxy route. */
  apiBase?: string
}

/** Tab order + copy, kept in one place for the tab bar and the tests. */
export const PANEL_TABS: ReadonlyArray<{ id: CoAgentHubTab; label: string }> = [
  { id: 'groups', label: '群列表' },
  { id: 'tasks', label: '任务' },
  { id: 'executors', label: '执行器' },
  { id: 'settings', label: '设置' },
]

/**
 * The CoAgentHub panel: header with a 群列表 | 任务 | 执行器 | 设置 tab bar over
 * the active content component. Keeps `aria-label="CoAgentHub 面板"` (phase-2
 * panel identity) so the overlay seat exposes a single labeled surface.
 */
const PANEL_SIZE_KEY = 'coagenthub.panelSize'
const DEFAULT_SIZE = { width: 360, height: 620 }
const MIN_SIZE = { width: 280, height: 320 }
const MAX_SIZE = { width: 640, height: 900 }

function readSavedSize(): { width: number; height: number } {
  try {
    const raw = localStorage.getItem(PANEL_SIZE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as { width?: number; height?: number }
      if (typeof parsed.width === 'number' && typeof parsed.height === 'number') {
        return {
          width: Math.min(MAX_SIZE.width, Math.max(MIN_SIZE.width, parsed.width)),
          height: Math.min(MAX_SIZE.height, Math.max(MIN_SIZE.height, parsed.height)),
        }
      }
    }
  } catch {
    // localStorage 不可用或数据损坏:回落默认尺寸。
  }
  return DEFAULT_SIZE
}

export function CoAgentHubPanel({ apiBase = DEFAULT_API_BASE }: CoAgentHubPanelProps) {
  const [tab, setTab] = useState<CoAgentHubTab>('groups')
  const [taskDetailOpen, setTaskDetailOpen] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)
  const [size, setSize] = useState(readSavedSize)
  const sizeRef = useRef(size)
  sizeRef.current = size
  const resizeStart = useRef<{ x: number; y: number; w: number; h: number } | null>(null)

  // 当前虚拟工作区:localStorage 记住;host 设置镜像让 agent 侧工具可读。
  const [activeGroupId, setActiveGroupId] = useState<string | null>(() => readActiveGroupId())
  const [workspaceStatus, setWorkspaceStatus] = useState<WorkspaceStatusView | null>(null)

  // 加载群投影状态;保存设置后(reloadKey)重新拉取,映射规则变化能反映到下拉。
  useEffect(() => {
    let alive = true
    fetchWorkspaceStatus().then(
      (view) => { if (alive) setWorkspaceStatus(view) },
      () => { if (alive) setWorkspaceStatus(null) },
    )
    const saved = readActiveGroupId()
    if (saved !== null) {
      setActiveGroupId(saved)
    } else {
      fetchSettings().then(
        (settings) => {
          if (alive && settings.activeGroupId !== undefined && settings.activeGroupId !== '') {
            setActiveGroupId(settings.activeGroupId)
          }
        },
        () => {},
      )
    }
    return () => { alive = false }
  }, [reloadKey])

  const handleWorkspaceChange = (event: React.ChangeEvent<HTMLSelectElement>): void => {
    const next = event.target.value === '' ? null : event.target.value
    setActiveGroupId(next)
    writeActiveGroupId(next)
    // host 镜像失败只影响 agent 侧工具,不阻塞本次选择。
    void saveActiveGroupId(next).catch(() => {})
  }

  // 拖拽调整大小:pointerdown 记录起点,pointermove 更新,pointerup 结束并持久化。
  const onResizePointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault()
    resizeStart.current = { x: e.clientX, y: e.clientY, w: size.width, h: size.height }
    const onMove = (ev: PointerEvent) => {
      if (!resizeStart.current) return
      const { x, y, w, h } = resizeStart.current
      const nextW = Math.min(MAX_SIZE.width, Math.max(MIN_SIZE.width, w + (ev.clientX - x)))
      const nextH = Math.min(MAX_SIZE.height, Math.max(MIN_SIZE.height, h + (ev.clientY - y)))
      setSize({ width: nextW, height: nextH })
      sizeRef.current = { width: nextW, height: nextH }
    }
    const onUp = () => {
      resizeStart.current = null
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      try {
        // 用 ref 里的最新尺寸保存(state 更新是异步的,闭包里的 size 已过期)。
        localStorage.setItem(PANEL_SIZE_KEY, JSON.stringify(sizeRef.current))
      } catch {
        // 持久化失败不影响本次调整。
      }
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }, [size])

  // The task panel unmounts on tab switch; reset the widened-panel flag.
  useEffect(() => {
    if (tab !== 'tasks') setTaskDetailOpen(false)
  }, [tab])

  return (
    <section
      className={css.panel}
      data-detail-open={taskDetailOpen || undefined}
      aria-label="CoAgentHub 面板"
      style={{ width: size.width, height: size.height }}
    >
      <header className={css.header}>
        <h2 className={css.title}>CoAgentHub</h2>
        <div className={css.tabs} role="tablist" aria-label="面板切换">
          {PANEL_TABS.map(({ id, label }) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              data-active={tab === id || undefined}
              className={css.tab}
              onClick={() => setTab(id)}
            >
              {label}
            </button>
          ))}
        </div>
      </header>
      <div className={css.workspaceBar}>
        <label className={css.workspaceLabel} htmlFor="coagenthub-workspace-select">当前工作区</label>
        <select
          id="coagenthub-workspace-select"
          className={css.workspaceSelect}
          value={activeGroupId ?? ''}
          onChange={handleWorkspaceChange}
          aria-label="当前工作区"
        >
          <option value="">未选择</option>
          {(workspaceStatus?.workspaces ?? []).map((workspace) => (
            <option key={workspace.groupId} value={workspace.groupId}>
              {workspace.groupTitle}({workspace.winPath ?? workspace.macPath})
            </option>
          ))}
        </select>
        {!isWindowsPlatform() && <span className={css.workspaceNote}>自动映射仅 Windows 支持</span>}
      </div>
      <div className={css.body}>
        {tab === 'groups' && <CoAgentHubGroupList key={`groups-${reloadKey}`} apiBase={apiBase} />}
        {tab === 'tasks' && (
          <CoAgentHubTaskPanel
            key={`tasks-${reloadKey}`}
            apiBase={apiBase}
            defaultGroupId={activeGroupId ?? undefined}
            onDetailChange={setTaskDetailOpen}
          />
        )}
        {tab === 'executors' && <CoAgentHubExecutorsPanel key={`executors-${reloadKey}`} apiBase={apiBase} />}
        {tab === 'settings' && <CoAgentHubSettings onSaved={() => setReloadKey((v) => v + 1)} />}
      </div>
      {/* 右下角拖拽手柄(pointer-events:auto,避开 overlay 点击穿透) */}
      <div
        className={css.resizeHandle}
        role="separator"
        aria-orientation="horizontal"
        aria-label="调整面板大小"
        onPointerDown={onResizePointerDown}
      />
    </section>
  )
}
