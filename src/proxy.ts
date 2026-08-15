/**
 * CoAgentHub same-origin proxy (host half, web-only). Registers
 * `/coagenthub-api/*` on the dsh webserver and forwards to the CoAgentHub API,
 * because the browser cannot call the API cross-origin (it sends no
 * `Access-Control-Allow-Origin`). Split from the tools plugin so headless
 * profiles (which have no `webServer` service) still load the tools.
 *
 * Beyond forwarding, it also serves two same-origin routes that never touch
 * the upstream: the runtime settings endpoints (`/coagenthub-api-config`,
 * GET/PUT) and the raw task-output endpoint (`/coagenthub-api/raw/<taskId>`),
 * which returns the full process output as text/plain for a new-tab viewer.
 * The forward target is resolved from the settings store per request
 * (设置 > 插件 config > 环境变量 > 默认), so saving from the panel applies
 * immediately without editing cordis.yml or restarting.
 * @module @laizhixingxingdeli/dsh-coagenthub/proxy
 */

import type { Context } from '@deepseek-ai/cordis'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { CoAgentHubClient } from './client.ts'
import { getCoAgentHubSettingsStore, type CoAgentHubSettings, type CoAgentHubSettingsStore } from './config.ts'
import {
  buildWorkspaceStatus,
  defaultNetUse,
  defaultPathExists,
  runWorkspaceSetup,
  WorkspaceSetupError,
  type WorkspaceRegistryLike,
  type WorkspaceRouteDeps,
  type WorkspaceSetupInput,
} from './workspace.ts'

/** Minimal structural face of the dsh webserver route registry (host service). */
interface WebServerLike {
  register(route: {
    kind: 'exact' | 'prefix'
    path: string
    handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>
  }): () => void
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** The dsh host webserver route registry (provided by @deepseek-ai/dsh-host-webserver). */
    webServer: WebServerLike
    /** The dsh workspace registry service (provided by @deepseek-ai/dsh-workspace). */
    workspaceRegistry?: WorkspaceRegistryLike
  }
}

/** Cordis function-plugin name. */
export const name = 'coagenthub-proxy'

// No static `inject`: the proxy registers dynamically via ctx.inject when the
// `webServer` service becomes available (web profile). In headless profiles the
// service never appears, the callback never runs, and the plugin still loads —
// a static inject would fail the whole boot there.

/** Same-origin prefix the browser half fetches; proxied to the CoAgentHub API. */
export const PROXY_PATH = '/coagenthub-api'

/** Same-origin settings route served here (GET/PUT, never forwarded upstream). */
export const SETTINGS_PATH = `${PROXY_PATH}-config`

export interface CoAgentHubProxyConfig {
  /** CoAgentHub API base URL; defaults to `http://localhost:3001/api`. */
  apiBase?: string
  /** Participant identity sent as `X-Participant-Id`; falls back to the environment. */
  participantId?: string
}

/** Read the request body as UTF-8 text (proxy forwarding / settings PUT). */
function readRequestBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => chunks.push(chunk))
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

/** Send a JSON response with the given status. */
function json(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status
  res.setHeader('content-type', 'application/json')
  res.end(JSON.stringify(body))
}

/**
 * Settings endpoints: `GET` returns the current settings, `PUT` merges a patch
 * `{ apiBase?, participantId? }`, persists best-effort and applies immediately.
 */
export async function handleSettings(
  req: IncomingMessage,
  res: ServerResponse,
  store: CoAgentHubSettingsStore,
): Promise<void> {
  if (req.method === 'GET') {
    json(res, 200, store.get())
    return
  }
  if (req.method === 'PUT') {
    let patch: CoAgentHubSettings
    try {
      const parsed = JSON.parse(await readRequestBody(req)) as Partial<CoAgentHubSettings>
      patch = {
        apiBase: parsed.apiBase,
        participantId: parsed.participantId,
        mappingRule: parsed.mappingRule,
        activeGroupId: parsed.activeGroupId,
      }
    } catch {
      json(res, 400, { error: 'invalid JSON body' })
      return
    }
    const saved = store.set(patch)
    json(res, 200, { ok: true, settings: saved })
    return
  }
  json(res, 405, { error: `method ${req.method} not allowed` })
}

