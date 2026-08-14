/**
 * CoAgentHub tools plugin for DeepSeek Harness: lets the dsh agent operate
 * CoAgentHub (list participants / create groups / post messages / dispatch
 * tasks / query tasks) through six tools.
 * @module @laizhixingxingdeli/dsh-coagenthub
 */

import type { Context } from '@deepseek-ai/cordis'
import { CoAgentHubClient } from './client.ts'
import { registerCoAgentHubTools } from './tools.ts'

/** Cordis function-plugin name. */
export const name = 'coagenthub'

/** Services required before this plugin can register its tools. */
export const inject = ['tools']

export interface CoAgentHubPluginConfig {
  /** CoAgentHub API base URL; defaults to `http://localhost:3001/api`. */
  apiBase?: string
  /** Participant identity sent as `X-Participant-Id`; falls back to the environment. */
  participantId?: string
}

/** Register the six CoAgentHub tools against a shared client. */
export function apply(ctx: Context, config: CoAgentHubPluginConfig = {}): void {
  const client = new CoAgentHubClient({
    baseURL: config.apiBase,
    participantId: config.participantId,
  })
  ctx.effect(() => registerCoAgentHubTools(ctx, client), 'coagenthub.tools()')
}
