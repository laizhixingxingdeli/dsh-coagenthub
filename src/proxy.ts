/**
 * CoAgentHub same-origin proxy (host half, web-only). Registers
 * `/coagenthub-api/*` on the dsh webserver and forwards to the CoAgentHub API,
 * because the browser cannot call the API cross-origin (it sends no
 * `Access-Control-Allow-Origin`). Split from the tools plugin so headless
 * profiles (which have no `webServer` service) still load the tools.
 * @module @laizhixingxingdeli/dsh-coagenthub/proxy
 */

import type { Context } from '@deepseek-ai/cordis'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { CoAgentHubClient } from './client.ts'

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

export interface CoAgentHubProxyConfig {
  /** CoAgentHub API base URL; defaults to `http://localhost:3001/api`. */
  apiBase?: string
  /** Participant identity sent as `X-Participant-Id`; falls back to the environment. */
  participantId?: string
}

/** Read the request body as UTF-8 text (proxy forwarding). */
function readRequestBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => chunks.push(chunk))
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

/**
 * Register the same-origin proxy route the browser half fetches. The web page
 * cannot call the CoAgentHub API cross-origin (it sends no
 * `Access-Control-Allow-Origin`), so the host half forwards
 * `/coagenthub-api/<rest>` to `{apiBase}/<rest>`, carrying the participant
 * identity when configured.
 */
export function apply(ctx: Context, config: CoAgentHubProxyConfig = {}): void {
  console.log('[coagenthub-proxy] apply: waiting for webServer service')
  const client = new CoAgentHubClient({
    baseURL: config.apiBase,
    participantId: config.participantId,
  })
  const apiBase = client.baseURL
  const participantId = client.participantId
  ctx.effect(() => {
    let dispose: (() => void) | undefined
    void ctx.inject(['webServer'], (webCtx) => {
      console.log('[coagenthub-proxy] webServer available, registering proxy', PROXY_PATH)
      dispose = webCtx.webServer.register({
      kind: 'prefix',
      path: PROXY_PATH,
      handler: async (req: IncomingMessage, res: ServerResponse) => {
        console.log('[coagenthub-proxy] proxying', req.url)
        try {
          const url = new URL(req.url ?? '/', 'http://localhost')
          const rest = url.pathname.replace(PROXY_PATH, '') + url.search
          const headers: Record<string, string> = { 'content-type': 'application/json' }
          if (participantId) headers['x-participant-id'] = participantId
          const body = req.method === 'GET' || req.method === 'HEAD' ? undefined : await readRequestBody(req)
          const upstream = await fetch(`${apiBase}${rest}`, {
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
    })
    return () => { dispose?.() }
  }, 'coagenthub.proxy()')
}
