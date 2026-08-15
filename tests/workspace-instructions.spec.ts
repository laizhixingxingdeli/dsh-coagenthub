import { describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { WORKSPACE_INSTRUCTIONS_FILE, readWorkspaceInstructions, workspaceRootFromExec } from '../src/workspace-instructions.ts'

function execWith(session: { header?: { cwd?: string }; meta?: { cwd?: string } } | undefined): unknown {
  return { agent: { session } }
}

describe('workspaceRootFromExec', () => {
  it('prefers session.header.cwd over the legacy session.meta.cwd', () => {
    const root = workspaceRootFromExec(execWith({ header: { cwd: '/ws/header' }, meta: { cwd: '/ws/meta' } }))
    expect(root).toBe('/ws/header')
  })

  it('falls back to session.meta.cwd when header.cwd is absent (legacy shape)', () => {
    const root = workspaceRootFromExec(execWith({ meta: { cwd: '/ws/meta' } }))
    expect(root).toBe('/ws/meta')
  })

  it('falls back to process.cwd() when the exec carries no session cwd', () => {
    const root = workspaceRootFromExec(execWith(undefined))
    expect(root).toBe(process.cwd())
  })

  it('returns null when header.cwd is present but empty', () => {
    // 空 cwd 视为缺失:先回退 meta,再回退 process.cwd()。
    const root = workspaceRootFromExec(execWith({ header: { cwd: '   ' } }))
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
