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

  it('ignores stray fields on the session and still prefers header.cwd', () => {
    // meta 在真实 Session 上不存在;即便传入也不应覆盖 header.cwd。
    const root = workspaceRootFromExec({
      agent: { session: { header: { cwd: '/ws/header' }, meta: { cwd: '/ws/meta' } } },
    })
    expect(root).toBe('/ws/header')
  })

  it('falls back to process.cwd() when the exec carries no agent', () => {
    expect(workspaceRootFromExec(undefined)).toBe(process.cwd())
    expect(workspaceRootFromExec({})).toBe(process.cwd())
  })

  it('falls back to process.cwd() when the agent has no session', () => {
    const root = workspaceRootFromExec(execWithSession(undefined))
    expect(root).toBe(process.cwd())
  })

  it('falls back to process.cwd() when header.cwd is absent or empty', () => {
    expect(workspaceRootFromExec(execWithSession({}))).toBe(process.cwd())
    const root = workspaceRootFromExec(execWithSession({ cwd: '   ' }))
    expect(root).toBe(process.cwd())
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
