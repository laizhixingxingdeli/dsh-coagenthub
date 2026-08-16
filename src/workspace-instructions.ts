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
 * 真实 Session 上**没有** `meta` 字段(meta 只在 CreateSessionOptions /
 * CreateAgentOptions 创建选项里,创建时会折叠进 header),但保留读取
 * `session.meta?.cwd` 以兼容旧版本 dsh 运行时/旧数据结构(与 index.ts 推送侧
 * resolveSessionGroupId 的读取方式一致)。
 */
export interface WorkspaceExecLike {
  agent?: {
    session?: {
      /** 会话 id(真实路径):dsh-session Session.id,按会话查 per-session 工作区映射。 */
      id?: string
      /** 会话头字段(真实路径):dsh-session SessionHeader.cwd,会话创建时的绝对工作目录。 */
      header?: { cwd?: string }
      /** 旧结构兼容:dsh-session CreateSessionOptions.meta 里的 cwd(真实 Session 上没有该字段)。 */
      meta?: { cwd?: string }
    }
  }
}

/**
 * 从 live root agent 会话解析 cwd 的回退解析器。工具经非 agent 路径执行
 * (web 客户端桥接 / SDK 直调)时 `exec.agent` 缺失,此时用 dsh 运行时注册表
 * 的 root agent 会话目录作为回退(与 index.ts 推送侧 resolveSessionGroupId
 * 读取方式一致)。解析器能拿到 `agent.session.header.cwd` 或
 * `agent.session.meta?.cwd` 时才返回该 cwd,否则返回 null。
 */
export type LiveAgentCwdResolver = () => string | null

/**
 * 从 live root agent 会话解析 session id 的回退解析器:与
 * {@link LiveAgentCwdResolver} 同源,工具经非 agent 路径执行时用 root agent
 * 的 `agent.session.id` 作为 per-session 映射的查询键;拿不到时返回 null。
 */
export type LiveAgentSessionIdResolver = () => string | null

function isUsableCwd(cwd: string | null | undefined): cwd is string {
  return cwd !== undefined && cwd !== null && cwd.trim() !== ''
}

/**
 * Read the current session id from a tool exec context: `agent.session.id`
 * (真实路径:dsh-session Session.id,见 {@link WorkspaceExecLike})。拿不到或为空
 * 时返回 null,调用方随之回落全局 activeGroupId 兼容兜底 / 按 cwd 反查。
 */
export function sessionIdFromExec(exec: unknown): string | null {
  const ctx = exec as WorkspaceExecLike | undefined
  const id = ctx?.agent?.session?.id
  return typeof id === 'string' && id.trim() !== '' ? id : null
}

/**
 * Resolve the current workspace root from a tool exec context. 优先读
 * `agent.session.header.cwd`(真实路径,见 {@link WorkspaceExecLike});其次兼容
 * 旧结构 `agent.session.meta?.cwd`;两者都没有时尝试 `resolveLiveAgentCwd`
 * (live root agent 会话目录,覆盖 exec.agent 缺失的桥接/SDK 直调路径);
 * 全部拿不到时返回 null。
 *
 * **不再回退 `process.cwd()`**:常驻 dsh web 进程的 process.cwd() 是 dsh 启动
 * 目录(本插件仓库根目录)而非会话所在目录,回退它会把会话误判到启动目录绑定
 * 的群。若部署中 header.cwd 持续为空,应排查会话创建端是否通过
 * ctx.sessions.create / CreateAgentOptions 的 meta 传入 cwd。
 *
 * `exec` is typed `unknown` because the real `ToolRunContext.agent` type is
 * opaque to this module; only the `cwd` field is read, so a structural cast is
 * enough and keeps this file free of dsh runtime type imports.
 */
export function workspaceRootFromExec(
  exec: unknown,
  resolveLiveAgentCwd?: LiveAgentCwdResolver,
): string | null {
  const ctx = exec as WorkspaceExecLike | undefined
  const headerCwd = ctx?.agent?.session?.header?.cwd
  if (isUsableCwd(headerCwd)) return headerCwd
  const metaCwd = ctx?.agent?.session?.meta?.cwd
  if (isUsableCwd(metaCwd)) return metaCwd
  if (resolveLiveAgentCwd !== undefined) {
    try {
      const liveCwd = resolveLiveAgentCwd()
      if (isUsableCwd(liveCwd)) return liveCwd
    } catch {
      // 解析器失败视为拿不到 cwd,继续返回 null。
    }
  }
  return null
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
