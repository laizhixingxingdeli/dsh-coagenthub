import { describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { WORKSPACE_INSTRUCTIONS_FILE, readWorkspaceInstructions, workspaceRootFromExec } from '../src/workspace-instructions.ts'

/**
 * 按 dsh-tools 真实类型链构造 exec:ToolRunContext.agent.session 是
 * dsh-session 的 Session 类,会话 cwd 在 SessionHeader.cwd(即
 * agent.session.header.cwd);Session 上没有 meta 字段。
 */
function execWithSession(header: { cwd?: string } | undefined): unknown {
  return { agent: { session: header !== undefined ? { header } : undefined } }
}

describe('workspaceRootFromExec', () => {
  it('reads the session cwd from the real exec shape agent.session.header.cwd', () => {
    const root = workspaceRootFromExec(execWithSession({ cwd: 'Z:\\CoAgentHub' }))
    expect(root).toBe('Z:\\CoAgentHub')
  })

  it('prefers header.cwd over the legacy session.meta.cwd and stray fields', () => {
    // header.cwd 是真实路径;即便传入旧结构 meta.cwd 也不应覆盖它。
    const root = workspaceRootFromExec({
      agent: { session: { header: { cwd: '/ws/header' }, meta: { cwd: '/ws/meta' } } },
    })
    expect(root).toBe('/ws/header')
  })

  it('falls back to the legacy session.meta.cwd when header.cwd is absent', () => {
    // 旧结构兼容:真实 Session 上无 meta 字段,但保留读取以兼容旧版本 dsh 运行时
    // (与 index.ts 推送侧 resolveSessionGroupId 的读取方式一致)。
    const root = workspaceRootFromExec({ agent: { session: { meta: { cwd: '/ws/meta' } } } })
    expect(root).toBe('/ws/meta')
  })

  it('uses the live-agent resolver when the exec carries no agent', () => {
    expect(workspaceRootFromExec(undefined, () => '/live/root')).toBe('/live/root')
    expect(workspaceRootFromExec({}, () => '/live/root')).toBe('/live/root')
    expect(workspaceRootFromExec(execWithSession(undefined), () => '/live/root')).toBe('/live/root')
  })

  it('prefers the exec session header.cwd over the live-agent resolver', () => {
    const root = workspaceRootFromExec(execWithSession({ cwd: '/ws/header' }), () => '/live/root')
    expect(root).toBe('/ws/header')
  })

  it('prefers the legacy meta.cwd over the live-agent resolver', () => {
    const root = workspaceRootFromExec({ agent: { session: { meta: { cwd: '/ws/meta' } } } }, () => '/live/root')
    expect(root).toBe('/ws/meta')
  })

  it('returns null when no session cwd is available and no resolver yields one', () => {
    expect(workspaceRootFromExec(undefined)).toBeNull()
    expect(workspaceRootFromExec({})).toBeNull()
    expect(workspaceRootFromExec(execWithSession(undefined))).toBeNull()
    expect(workspaceRootFromExec(execWithSession({}))).toBeNull()
    expect(workspaceRootFromExec(execWithSession({ cwd: '   ' }))).toBeNull()
    expect(workspaceRootFromExec({ agent: { session: { meta: { cwd: '   ' } } } })).toBeNull()
  })

  it('returns null when the live-agent resolver yields nothing or throws', () => {
    expect(workspaceRootFromExec(undefined, () => null)).toBeNull()
    expect(workspaceRootFromExec(undefined, () => '   ')).toBeNull()
    expect(workspaceRootFromExec(undefined, () => { throw new Error('boom') })).toBeNull()
  })
})

describe('readWorkspaceInstructions', () => {
  it('reads COAGENTHUB.md from the workspace root', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'coagenthub-inst-'))
    try {
      writeFileSync(join(dir, WORKSPACE_INSTRUCTIONS_FILE), '# 指令\n\n指挥官职责\n')
      expect(await readWorkspaceInstructions(dir)).toBe('# 指令\n\n指挥官职责\n')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('returns null when the file is absent', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'coagenthub-empty-'))
    try {
      expect(await readWorkspaceInstructions(dir)).toBeNull()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('returns null for an unknown workspace root', async () => {
    expect(await readWorkspaceInstructions(null)).toBeNull()
    expect(await readWorkspaceInstructions(undefined)).toBeNull()
  })
})
