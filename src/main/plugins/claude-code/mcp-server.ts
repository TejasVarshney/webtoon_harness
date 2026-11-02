import { randomUUID, timingSafeEqual } from 'node:crypto'
import http from 'node:http'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import type { RequestHandlerExtra } from '@modelcontextprotocol/sdk/shared/protocol.js'
import {
  CallToolRequestSchema,
  isInitializeRequest,
  ListToolsRequestSchema,
  type CallToolResult,
  type ServerNotification,
  type ServerRequest
} from '@modelcontextprotocol/sdk/types.js'
import { NO_PROJECT, type McpToolAdapter } from './mcp-tools'
import type { DriverSessionLog } from './session-log'

const HOST = '127.0.0.1'
const PATH = '/mcp'
const SERVER_INFO = { name: 'webtoon', version: '1.0.0' }
const MAX_BODY_BYTES = 4 * 1024 * 1024
const DEFAULT_PROGRESS_INTERVAL_MS = 15_000

export class PortInUseError extends Error {
  constructor(readonly port: number) {
    super(`Port ${port} is in use`)
    this.name = 'PortInUseError'
  }
}

interface McpSession {
  server: Server
  transport: StreamableHTTPServerTransport
}

type Body = { ok: true; value: unknown } | { ok: false; status: 400 | 413 }
type Extra = RequestHandlerExtra<ServerRequest, ServerNotification>

/** The Host values this server answers to; Origin, when sent, is one of these with `http://`. */
const localHosts = (port: number): string[] => [`127.0.0.1:${port}`, `localhost:${port}`]

const jsonRpcError = (code: number, message: string) => JSON.stringify({ jsonrpc: '2.0', error: { code, message }, id: null })

/**
 * The MCP link (spec §5.1): Streamable HTTP on 127.0.0.1, one SDK `Server` and transport per MCP session.
 * Every request is checked for Host/Origin (DNS rebinding) and the bearer token before the SDK sees it.
 */
export class McpLinkServer {
  private readonly adapter: McpToolAdapter
  private readonly log: DriverSessionLog
  private readonly token: () => string
  private readonly progressIntervalMs: number
  private http: http.Server | null = null
  private boundPort: number | null = null
  /** Aborted by close(), so in-flight tool calls stop with the server. */
  private closing = new AbortController()
  private readonly sessions = new Map<string, McpSession>()

  constructor(opts: { adapter: McpToolAdapter; log: DriverSessionLog; token: () => string; progressIntervalMs?: number }) {
    this.adapter = opts.adapter
    this.log = opts.log
    this.token = opts.token
    this.progressIntervalMs = opts.progressIntervalMs ?? DEFAULT_PROGRESS_INTERVAL_MS
  }

  /** The port bound by the last listen(), null while closed. */
  get port(): number | null {
    return this.boundPort
  }

  /** Rejects with PortInUseError when `port` is taken. */
  async listen(port: number): Promise<void> {
    if (this.http) throw new Error('The MCP link server is already listening')
    const server = http.createServer((req, res) => {
      this.handle(req, res).catch(() => {
        if (!res.headersSent) res.writeHead(500)
        res.end()
      })
    })
    await new Promise<void>((resolve, reject) => {
      // Stays attached: a later 'error' must not go unhandled in the main process (a reject after listening is a no-op).
      server.on('error', (error: NodeJS.ErrnoException) => reject(error.code === 'EADDRINUSE' ? new PortInUseError(port) : error))
      server.listen(port, HOST, () => resolve())
    })
    this.http = server
    this.boundPort = (server.address() as { port: number }).port
    this.closing = new AbortController()
  }

  /** Ends every open MCP session (after a token change); clients must connect again. */
  async closeSessions(): Promise<void> {
    // Each session's `onclose` removes it from the map and forgets its log session.
    await Promise.all([...this.sessions.values()].map((session) => session.server.close()))
  }

  /** Aborts in-flight calls, ends the sessions and closes the socket. */
  async close(): Promise<void> {
    const server = this.http
    if (!server) return
    this.closing.abort()
    await this.closeSessions()
    this.http = null
    this.boundPort = null
    // Clients hold SSE streams open; close() alone would wait for them.
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }

  private async handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const port = this.boundPort
    const closing = this.closing.signal
    if (port === null || closing.aborted) return void res.writeHead(503).end()
    if (new URL(req.url ?? '/', 'http://localhost').pathname !== PATH) return void res.writeHead(404).end()
    if (!this.allowedHost(req, port)) return void this.reply(res, 403, jsonRpcError(-32000, 'Forbidden'))
    if (!this.authorized(req)) return void res.writeHead(401).end()

    let body: unknown
    if (req.method === 'POST') {
      const read = await readBody(req)
      if (!read.ok) {
        const message = read.status === 413 ? 'Request body too large' : 'Parse error'
        return void this.reply(res, read.status, jsonRpcError(read.status === 413 ? -32000 : -32700, message))
      }
      body = read.value
    }