/**
 * Locate a task by id across the groups of the configured CoAgentHub API and
 * return its full output tail. `{ found: false }` when the task is unknown;
 * `{ found: true, output: null }` when it exists but has no buffered output.
 */
export async function findTaskOutput(
  client: CoAgentHubClient,
  taskId: string,
): Promise<{ found: boolean; output: string | null }> {
  const groups = await client.listGroups(100)
  for (const group of groups.items) {
    const tasks = await client.listTasks(group.id, true)
    const task = tasks.find(candidate => candidate.id === taskId)
    if (task !== undefined) {
      const tail = task.diffSummary?.outputTail
      return { found: true, output: tail === undefined || tail === null ? null : tail }
    }
  }
  return { found: false, output: null }
}

/**
 * Raw output endpoint: `GET /coagenthub-api/raw/<taskId>` returns the task's
 * full process output as text/plain (new-tab viewer), or 404 with a hint when
 * the task is unknown or has no buffered output yet.
 */
export async function handleRawOutput(
  req: IncomingMessage,
  res: ServerResponse,
  client: CoAgentHubClient,
): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://localhost')
  const taskId = decodeURIComponent(url.pathname.split('/').pop() ?? '')
  if (taskId === '') {
    res.statusCode = 400
    res.setHeader('content-type', 'text/plain; charset=utf-8')
    res.end('missing task id')
    return
  }
  try {
    const { found, output } = await findTaskOutput(client, taskId)
    res.setHeader('content-type', 'text/plain; charset=utf-8')
    if (!found) {
      res.statusCode = 404
      res.end(`未找到任务 ${taskId} 的完整输出`)
      return
    }
    if (output === null || output.trim() === '') {
      res.statusCode = 404
      res.end(`任务 ${taskId} 暂无完整输出`)
      return
    }
    res.statusCode = 200
    res.end(output)
  } catch (error) {
    res.statusCode = 502
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }))
  }
}

/** Same-origin workspace-setup route (POST, never forwarded upstream). */
export const WORKSPACE_SETUP_PATH = `${PROXY_PATH}/workspace-setup`

/** Same-origin workspace-status route (GET, never forwarded upstream). */
export const WORKSPACE_STATUS_PATH = `${PROXY_PATH}/workspace-status`

/**
 * Route the two workspace endpoints of `/coagenthub-api` (never forwarded
 * upstream): `POST workspace-setup` runs the one-click Windows setup, `GET
 * workspace-status` reports the mapping rule plus the per-group state.
 */
export async function handleWorkspaceRoute(
  req: IncomingMessage,
  res: ServerResponse,
  deps: WorkspaceRouteDeps,
): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://localhost')
  if (url.pathname === WORKSPACE_SETUP_PATH) {
    if (req.method !== 'POST') {
      json(res, 405, { error: `method ${req.method} not allowed` })
      return
    }
    let input: WorkspaceSetupInput
    try {
      const parsed = JSON.parse(await readRequestBody(req)) as WorkspaceSetupInput
      input = {
        shareName: parsed.shareName,
        macUser: parsed.macUser,
        macPassword: parsed.macPassword,
        driveLetter: parsed.driveLetter,
      }
    } catch {
      json(res, 400, { error: 'invalid JSON body' })
      return
    }
    try {
      const result = await runWorkspaceSetup(input, deps)
      json(res, 200, result)
    } catch (error) {
      if (error instanceof WorkspaceSetupError) {
        json(res, error.status, { error: error.message })
        return
      }
      json(res, 502, { error: error instanceof Error ? error.message : String(error) })
    }
    return
  }
  if (url.pathname === WORKSPACE_STATUS_PATH) {
    if (req.method !== 'GET') {
      json(res, 405, { error: `method ${req.method} not allowed` })
      return
    }
    try {
      const status = await buildWorkspaceStatus(deps)
      json(res, 200, status)
    } catch (error) {
      json(res, 502, { error: error instanceof Error ? error.message : String(error) })
    }
    return
  }
  json(res, 404, { error: `unknown workspace route ${url.pathname}` })
}

