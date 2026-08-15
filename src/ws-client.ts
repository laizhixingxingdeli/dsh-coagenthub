/**
 * Node-side WebSocket client for CoAgentHub events (host half). Connects to
 * `<apiBase>/ws?participantId=<id>`, parses JSON event frames and forwards
 * them, and reconnects with exponential backoff (1s → 30s). Identity is
 * re-resolved on demand so a settings change can tear down and reconnect with
 * the new participant id. Uses the built-in global `WebSocket` (Node ≥ 22).
 * @module @laizhixingxingdeli/dsh-coagenthub/ws-client
 */

/** Default reconnect backoff bounds: first retry after 1s, capped at 30s. */
export const BACKOFF_INITIAL_MS = 1_000
export const BACKOFF_MAX_MS = 30_000

/** One parsed event frame from the server: `type` + payload fields. */
export type WsEventFrame = { type?: string } & Record<string, unknown>

export type WsClientStatus = 'closed' | 'connecting' | 'open' | 'reconnecting'

export interface CoAgentHubWsClientOptions {
  /** API base URL; the WebSocket URL is derived from it (`<apiBase>/ws`). */
  baseURL: string
  /**
   * Re-resolve the API base per (re)connect; overrides `baseURL` when set.
   * Lets a runtime apiBase change (settings panel) take effect without a
   * plugin restart.
   */
  getBaseURL?: () => string
  /** Participant identity; re-read on reconnect so config changes apply. */
  getParticipantId?: () => string | undefined
  /** Initial frame handler (assignable later via the public `onEvent` field). */
  onEvent?: (frame: WsEventFrame) => void
  /** Called on connection status transitions. */
  onStatusChange?: (status: WsClientStatus) => void
  /** WebSocket constructor override (tests). */
  wsImpl?: typeof WebSocket
  /** Backoff bounds override (tests). */
  backoff?: { initialMs: number; maxMs: number }
}

/**
 * Derive the WebSocket URL from the API base: scheme http→ws / https→wss and
 * append `/ws?participantId=<id>` (participant id only when present).
 */
export function buildWsUrl(apiBase: string, participantId?: string): string {
  const base = apiBase.replace(/\/+$/, '')
  const wsBase = base.replace(/^http/, 'ws')
  const url = new URL(`${wsBase}/ws`)
  if (participantId !== undefined && participantId.trim() !== '') {
    url.searchParams.set('participantId', participantId.trim())
  }
  return url.toString()
}

/**
 * Reconnect scheduler + socket owner. Call {@link start} once; the client
 * reconnects forever until {@link stop} (or a fatal constructor failure).
 */
export class CoAgentHubWsClient {
  private readonly options: CoAgentHubWsClientOptions
  private readonly initialBackoffMs: number
  private readonly maxBackoffMs: number
  private socket: WebSocket | null = null
  private retryTimer: ReturnType<typeof setTimeout> | null = null
  private backoffMs: number
  private stopped = false
  private status: WsClientStatus = 'closed'
  /** Participant id the current socket was opened with (identity change probe). */
  private socketParticipantId: string | undefined
  /** Base URL the current socket was opened with (identity change probe). */
  private socketBaseURL: string | undefined

  /** Frame handler; assignable so the task watcher can (re)wire it at runtime. */
  onEvent: ((frame: WsEventFrame) => void) | undefined

  constructor(options: CoAgentHubWsClientOptions) {
    this.options = options
    this.initialBackoffMs = options.backoff?.initialMs ?? BACKOFF_INITIAL_MS
    this.maxBackoffMs = options.backoff?.maxMs ?? BACKOFF_MAX_MS
    this.backoffMs = this.initialBackoffMs
    this.onEvent = options.onEvent
  }

  get currentStatus(): WsClientStatus {
    return this.status
  }

  private setStatus(status: WsClientStatus): void {
    this.status = status
    this.options.onStatusChange?.(status)
  }

  /** Begin connecting (no-op when already connected/connecting or stopped). */
  start(): void {
    if (this.stopped || this.socket !== null) return
    this.connect()
  }

  /** Tear down the socket and cancel pending reconnects. */
  stop(): void {
    this.stopped = true
    if (this.retryTimer !== null) {
      clearTimeout(this.retryTimer)
      this.retryTimer = null
    }
    const socket = this.socket
    this.socket = null
    if (socket !== null) {
      socket.close()
    }
    this.setStatus('closed')
  }

  /**
   * Reconnect when the effective participant id or base URL differs from what
   * the current socket was opened with (settings change while connected).
   * No-op otherwise.
   */
  refreshIdentity(): void {
    const currentId = this.options.getParticipantId?.()
    const currentBase = this.effectiveBaseURL()
    if (currentId === this.socketParticipantId && currentBase === this.socketBaseURL) return
    const socket = this.socket
    if (socket !== null) {
      // 不置空 this.socket:close handler 会以新身份走退避重连。
      socket.close()
    }
  }

  private effectiveBaseURL(): string {
    const live = this.options.getBaseURL?.()
    const base = live !== undefined && live.trim() !== '' ? live : this.options.baseURL
    return base.replace(/\/+$/, '')
  }

  private connect(): void {
    if (this.stopped) return
    this.setStatus('connecting')
    const participantId = this.options.getParticipantId?.()
    this.socketParticipantId = participantId
    const baseURL = this.effectiveBaseURL()
    this.socketBaseURL = baseURL
    const Ws = this.options.wsImpl ?? WebSocket
    let socket: WebSocket
    try {
      // buildWsUrl 内 new URL 对非法 apiBase 会同步抛错;与构造失败同等按退避重试。
      const url = buildWsUrl(baseURL, participantId)
      socket = new Ws(url)
    } catch {
      this.scheduleReconnect()
      return
    }
    this.socket = socket
    socket.addEventListener('open', () => {
      if (this.socket !== socket || this.stopped) return
      this.backoffMs = this.initialBackoffMs
      this.setStatus('open')
    })
    socket.addEventListener('message', (event: MessageEvent) => {
      if (this.socket !== socket || this.stopped) return
      if (typeof event.data !== 'string') return
      let frame: WsEventFrame
      try {
        const parsed: unknown = JSON.parse(event.data)
        if (parsed === null || typeof parsed !== 'object') return
        frame = parsed as WsEventFrame
      } catch {
        return // 非 JSON 帧(心跳等):忽略。
      }
      this.onEvent?.(frame)
    })
    socket.addEventListener('error', () => {
      // 错误后必有 close;统一走 close 分支重连。
    })
    socket.addEventListener('close', () => {
      if (this.socket !== socket) return // 已被 stop/refreshIdentity 接管
      this.socket = null
      if (this.stopped) return
      this.setStatus('reconnecting')
      this.scheduleReconnect()
    })
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.retryTimer !== null) return
    const delay = this.backoffMs
    this.backoffMs = Math.min(this.maxBackoffMs, this.backoffMs * 2)
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null
      this.connect()
    }, delay)
  }
}
