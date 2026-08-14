/**
 * CoAgentHub tools plugin for DeepSeek Harness: lets the dsh agent operate
 * CoAgentHub (list participants / create groups / post messages / dispatch
 * tasks / query tasks) through six tools.
 * @module @laizhixingxingdeli/dsh-coagenthub
 */

import type { Context } from '@deepseek-ai/cordis'
import { CoAgentHubClient } from './client.ts'
import { getCoAgentHubSettingsStore } from './config.ts'
import { registerCoAgentHubTools } from './tools.ts'

/** Cordis function-plugin name. */
export const name = 'coagenthub'

/** Services required before the CoAgentHub tools can register. */
export const inject = ['tools']

export interface CoAgentHubPluginConfig {
  /** CoAgentHub API base URL; defaults to `http://localhost:3001/api`. */
  apiBase?: string
  /** Participant identity sent as `X-Participant-Id`; falls back to the environment. */
  participantId?: string
}

/** Register the seven CoAgentHub tools against a shared client. */
export function apply(ctx: Context, config: CoAgentHubPluginConfig = {}): void {
  const client = new CoAgentHubClient({
    baseURL: config.apiBase,
    participantId: config.participantId,
    // Share the proxy's settings store so panel saves also steer the tools.
    settingsStore: getCoAgentHubSettingsStore(),
  })
  ctx.effect(() => registerCoAgentHubTools(ctx, client, getCoAgentHubSettingsStore()), 'coagenthub.tools()')
}
