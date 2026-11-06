import { randomBytes } from 'node:crypto'
import type { HarnessPlugin, PluginHost, PluginStatus } from '../types'
import { ClaudeCodeBackend, LINK_OFF, type ClaudeCodeLink } from './claude-code-backend'
import { McpLinkServer } from './mcp-server'
import { McpToolAdapter } from './mcp-tools'
import { DriverSessionLog } from './session-log'

const SECRET_KEY = 'plugin:claude-code'
const DEFAULT_PORT = 7880
const MIN_PORT = 1024
const MAX_PORT = 65535
const HOST = '127.0.0.1'
export { LINK_OFF }
const PORT_RANGE = `Port must be between ${MIN_PORT} and ${MAX_PORT}`

type LinkServerOptions = ConstructorParameters<typeof McpLinkServer>[0]

export interface ClaudeCodePlugin extends HarnessPlugin, ClaudeCodeLink {
  /** The `claude mcp add` line for the running link. Throws while the plugin is off. */
  connectCommand(): string
  /** Replaces the token and ends every open MCP session. Throws while the plugin is off. */
  regenerateToken(): Promise<void>
  /** The MCP endpoint while the server is listening, else null. */
  linkUrl(): string | null
  /** The current bearer token; '' before the first start. */
  token(): string
  /** The host's config as of now; `{}` before the first start. */
  config(): Record<string, unknown>
}

const newToken = (): string => randomBytes(32).toString('base64url')

function checkPort(port: unknown): number {
  if (typeof port !== 'number' || !Number.isInteger(port) || port < MIN_PORT || port > MAX_PORT) throw new Error(PORT_RANGE)
  return port
}

const readPort = (config: Record<string, unknown>): number => (config.port === undefined ? DEFAULT_PORT : checkPort(config.port))

/**
 * The `claude-code` plugin: an MCP link on 127.0.0.1 that lets Claude Code drive the open project.
 * `serverFactory` swaps the server in tests.
 */
export function createClaudeCodePlugin(opts: { serverFactory?: (options: LinkServerOptions) => McpLinkServer } = {}): ClaudeCodePlugin {
  const serverFactory = opts.serverFactory ?? ((options) => new McpLinkServer(options))
  let host: PluginHost | null = null
  /** True between start() and stop(), whether or not the port could be bound. */
  let started = false
  let server: McpLinkServer | null = null
  let log: DriverSessionLog | null = null
  let port = DEFAULT_PORT
  let token = ''
  let failure: string | null = null
  /** Created on the first start (it needs the services) and kept, so the plugin manager always sees the same one. */
  let backend: ClaudeCodeBackend | undefined

  const status = (): PluginStatus => {
    if (!started) return { state: 'off', message: 'Off' }
    const logError = log?.lastError()
    const suffix = logError ? ` · session log: ${logError}` : ''
    if (failure !== null) return { state: 'error', message: failure + suffix }
    return { state: 'running', message: `Listening on ${HOST}:${port}${suffix}` }
  }

  const link: ClaudeCodeLink = {
    linkUrl: () => (server?.port != null ? `http://${HOST}:${server.port}/mcp` : null),
    token: () => token,
    config: () => host?.config() ?? {},
    status,
    abortCalls: (sessionId) => server?.abortCalls(sessionId)
  }

  const requireStarted = (): PluginHost => {
    if (!started || !host) throw new Error(LINK_OFF)
    return host
  }

  return {
    id: 'claude-code',
    name: 'Claude Code',
    description: 'Lets Claude Code drive this app through an MCP link, and (optionally) act as the agent.',

    /** Runs the main chat when the config has `useAsAgent`. */
    get agentBackend() {
      return backend
    },

    async start(h) {
      host = h
      started = true
      failure = null
      backend ??= new ClaudeCodeBackend({ services: h.services, plugin: link })
      try {
        // The token first: a bad stored port must not leave the connect command without one.
        const stored = h.secrets.get(SECRET_KEY)
        if (stored !== null) {
          token = stored
        } else {
          const created = newToken()
          await h.secrets.set(SECRET_KEY, created)
          token = created
        }
        port = readPort(h.config())
        log = new DriverSessionLog({ sessions: h.services.sessions, bus: h.bus })
        const adapter = new McpToolAdapter({ services: h.services, activeContext: h.activeContext() })
        const link = serverFactory({ adapter, log, token: () => token })
        await link.listen(port)
        server = link
      } catch (error) {
        failure = error instanceof Error ? error.message : String(error)
      }
    },

    async stop() {
      const closing = server
      server = null
      started = false
      failure = null
      log = null
      await Promise.all([backend?.stopAll(), closing?.close()])
    },

    validateConfig(patch) {
      if ('port' in patch) checkPort(patch.port)
      if ('useAsAgent' in patch && typeof patch.useAsAgent !== 'boolean') throw new Error('useAsAgent must be true or false')
      if ('claudePath' in patch && typeof patch.claudePath !== 'string') throw new Error('claudePath must be text')
    },

    /** Only the port needs the server rebound; the agent settings are read at run time. */
    restartOnConfig: (patch) => 'port' in patch,

    connectCommand() {
      requireStarted()
      if (token === '') throw new Error(`The Claude Code link failed to start: ${status().message}`)
      return `claude mcp add --transport http webtoon http://${HOST}:${port}/mcp --header "Authorization: Bearer ${token}"`
    },

    async regenerateToken() {
      const h = requireStarted()
      const created = newToken()
      await h.secrets.set(SECRET_KEY, created)
      token = created
      await server?.closeSessions()
    },

    ...link
  }
}
