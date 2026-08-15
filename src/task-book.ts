/**
 * Task-book rendering for `coagenthub_dispatch_task`: turns the structured
 * dispatch fields (goal / scope / acceptance / tests / report / priority /
 * dependencies) into a standard Markdown task book. Pure function — no I/O,
 * no client calls; `tools.ts` is the only caller.
 * @module @laizhixingxingdeli/dsh-coagenthub/task-book
 */

export interface TaskBookInput {
  /** Original plain-text brief; kept verbatim as the task book preamble. */
  body?: string
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
  if (filledSections.length === 0) return body

  const parts: string[] = []
  if (body.trim() !== '') parts.push(body.trim())
  for (const [key, header] of filledSections) {
    parts.push(`## ${header}\n\n${input[key]!.trim()}`)
  }
  return parts.join('\n\n')
}
