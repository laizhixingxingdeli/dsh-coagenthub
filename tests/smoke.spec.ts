import { describe, expect, it } from 'vitest'
import { CoAgentHubClient } from '../src/client.ts'

const UNIQUE_PREFIX = `smoke-${Date.now()}`

/**
 * Real-API smoke test against a locally running CoAgentHub server.
 * Skipped unless COAGENTHUB_SMOKE=1. Flow: list participants → create a
 * uniquely named group → post a broadcast message → list tasks (may be empty)
 * → list messages.
 */
describe.skipIf(process.env.COAGENTHUB_SMOKE !== '1')('CoAgentHub smoke (real API)', () => {
  it('runs the list → create → message → tasks → messages loop', async () => {
    const client = new CoAgentHubClient()

    const participants = await client.listParticipants()
    expect(participants.length).toBeGreaterThan(0)
    expect(participants.some(participant => participant.name.includes('执行器'))).toBe(true)

    const group = await client.createGroup(`${UNIQUE_PREFIX}-群`)
    expect(group.id).toBeTruthy()
    expect(group.title).toBe(`${UNIQUE_PREFIX}-群`)

    const message = await client.postMessage(group.id, { body: `${UNIQUE_PREFIX} 冒烟消息` })
    expect(message.id).toBeTruthy()

    const tasks = await client.listTasks(group.id)
    expect(Array.isArray(tasks)).toBe(true)

    const messages = await client.listMessages(group.id)
    expect(messages.some(candidate => candidate.body === `${UNIQUE_PREFIX} 冒烟消息`)).toBe(true)
  }, 30_000)
})
