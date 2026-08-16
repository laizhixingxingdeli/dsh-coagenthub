// Shared test helpers for the client-ui specs: response fixtures and the
// per-test fetch mock that answers the group-list URL first, then the tasks
// payload for any group URL.

import { vi } from 'vitest'

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

export function groups(items: unknown[]): { items: unknown[]; total: number } {
  return { items, total: items.length }
}

/**
 * Per-test fetch mock: the group-list URL returns a fixed one-group fixture,
 * the participants URL returns `participants` (default: none), and every other
 * URL returns `tasks` (default: no tasks).
 */
export function groupFetchMock(tasks: unknown[] = [], participants: unknown[] = []) {
  return vi.fn().mockImplementation((url: string) => {
    if (url.includes('/groups?')) {
      return Promise.resolve(jsonResponse(groups([
        { id: 'g1', title: 'dsh-coagenthub 插件开发', status: 'active' },
      ])))
    }
    if (url.includes('/participants')) {
      return Promise.resolve(jsonResponse(participants))
    }
    return Promise.resolve(jsonResponse(tasks))
  })
}
