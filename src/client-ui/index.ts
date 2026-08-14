/**
 * CoAgentHub plugin, browser half. Registers the panel (群列表 + 任务 + 执行器
 * tabs) into the `shell.overlay` seat (ui-layout): the sidebar and details
 * columns are both single-kind slots with fixed occupants (SidebarRoot /
 * DetailsPanel), so registering there would replace shipped UI; shell.overlay
 * is the list-kind additive seat designed for a frame-wide surface of your
 * own, and its root scope renders without a current session.
 * @module @laizhixingxingdeli/dsh-coagenthub/client
 */

import { CoAgentHubPanel } from './CoAgentHubPanel.tsx'
import { CoAgentHubExecutorsPanel } from './CoAgentHubExecutorsPanel.tsx'

export { CoAgentHubExecutorsPanel }

/** Required services: the slot registry the panel registers into. */
export const inject = ['slots']

/** Minimal structural face of the client slot registry (dsh slots service). */
interface ClientSlotsLike {
  inject(name: string, factory: () => unknown): unknown
  register(config: { name: string; id?: string }, component: unknown): unknown
}

/** Minimal structural face of the client plugin context. */
interface ClientContextLike {
  slots: ClientSlotsLike
}

/**
 * Client plugin body: register the panel (群列表 | 任务 tabs) into the shell
 * overlay. `slots.inject` waits on the declaration (ui-layout) before
 * registering, so apply order against ui-layout is irrelevant.
 */
export function apply(ctx: ClientContextLike): void {
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay',
    id: 'coagenthub-panel',
  }, CoAgentHubPanel))
}
