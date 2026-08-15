/**
 * Workspace-level instruction reading (host half): resolves the current dsh
 * session's working directory and reads `COAGENTHUB.md` from it, so the
 * Windows-side commander agent can load the plugin's operating instructions.
 * Kept OUT of client.ts (which is pure HTTP) on purpose.
 * @module @laizhixingxingdeli/dsh-coagenthub/workspace-instructions
 */

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

/** Instruction file name looked up at the workspace root. */
export const WORKSPACE_INSTRUCTIONS_FILE = 'COAGENTHUB.md'

/** Minimal structural face of a tool exec context (agent session metadata). */
export interface WorkspaceExecLike {
  agent?: { session?: { meta?: { cwd?: string } } }
}

/**
 * Resolve the current workspace root from a tool exec context (the agent
 * session's validated cwd). Falls back to `process.cwd()` for headless runs
 * where the exec carries no agent; null when neither is usable.
 *
 * `exec` is typed `unknown` because the real `ToolRunContext.agent` type is
 * opaque to this module; only the `cwd` field is read, so a structural cast is
 * enough and keeps this file free of dsh runtime type imports.
 */
export function workspaceRootFromExec(exec: unknown): string | null {
  const ctx = exec as WorkspaceExecLike | undefined
  const cwd = ctx?.agent?.session?.meta?.cwd
  if (cwd !== undefined && cwd !== null && cwd.trim() !== '') return cwd
  try {
    const fallback = process.cwd()
    return fallback.trim() !== '' ? fallback : null
  } catch {
    return null
  }
}

/**
 * Read `COAGENTHUB.md` from the workspace root. Returns null when the root is
 * unknown, the file is absent, or reading fails (非插件工作区)。
 */
export async function readWorkspaceInstructions(workspaceRoot: string | null | undefined): Promise<string | null> {
  if (workspaceRoot === null || workspaceRoot === undefined || workspaceRoot.trim() === '') return null
  try {
    return await readFile(join(workspaceRoot, WORKSPACE_INSTRUCTIONS_FILE), 'utf8')
  } catch {
    return null
  }
}
