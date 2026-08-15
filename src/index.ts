/**
 * CoAgentHub tools plugin for DeepSeek Harness: lets the dsh agent operate
 * CoAgentHub (list participants / create groups / post messages / dispatch
 * tasks / query tasks) through six tools.
 * @module @laizhixingxingdeli/dsh-coagenthub
 */

import type { Context } from '@deepseek-ai/cordis'
import { CoAgentHubClient } from './client.ts'
import { getCoAgentHubSettingsStore } from './config.ts'
import { notificationDeliverer } from './notify.ts'
import { TaskWatcher } from './task-watcher.ts'
import { registerCoAgentHubTools } from './tools.ts'
import { CoAgentHubWsClient } from './ws-client.ts'

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

/** Register the CoAgentHub tools against a shared client + background watcher. */
export function apply(ctx: Context, config: CoAgentHubPluginConfig = {}): void {
  const settingsStore = getCoAgentHubSettingsStore()
  const client = new CoAgentHubClient({
    baseURL: config.apiBase,
    participantId: config.participantId,
    // Share the proxy's settings store so panel saves also steer the tools.
    settingsStore,
  })
  ctx.effect(() => registerCoAgentHubTools(ctx, client, settingsStore), 'coagenthub.tools()')

  // B 方案后台事件链路:WS 订阅 + 低频轮询兜底,通知进队列(可被
  // coagenthub_get_notifications 拉取;预留推送接口在 notify.ts)。
  const ws = new CoAgentHubWsClient({
    baseURL: client.baseURL,
    // 每次(重)连时重新解析 apiBase,设置面板改地址后即时生效。
    getBaseURL: () => client.baseURL,
    getParticipantId: () => client.participantId,
  })
  const watcher = new TaskWatcher({
    client,
    ws,
    deliver: notificationDeliverer,
    getActiveGroupId: () => settingsStore.get().activeGroupId,
  })
  ctx.effect(
    () => {
      watcher.start()
      return () => watcher.stop()
    },
    'coagenthub.task-watcher()',
  )
}
