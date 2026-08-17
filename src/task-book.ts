/**
 * Task-book rendering for `coagenthub_dispatch_task`: turns the structured
 * dispatch fields (goal / scope / acceptance / tests / report / priority /
 * dependencies) into a standard Markdown task book. Pure function — no I/O,
 * no client calls; `tools.ts` is the only caller.
 * @module @laizhixingxingdeli/dsh-coagenthub/task-book
 */

/** commitMode 语义:auto 保守自动判断;none 强制追加标记;default 不追加保持原样。 */
export type CommitMode = 'auto' | 'none' | 'default'

/** 服务端识别的"不产生代码提交"任务标记。 */
export const COMMIT_MODE_MARKER = '## CommitMode: none'
/** 服务端识别"跳过弱验收"的等价标记;已含它时同样不再追加。 */
export const SKIP_VERIFY_MARKER = '## Acceptance: skip-verify'

/**
 * 无提交任务特征(auto 模式保守判定):ASCII 关键词按词边界匹配,
 * 避免 "pnpm" 之类单词误命中 "npm" 造成误加。
 */
const NO_COMMIT_PATTERNS: ReadonlyArray<RegExp> = [
  /只读/,
  /发布/,
  /\bpublish/i,
  /\bnpm\b/,
  /纯 ?API/,
  /环境操作/,
  /环境/,
  /不产生代码提交/,
  /不会产生代码提交/,
]

/** 是否已含提交模式标记或跳过验收标记,避免重复追加。 */
export function hasCommitModeMarker(text: string): boolean {
  return text.includes(COMMIT_MODE_MARKER) || text.includes(SKIP_VERIFY_MARKER)
}

/** auto 模式:文本明显出现无提交任务特征时返回 true(宁可不加也不误加)。 */
export function looksLikeNoCommitTask(text: string): boolean {
  return NO_COMMIT_PATTERNS.some(pattern => pattern.test(text))
}

/**
 * 按 commitMode 语义在任务书末尾追加 `## CommitMode: none`:
 * - `none`:强制追加;已含标记时不再追加。
 * - `default`:不追加,保持原样。
 * - `auto`(默认):仅在文本明显出现无提交任务特征时追加。
 * 未知取值按 auto 处理,保证仅追加不误伤。
 */
export function applyCommitMode(taskBook: string, commitMode: CommitMode | undefined): string {
  const mode = commitMode === 'none' || commitMode === 'default' ? commitMode : 'auto'
  if (mode === 'default' || hasCommitModeMarker(taskBook)) return taskBook
  if (mode === 'auto' && !looksLikeNoCommitTask(taskBook)) return taskBook
  const trimmed = taskBook.trimEnd()
  return trimmed === '' ? COMMIT_MODE_MARKER : `${trimmed}\n\n${COMMIT_MODE_MARKER}`
}

export interface TaskBookInput {
  /** Original plain-text brief; kept verbatim as the task book preamble. */
  body?: string
  /** 提交模式标记控制(auto/none/default)。 */
  commitMode?: CommitMode
  /** 目标:要达成的结果。 */
  goal?: string
  /** 范围:涉及/不涉及的边界。 */
  scope?: string
  /** 验收标准:可验证的完成条件。 */
  acceptance?: string
  /** 测试要求:需要满足的测试约束。 */
  tests?: string
  /** 汇报格式:完成后如何汇报。 */
  report?: string
  /** 优先级:相对紧急程度。 */
  priority?: string
  /** 依赖:前置条件或依赖项。 */
  dependencies?: string
}

/** Section header order: goal first, dependencies last. */
const SECTION_HEADERS: ReadonlyArray<readonly [keyof TaskBookInput, string]> = [
  ['goal', '目标'],
  ['scope', '范围'],
  ['acceptance', '验收标准'],
  ['tests', '测试要求'],
  ['report', '汇报格式'],
  ['priority', '优先级'],
  ['dependencies', '依赖'],
]

function isFilled(value: string | undefined): value is string {
  return value !== undefined && value.trim() !== ''
}

/**
 * Render a task book from the structured fields. When none of the structured
 * fields are filled, returns the body verbatim (backward compatible with the
 * old plain-text dispatch). Otherwise the body is the preamble followed by one
 * `## <标题>` section per filled structured field.
 */
export function buildTaskBook(input: TaskBookInput): string {
  const filledSections = SECTION_HEADERS.filter(([key]) => isFilled(input[key]))
  const body = input.body ?? ''
  let taskBook: string
  if (filledSections.length === 0) {
    taskBook = body
  } else {
    const parts: string[] = []
    if (body.trim() !== '') parts.push(body.trim())
    for (const [key, header] of filledSections) {
      parts.push(`## ${header}\n\n${input[key]!.trim()}`)
    }
    taskBook = parts.join('\n\n')
  }
  return applyCommitMode(taskBook, input.commitMode)
}
