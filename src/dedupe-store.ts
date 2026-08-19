/**
 * Bounded, persistent store of recently-acked completion-event ids. Used by the
 * completion consumer to guarantee at-most-one followup across ack retries and
 * restarts: `agent.followup` succeeds → record eventId → ack. If ack fails and
 * the consumer restarts, the recorded id means "already followup'd, only retry
 * ack", so followup runs exactly once.
 *
 * Backed by a JSON file next to the existing settings file
 * (`$DSH_HOME`/`.dsh/coagenthub-dedupe.json`). Bounded FIFO: oldest ids are
 * evicted past capacity (default 1000) so disk stays flat.
 * @module @laizhixingxingdeli/dsh-coagenthub/dedupe-store
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

/** Default cap: spec requires at least 1000; keep a safety margin. */
export const DEFAULT_DEDUPE_CAPACITY = 1000

/** File name of the persisted dedupe store. */
export const DEDUPE_FILE_NAME = 'coagenthub-dedupe.json'

export interface DedupeFile {
  /** Oldest→newest event ids; index 0 is the oldest. */
  ids: string[]
}

/**
 * Resolve the dedupe file path: `$DSH_HOME/coagenthub-dedupe.json` when
 * `DSH_HOME` is set, else fall back to `~/.dsh/coagenthub-dedupe.json`.
 */
export function defaultDedupeFilePath(): string {
  const home = process.env.DSH_HOME
  if (home !== undefined && home.trim() !== '') return join(home, DEDUPE_FILE_NAME)
  return join(homedir(), '.dsh', DEDUPE_FILE_NAME)
}

function loadFromDisk(filePath: string | null): string[] {
  if (filePath === null) return []
  try {
    const parsed = JSON.parse(readFileSync(filePath, 'utf8')) as Partial<DedupeFile>
    if (Array.isArray(parsed.ids) && parsed.ids.every(value => typeof value === 'string')) {
      return parsed.ids
    }
    return []
  } catch {
    return []
  }
}

function persistToDisk(filePath: string | null, ids: string[]): void {
  if (filePath === null) return
  try {
    mkdirSync(dirname(filePath), { recursive: true })
    const payload: DedupeFile = { ids }
    writeFileSync(filePath, JSON.stringify(payload), 'utf8')
  } catch {
    // non-fatal: keep serving from memory
  }
}

/**
 * Bounded, persistent dedupe store. `has` / `add` operate on an in-memory array
 * that is persisted best-effort on every mutation. Read/write failures never
 * block — memory is the fallback, matching the settings store convention.
 */
export class DedupeStore {
  private readonly filePath: string | null
  private readonly capacity: number
  private ids: string[]

  constructor(capacity: number = DEFAULT_DEDUPE_CAPACITY, filePath: string | null = defaultDedupeFilePath()) {
    this.filePath = filePath
    this.capacity = capacity
    this.ids = loadFromDisk(filePath)
    if (this.ids.length > this.capacity) {
      this.ids = this.ids.slice(this.ids.length - this.capacity)
    }
  }

  /** Current number of recorded ids. */
  get size(): number {
    return this.ids.length
  }

  /** Return true when `id` has been recorded as already followup'd + acked. */
  has(id: string): boolean {
    return this.ids.includes(id)
  }

  /**
   * Record an id (evicting the oldest past capacity). No-op when already
   * present — the id is left in place so FIFO order is preserved.
   */
  add(id: string): void {
    const existing = this.ids.indexOf(id)
    if (existing !== -1) return
    this.ids.push(id)
    if (this.ids.length > this.capacity) {
      this.ids.splice(0, this.ids.length - this.capacity)
    }
    persistToDisk(this.filePath, this.ids)
  }

  /** Snapshot of recorded ids (oldest→newest); for tests/debug. */
  peek(): string[] {
    return [...this.ids]
  }
}
