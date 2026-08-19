/**
 * Durable task completion consumer (host half). Drives the claim → deliver →
 * ack/fail loop against the CoAgentHub core completion inbox:
 *
 *   list pending events → claim one (lease) → convert to notification →
 *   followup into the matched live agent → record eventId in dedupe store → ack.
 *
 * On any delivery failure (no live agent, followup throws, agents registry
 * missing) the event is failed back to the server so it stays retryable; it is
 * never silently acked. The dedupe store guarantees at-most-one followup across
 * ack retries and restarts.
 * @module @laizhixingxingdeli/dsh-coagenthub/completion-consumer
 */

import type { CoAgentHubClient, CompletionInboxItem } from './client.ts'
import type { CoAgentHubNotification } from './notification-queue.ts'
import type { NotificationDeliverer } from './notify.ts'
import { DedupeStore } from './dedupe-store.ts'

/** Default lease duration for a claimed event (30s — enough to followup + ack). */
export const DEFAULT_LEASE_MS = 30_000

/** Default retry-after when failing an event back to the server (60s). */
export const DEFAULT_RETRY_AFTER_MS = 60_000

/** Max events to claim+process per consume pass (keeps each tick bounded). */
export const DEFAULT_BATCH_LIMIT = 10

export interface CompletionConsumerOptions {
  /** HTTP client; must already carry the participant identity. */
  client: CoAgentHubClient
  /** Stable, non-secret local consumer id (per plugin instance). */
  consumerId: string
  /** Participant id whose inbox this consumer reads. */
  participantId: string
  /** Notification sink (push-first deliverer). */
  deliverer: NotificationDeliverer
  /** Dedupe store for at-most-one followup. */
  dedupe: DedupeStore
  /** Lease duration override; defaults to {@link DEFAULT_LEASE_MS}. */
  leaseMs?: number
  /** Retry-after override for fail(); defaults to {@link DEFAULT_RETRY_AFTER_MS}. */
  retryAfterMs?: number
  /** Max events to process per consume() call. */
  batchLimit?: number
  /** Optional logger (defaults to no-op). */
  log?: (message: string) => void
}

/**
 * Map a completion-event task status to the notification type. Mirrors the
 * existing {@link notificationTypeFor} mapping for WS frames.
 */
export function notificationTypeForCompletionStatus(status: string | null): CoAgentHubNotification['type'] {
  if (status === 'done') return 'task.completed'
  if (status === 'failed') return 'task.failed'
  if (status === 'cancelled') return 'task.failed'
  if (status === 'stalled') return 'task.stalled'
  return 'task.status_changed'
}

/** Convert a claimed completion event into a routable notification. */
export function notificationFromEvent(event: CompletionInboxItem): CoAgentHubNotification {
  const diffSummary = event.task.diffSummary as
    | { summary?: string | null; error?: string | null }
    | null
    | undefined
  const summary = diffSummary?.summary ?? diffSummary?.error ?? undefined
  return {
    type: notificationTypeForCompletionStatus(event.task.status),
    groupId: event.task.groupId,
    taskId: event.task.taskId,
    status: event.task.status ?? undefined,
    summary: typeof summary === 'string' && summary.length > 0 ? summary : undefined,
    dispatcherSessionId: event.dispatcherSessionId ?? undefined,
    dispatcherParticipantId: event.dispatcherParticipantId ?? undefined,
    eventId: event.eventId,
    time: new Date().toISOString(),
  }
}

/**
 * One consumer per plugin instance. `consume()` runs a single claim→deliver→ack
 * pass; it is invoked by the task watcher on the WS hint and on the fallback
 * timer. All errors are swallowed per-event so one bad event never aborts the
 * whole pass.
 */
export class CompletionConsumer {
  private readonly client: CoAgentHubClient
  private readonly consumerId: string
  private readonly participantId: string
  private readonly deliverer: NotificationDeliverer
  private readonly dedupe: DedupeStore
  private readonly leaseMs: number
  private readonly retryAfterMs: number
  private readonly batchLimit: number
  private readonly log: (message: string) => void

