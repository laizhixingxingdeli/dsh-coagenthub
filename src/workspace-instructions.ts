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

/**
 * Minimal structural face of a tool exec context (agent session metadata).
 *
 * 已按 @deepseek-ai/dsh-tools 0.1.0-rc.6 的声明文件核对过真实类型链:
 *   ToolRunContext extends ToolExecution extends ToolExecutionInput
 *   ToolExecutionInput.agent?: Agent       (dsh-agent;可选,由 agent loop 设置)
 *   Agent.session: Session                 (dsh-session 的 Session 类)
 *   Session.header: SessionHeader          (总是存在;无 store 元数据时合成最小 header)
 *   SessionHeader.cwd?: string             (会话创建时的绝对工作目录,若有)
 * 因此 exec 里会话 cwd 的真实字段路径是 `agent.session.header.cwd`。
 * 注意 Session 上**没有** `meta` 字段——`meta` 只存在于 CreateSessionOptions /
 * CreateAgentOptions(创建选项),创建时会折叠进 header,旧代码读的
 * `session.meta.cwd` 在真实结构里不存在。
 */
export interface WorkspaceExecLike {
  agent?: {
    session?: {
      /** 会话头字段(真实路径):dsh-session SessionHeader.cwd,会话创建时的绝对工作目录。 */
      header?: { cwd?: string }
    }
  }
}

/**
 * Resolve the current workspace root from a tool exec context. 优先读
 * `agent.session.header.cwd`(真实路径,见 {@link WorkspaceExecLike});拿不到时
 * 回退 `process.cwd()`(headless / exec 未携带 agent,或会话创建时未携带存储
 * 元数据导致 header.cwd 为空);两者都不可用时返回 null。
 *
 * exec.agent 是可选字段("set by the agent loop"):工具经非 agent 路径执行(如
 * web 客户端桥接、SDK 直调)时 exec 上可能没有 agent,此时 exec 里没有其它字段
 * 能还原会话 cwd(仅 agent.id / session.id 可标识会话,但不携带路径),只能回退
 * process.cwd()。若部署中 header.cwd 持续为空,应排查会话创建端是否通过
 * ctx.sessions.create / CreateAgentOptions 的 meta 传入 cwd。
 *
 * `exec` is typed `unknown` because the real `ToolRunContext.agent` type is
 * opaque to this module; only the `cwd` field is read, so a structural cast is
 * enough and keeps this file free of dsh runtime type imports.
 */
export function workspaceRootFromExec(exec: unknown): string | null {
  const ctx = exec as WorkspaceExecLike | undefined
  const cwd = ctx?.agent?.session?.header?.cwd
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