    const sessionId = req.headers['mcp-session-id']
    if (typeof sessionId === 'string') {
      const session = this.sessions.get(sessionId)
      if (!session) return void this.reply(res, 404, jsonRpcError(-32001, 'Session not found'))
      return session.transport.handleRequest(req, res, body)
    }
    if (req.method !== 'POST' || !isInitializeRequest(body)) {
      return void this.reply(res, 400, jsonRpcError(-32000, 'Bad Request: No valid session ID provided'))
    }
    const session = await this.openSession(port, closing)
    if (closing.aborted) {
      // close() ran while the session was being set up: it never reaches the map.
      await session.server.close()
      return void res.writeHead(503).end()
    }
    await session.transport.handleRequest(req, res, body)
  }

  /** Host must name this server; Origin is optional (CLI clients send none) but must match when present. */
  private allowedHost(req: http.IncomingMessage, port: number): boolean {
    const hosts = localHosts(port)
    if (!req.headers.host || !hosts.includes(req.headers.host)) return false
    const origin = req.headers.origin
    return origin === undefined || hosts.some((host) => origin === `http://${host}`)
  }

  private authorized(req: http.IncomingMessage): boolean {
    const header = req.headers.authorization
    const expected = Buffer.from(this.token())
    if (!header?.startsWith('Bearer ') || expected.length === 0) return false
    const given = Buffer.from(header.slice('Bearer '.length))
    // timingSafeEqual needs equal lengths; a length mismatch is a wrong token without comparing.
    return given.length === expected.length && timingSafeEqual(given, expected)
  }

  /** A Server and transport for one MCP session; `closing` is the close signal of the listen() it belongs to. */
  private async openSession(port: number, closing: AbortSignal): Promise<McpSession> {
    const instructions = await this.adapter.instructions(await this.adapter.activeProject())
    const server = new Server(SERVER_INFO, { capabilities: { tools: {} }, instructions })
    const hosts = localHosts(port)
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (id) => void this.sessions.set(id, session),
      // Already checked above; kept on as a second guard.
      enableDnsRebindingProtection: true,
      allowedHosts: hosts,
      allowedOrigins: hosts.map((host) => `http://${host}`)
    })
    const session: McpSession = { server, transport }
    server.setRequestHandler(ListToolsRequestSchema, () => ({ tools: this.adapter.listTools() }))
    server.setRequestHandler(CallToolRequestSchema, (request, extra) =>
      this.callTool(request.params.name, request.params.arguments ?? {}, extra, closing)
    )
    // `server.onclose`, not `transport.onclose`: connect() wraps the transport's handler to abort the session's calls.
    server.onclose = () => {
      const id = transport.sessionId
      if (id === undefined) return
      this.sessions.delete(id)
      this.log.forget(id)
    }
    await server.connect(transport)
    return session
  }

  /** Spec §5.4 order: project, log session, call message, run, result message. With no project nothing is logged. */
  private async callTool(name: string, args: unknown, extra: Extra, closing: AbortSignal): Promise<CallToolResult> {
    const ctx = await this.adapter.activeProject()
    if (!ctx) return { content: [{ type: 'text', text: NO_PROJECT }], isError: true }
    const requested = extra.requestInfo?.headers['x-webtoon-session']
    const call = this.adapter.makeCall(name, args)
    const sessionId = await this.log.resolve(ctx, extra.sessionId ?? '', (Array.isArray(requested) ? requested[0] : requested) ?? null)
    await this.log.recordCall(ctx, sessionId, call)
    const stopProgress = this.startProgress(extra)
    try {
      const signal = AbortSignal.any([extra.signal, closing])
      const { result, toolResult } = await this.adapter.call(ctx, call, { signal, threadKey: sessionId })
      await this.log.recordResult(ctx, sessionId, toolResult)
      return { ...result } // a fresh object: the SDK result type has an index signature
    } finally {
      stopProgress()
    }
  }

  /** With a progress token, a progress notification every interval until the returned stop is called. */
  private startProgress(extra: Extra): () => void {
    const progressToken = extra._meta?.progressToken
    if (progressToken === undefined) return () => {}
    let ticks = 0
    const timer = setInterval(() => {
      ticks += 1
      const progress = (ticks * this.progressIntervalMs) / 1000
      extra
        .sendNotification({ method: 'notifications/progress', params: { progressToken, progress, message: `Working… ${Math.round(progress)} s` } })
        .catch(() => {})
    }, this.progressIntervalMs)
    return () => clearInterval(timer)
  }

  private reply(res: http.ServerResponse, status: number, body: string): void {
    res.writeHead(status, { 'content-type': 'application/json' }).end(body)
  }
}

/** The JSON body, up to MAX_BODY_BYTES. */
function readBody(req: http.IncomingMessage): Promise<Body> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    const onData = (chunk: Buffer) => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        // Drain the rest without keeping it, so the response still reaches the client.
        req.off('data', onData)
        req.resume()
        resolve({ ok: false, status: 413 })
        return
      }
      chunks.push(chunk)
    }
    req.on('data', onData)
    req.on('error', reject)
    req.on('end', () => {
      if (size > MAX_BODY_BYTES) return
      try {
        resolve({ ok: true, value: JSON.parse(Buffer.concat(chunks).toString('utf8')) })
      } catch {
        resolve({ ok: false, status: 400 })
      }
    })
  })
}