  constructor(options: CompletionConsumerOptions) {
    this.client = options.client
    this.consumerId = options.consumerId
    this.participantId = options.participantId
    this.deliverer = options.deliverer
    this.dedupe = options.dedupe
    this.leaseMs = options.leaseMs ?? DEFAULT_LEASE_MS
    this.retryAfterMs = options.retryAfterMs ?? DEFAULT_RETRY_AFTER_MS
    this.batchLimit = options.batchLimit ?? DEFAULT_BATCH_LIMIT
    this.log = options.log ?? (() => {})
  }

  /**
   * Run one consume pass: list pending events, claim up to `batchLimit`, deliver
   * each, and ack/fail. Returns the number of events successfully acked.
   */
  async consume(): Promise<number> {
    let events: CompletionInboxItem[]
    try {
      const result = await this.client.listCompletionEvents(this.participantId, undefined, this.batchLimit)
      events = result.events
    } catch {
      // Inbox API unavailable (old server / network): swallow, next tick retries.
      return 0
    }
    let acked = 0
    for (const event of events) {
      // Already followup'd + acked (e.g. previous ack failed, restarted): only
      // retry the ack, never followup again.
      if (this.dedupe.has(event.eventId)) {
        await this.retryAck(event.eventId, event)
        if (this.dedupe.has(event.eventId)) acked += 1
        continue
      }
      try {
        const claimed = await this.client.claimCompletionEvent(
          this.participantId,
          event.eventId,
          this.consumerId,
          this.leaseMs,
        )
        await this.deliverAndAck(claimed.event, claimed.leaseToken)
        acked += 1
      } catch (error) {
        // Claim failed (409 already leased/delivered, or network): skip, next
        // tick may succeed. Do NOT ack.
        this.log(`[coagenthub] completion event ${event.eventId} claim failed, skipped: ${error}`)
      }
    }
    return acked
  }

  /**
   * Deliver a claimed event's notification and ack. On any delivery failure,
   * fail the event back to the server (retryable) instead of acking. The dedupe
   * id is recorded only after a successful followup, before ack; ack failure
   * leaves it recorded so a retry only re-acks.
   */
  private async deliverAndAck(event: CompletionInboxItem, leaseToken: string): Promise<void> {
    const notification = notificationFromEvent(event)
    try {
      this.deliverer.deliver(notification)
    } catch (error) {
      // Deliverer threw synchronously: fail the event, do NOT ack.
      await this.fail(event.eventId, leaseToken, `deliver threw: ${error}`)
      throw error
    }
    // followup succeeded: record eventId BEFORE ack so a restart with a lost
    // ack re-acks only, never followups again.
    this.dedupe.add(event.eventId)
    try {
      await this.client.ackCompletionEvent(this.participantId, event.eventId, leaseToken)
    } catch (error) {
      // Ack failed but dedupe already recorded: next consume() re-acks only.
      this.log(`[coagenthub] completion event ${event.eventId} ack failed (will retry ack only): ${error}`)
      throw error
    }
  }

  /** Retry the ack for an event we already followup'd (dedupe recorded). */
  private async retryAck(eventId: string, event: CompletionInboxItem): Promise<void> {
    // Re-claim to obtain a fresh lease token, then ack. If re-claim fails
    // (still leased by another consumer / not yet retriable), leave dedupe
    // recorded; a later tick will retry.
    try {
      const claimed = await this.client.claimCompletionEvent(
        this.participantId,
        eventId,
        this.consumerId,
        this.leaseMs,
      )
      await this.client.ackCompletionEvent(this.participantId, eventId, claimed.leaseToken)
    } catch (error) {
      this.log(`[coagenthub] completion event ${eventId} retry-ack failed (will retry later): ${error}`)
    }
  }

  /** Fail a claimed event back to the server so it stays retryable. */
  private async fail(eventId: string, leaseToken: string, error: string): Promise<void> {
    try {
      await this.client.failCompletionEvent(this.participantId, eventId, leaseToken, error, this.retryAfterMs)
    } catch {
      // fail() itself failed (network / token mismatch): lease will expire and
      // the event becomes reclaimable; nothing more to do here.
    }
  }
}