/**
 * Register the same-origin routes the browser half fetches. The web page
 * cannot call the CoAgentHub API cross-origin (it sends no
 * `Access-Control-Allow-Origin`), so the host half forwards
 * `/coagenthub-api/<rest>` to the effective `{apiBase}/<rest>`, carrying the
 * participant identity when configured. The forward target is read from the
 * settings store on every request, so panel saves take effect immediately.
 */
export function apply(
  ctx: Context,
  config: CoAgentHubProxyConfig = {},
  settingsStore: CoAgentHubSettingsStore = getCoAgentHubSettingsStore(),
): void {
  console.log('[coagenthub-proxy] apply: waiting for webServer service')
  const client = new CoAgentHubClient({
    baseURL: config.apiBase,
    participantId: config.participantId,
    settingsStore,
  })
  ctx.effect(() => {
    let dispose: (() => void) | undefined
    void ctx.inject(['webServer', 'workspaceRegistry'], (webCtx) => {
      console.log('[coagenthub-proxy] webServer available, registering proxy', PROXY_PATH)
      // Workspace endpoints resolve the dsh registry lazily per request, so a
      // profile without the workspaceRegistry service still gets the proxy and
      // the settings routes (workspace endpoints degrade to 503 for setup).
      const workspaceDeps: WorkspaceRouteDeps = {
        getPlatform: () => process.platform,
        getApiBase: () => client.baseURL,
        runNetUse: defaultNetUse,
        pathExists: defaultPathExists,
        getRegistry: () => webCtx.workspaceRegistry ?? null,
        store: settingsStore,
        listGroups: () => client.listGroups(100).then(result => result.items),
      }
      // Settings endpoint is NOT under the /coagenthub-api prefix (no trailing
      // segment), so it needs its own exact route to reach the handler.
      const disposeSettings = webCtx.webServer.register({
        kind: 'exact',
        path: SETTINGS_PATH,
        handler: async (req: IncomingMessage, res: ServerResponse) => {
          await handleSettings(req, res, settingsStore)
        },
      })
      dispose = webCtx.webServer.register({
      kind: 'prefix',
      path: PROXY_PATH,
      handler: async (req: IncomingMessage, res: ServerResponse) => {
        console.log('[coagenthub-proxy] proxying', req.url)
        const url = new URL(req.url ?? '/', 'http://localhost')
        if (url.pathname === WORKSPACE_SETUP_PATH || url.pathname === WORKSPACE_STATUS_PATH) {
          await handleWorkspaceRoute(req, res, workspaceDeps)
          return
        }
        if (url.pathname.startsWith(`${PROXY_PATH}/raw/`)) {
          await handleRawOutput(req, res, client)
          return
        }
        const rest = url.pathname.replace(PROXY_PATH, '') + url.search
        const headers: Record<string, string> = { 'content-type': 'application/json' }
        const participantId = client.participantId
        if (participantId !== undefined) headers['x-participant-id'] = participantId
        const body = req.method === 'GET' || req.method === 'HEAD' ? undefined : await readRequestBody(req)
        try {
          const upstream = await fetch(`${client.baseURL}${rest}`, {
            method: req.method,
            headers,
            body,
          })
          const text = await upstream.text()
          res.statusCode = upstream.status
          res.setHeader('content-type', upstream.headers.get('content-type') ?? 'application/json')
          res.end(text)
        } catch (error) {
          res.statusCode = 502
          res.setHeader('content-type', 'application/json')
          res.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }))
        }
      },
      })
      const prevDispose = dispose
      dispose = () => { prevDispose?.(); disposeSettings() }
    })
    return () => { dispose?.() }
  }, 'coagenthub.proxy()')
}
