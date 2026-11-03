import http from 'node:http'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { defineTool, ToolRegistry } from '../../agent/tools/registry'
import { EntityNotFoundError } from '../../domain/errors'
import type { ProjectContext } from '../../storage/project-store'
import { testServices, type TestServices } from '../../test/test-services'
import { McpLinkServer, PortInUseError } from './mcp-server'
import { McpToolAdapter, NO_PROJECT } from './mcp-tools'
import { DriverSessionLog } from './session-log'

const TOKEN = 'test-token-0123456789abcdefghijklmnopqrstu'
const INITIALIZE = {
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'raw', version: '1.0.0' } }
}

let s: TestServices | undefined
let servers: McpLinkServer[] = []
let clients: Client[] = []

afterEach(async () => {
  vi.restoreAllMocks()
  for (const client of clients) await client.close().catch(() => {})
  for (const server of servers) await server.close()
  await s?.cleanup()
  s = undefined
  servers = []
  clients = []
})

interface Setup {
  s: TestServices
  ctx: ProjectContext
  adapter: McpToolAdapter
  log: DriverSessionLog
  server: McpLinkServer
  port: number
}

async function setup(opts: { registry?: ToolRegistry; progressIntervalMs?: number; noProject?: boolean; token?: () => string } = {}): Promise<Setup> {
  s = await testServices()
  const ctx = await s.projects.create({ title: 'Moon Diary' })
  if (!opts.noProject) s.activeContext.set({ projectId: ctx.id, episodeId: null })
  const adapter = new McpToolAdapter({ services: s, activeContext: s.activeContext, ...(opts.registry ? { registry: opts.registry } : {}) })
  const log = new DriverSessionLog({ sessions: s.sessions, bus: s.bus })
  const server = new McpLinkServer({
    adapter,
    log,
    token: opts.token ?? (() => TOKEN),
    ...(opts.progressIntervalMs ? { progressIntervalMs: opts.progressIntervalMs } : {})
  })
  servers.push(server)
  await server.listen(0)
  return { s, ctx, adapter, log, server, port: server.port! }
}

async function connect(port: number, headers: Record<string, string> = {}): Promise<Client> {
  const client = new Client({ name: 'test', version: '1.0.0' })
  const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`), {
    requestInit: { headers: { Authorization: `Bearer ${TOKEN}`, ...headers } }
  })
  clients.push(client)
  await client.connect(transport)
  return client
}

/** A plain HTTP request, so Host and the body can be anything. */
function raw(
  port: number,
  opts: { method?: string; path?: string; headers?: Record<string, string>; body?: string } = {}
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        method: opts.method ?? 'POST',
        path: opts.path ?? '/mcp',
        headers: {
          host: `127.0.0.1:${port}`,
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
          authorization: `Bearer ${TOKEN}`,
          ...opts.headers
        }
      },
      (res) => {
        let body = ''
        res.setEncoding('utf8')
        res.on('data', (chunk: string) => (body += chunk))
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body }))
      }
    )
    req.on('error', reject)
    req.end(opts.body ?? JSON.stringify(INITIALIZE))
  })
}

/** A tool that runs until its signal aborts or the test releases it. */
function slowTool() {
  let release = () => {}
  let onStart: (signal: AbortSignal) => void = () => {}
  const started = new Promise<AbortSignal>((resolve) => (onStart = resolve))
  const released = new Promise<void>((resolve) => (release = resolve))
  const tool = defineTool({
    name: 'slow',
    description: 'stub',
    input: z.object({}),
    handler: async (_input, ctx) => {
      onStart(ctx.signal)
      await Promise.race([released, new Promise((resolve) => ctx.signal.addEventListener('abort', resolve, { once: true }))])
      return { content: ctx.signal.aborted ? 'aborted' : 'finished' }
    }
  })
  return { registry: new ToolRegistry([tool]), started, release }
}

const textOf = (result: object): string => {
  const first = (result as { content: { type: string; text?: string }[] }).content[0]
  return first.type === 'text' ? (first.text ?? '') : ''
}

describe('McpLinkServer', () => {
  describe('auth and the DNS-rebinding guard', () => {
    it('rejects a request without a token with an empty 401', async () => {
      const { port } = await setup()
      expect(await raw(port, { headers: { authorization: '' } })).toEqual({ status: 401, body: '' })
    })

    it('rejects a wrong token of the same and of another length', async () => {
      const { port } = await setup()
      const sameLength = TOKEN.replace(/.$/, 'X')
      expect((await raw(port, { headers: { authorization: `Bearer ${sameLength}` } })).status).toBe(401)
      expect((await raw(port, { headers: { authorization: 'Bearer short' } })).status).toBe(401)
      expect((await raw(port, { headers: { authorization: TOKEN } })).status).toBe(401)
    })

    it('rejects everything while the token is empty', async () => {
      const { port } = await setup({ token: () => '' })
      expect((await raw(port, { headers: { authorization: 'Bearer ' } })).status).toBe(401)
    })

    it('a client with the wrong token cannot connect', async () => {
      const { port } = await setup()
      const client = new Client({ name: 'test', version: '1.0.0' })
      clients.push(client)
      const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`), {
        requestInit: { headers: { Authorization: 'Bearer nope' } }
      })
      await expect(client.connect(transport)).rejects.toThrow()
    })

    it('rejects a foreign Host with 403 even with the right token', async () => {
      const { port } = await setup()
      expect((await raw(port, { headers: { host: 'evil.test' } })).status).toBe(403)
      expect((await raw(port, { headers: { host: `evil.test:${port}` } })).status).toBe(403)
      expect((await raw(port, { headers: { host: '127.0.0.1:1' } })).status).toBe(403)
    })

    it('rejects a foreign Origin with 403 and accepts the local ones', async () => {
      const { port } = await setup()
      expect((await raw(port, { headers: { origin: 'http://evil.test' } })).status).toBe(403)
      expect((await raw(port, { headers: { origin: `http://evil.test:${port}` } })).status).toBe(403)
      expect((await raw(port, { headers: { origin: `http://127.0.0.1:${port}` } })).status).toBe(200)
      expect((await raw(port, { headers: { host: `localhost:${port}`, origin: `http://localhost:${port}` } })).status).toBe(200)
    })

    it('answers 404 outside /mcp', async () => {
      const { port } = await setup()
      expect((await raw(port, { path: '/other' })).status).toBe(404)
    })
  })

  describe('requests', () => {
    it('answers a malformed body with a 400 parse error and keeps serving', async () => {
      const { port, adapter } = await setup()
      const res = await raw(port, { body: '{not json' })
      expect(res.status).toBe(400)
      expect(JSON.parse(res.body)).toEqual({ jsonrpc: '2.0', error: { code: -32700, message: 'Parse error' }, id: null })
      const client = await connect(port)
      expect((await client.listTools()).tools.map((t) => t.name)).toEqual(adapter.listTools().map((t) => t.name))
    })

    it('answers a body over 4 MB with 413', async () => {
      const { port } = await setup()
      const res = await raw(port, { body: JSON.stringify({ ...INITIALIZE, pad: 'x'.repeat(4 * 1024 * 1024) }) })
      expect(res.status).toBe(413)
    })

    it('needs an initialize request to start a session', async () => {
      const { port } = await setup()
      const res = await raw(port, { body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }) })
      expect(res.status).toBe(400)
      expect((await raw(port, { method: 'GET', body: '' })).status).toBe(400)
    })

    it('answers an unknown session id with 404', async () => {
      const { port } = await setup()
      const res = await raw(port, {
        headers: { 'mcp-session-id': 'nope' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} })
      })
      expect(res.status).toBe(404)
    })
  })

  describe('tools', () => {
    it('lists the adapter tools with their schemas unchanged', async () => {
      const { port, adapter } = await setup()
      const client = await connect(port)
      const { tools } = await client.listTools()
      expect(tools.map(({ name, description, inputSchema }) => ({ name, description, inputSchema }))).toEqual(adapter.listTools())
    })

    it('sends the adapter instructions at initialize', async () => {
      const { port, adapter, ctx } = await setup()
      const client = await connect(port)
      expect(client.getInstructions()).toBe(await adapter.instructions(ctx))
    })

    it('connects with the connection paragraph alone when AGENTS.md cannot be read', async () => {
      const { port, adapter, s } = await setup()
      // Opening a project reinstalls missing docs, so the read itself is made to fail as a missing file does.
      const missing = new EntityNotFoundError('doc', 'AGENTS')
      vi.spyOn(s.docs, 'agentsMd').mockRejectedValue(missing)
      const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
      const client = await connect(port)
      expect(client.getInstructions()).toBe(await adapter.instructions(null))
      expect(logged).toHaveBeenCalledWith('MCP link: the project instructions could not be built', missing)
      expect((await client.listTools()).tools.length).toBeGreaterThan(0)
    })

    it('logs a request that fails and answers 500', async () => {
      const { port, adapter } = await setup()
      const failure = new Error('boom')
      vi.spyOn(adapter, 'instructions').mockRejectedValue(failure)
      const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
      expect(await raw(port)).toEqual({ status: 500, body: '' })
      expect(logged).toHaveBeenCalledWith('MCP link: request failed', failure)
    })

    it('runs a tool against the active project and logs the call and its result', async () => {
      const { port, s, ctx } = await setup()
      const client = await connect(port)
      const result = await client.callTool({
        name: 'create_character',
        arguments: { name: 'Mina', role: 'protagonist', appearanceLock: 'LOCK', generateBaseImage: false }
      })
      expect(result.isError).toBeFalsy()
      expect(await s.characters.list(ctx)).toHaveLength(1)
      const sessions = await s.sessions.list(ctx)
      expect(sessions).toHaveLength(1)
      expect(sessions[0]).toMatchObject({ title: 'Claude Code', driver: 'claude-code' })
      const messages = await s.sessions.load(ctx, sessions[0].id)
      expect(messages.map((m) => m.role)).toEqual(['assistant', 'tool'])
    })

    it('logs into the session named by X-Webtoon-Session', async () => {
      const { port, s, ctx } = await setup()
      const own = await s.sessions.create(ctx, { title: 'Mine' })
      const client = await connect(port, { 'X-Webtoon-Session': own.id })
      await client.callTool({ name: 'list_characters', arguments: {} })
      expect((await s.sessions.list(ctx)).map((x) => x.id)).toEqual([own.id])
      expect(await s.sessions.load(ctx, own.id)).toHaveLength(2)
    })

    it('returns a failing tool as isError', async () => {
      const { port } = await setup()
      const client = await connect(port)
      const result = await client.callTool({ name: 'create_character', arguments: {} })
      expect(result.isError).toBe(true)
      expect(textOf(result)).toMatch(/^Invalid input for create_character: /)
    })

    it('answers every call with the no-project message and logs nothing when no project is open', async () => {
      const { port, s, ctx } = await setup({ noProject: true })
      const client = await connect(port)
      const result = await client.callTool({ name: 'list_characters', arguments: {} })
      expect(result).toEqual({ content: [{ type: 'text', text: NO_PROJECT }], isError: true })
      expect(await s.sessions.list(ctx)).toEqual([])
    })

    describe('a run that names its project (X-Webtoon-Project)', () => {
      it('acts on and logs into that project, not the one the window shows', async () => {
        const { port, s, ctx } = await setup()
        const run = await s.projects.create({ title: 'Run Project' })
        const own = await s.sessions.create(run, { title: 'Mine' })
        const client = await connect(port, { 'X-Webtoon-Session': own.id, 'X-Webtoon-Project': run.id, 'X-Webtoon-Episode': '' })
        const result = await client.callTool({
          name: 'create_character',
          arguments: { name: 'Mina', role: 'protagonist', appearanceLock: 'LOCK', generateBaseImage: false }
        })
        expect(result.isError).toBeFalsy()
        expect(await s.characters.list(run)).toHaveLength(1)
        expect(await s.characters.list(ctx)).toEqual([])
        expect(await s.sessions.load(run, own.id)).toHaveLength(2)
        expect(await s.sessions.list(ctx)).toEqual([])
        const state = await client.callTool({ name: 'get_project_state', arguments: {} })
        expect(textOf(state)).toContain('Run Project')
        expect(textOf(state)).not.toContain('Moon Diary')
      })

      it('names the episode from X-Webtoon-Episode in get_project_state', async () => {
        const { port, s } = await setup()
        const run = await s.projects.create({ title: 'Run Project' })
        await s.episodes.create(run, { title: 'First Light' })
        const second = await s.episodes.create(run, { title: 'Second Moon' })
        const client = await connect(port, { 'X-Webtoon-Project': run.id, 'X-Webtoon-Episode': second.id })
        const state = textOf(await client.callTool({ name: 'get_project_state', arguments: {} }))
        expect(state).toContain('Second Moon')
        expect(state).not.toContain('First Light')
      })

      it('answers isError, and does not fall back to the window, when that project cannot be opened', async () => {
        const { port, s, ctx } = await setup()
        const client = await connect(port, { 'X-Webtoon-Project': 'prj_0000000000', 'X-Webtoon-Episode': '' })
        const result = await client.callTool({ name: 'list_characters', arguments: {} })
        expect(result.isError).toBe(true)
        expect(textOf(result)).toMatch(/^The project this run belongs to \(prj_0000000000\) could not be opened: /)
        expect(await s.sessions.list(ctx)).toEqual([])
      })
    })

    it('abortCalls aborts the calls logged into a session and ends the MCP sessions that logged there', async () => {
      const slow = slowTool()
      const { port, s, ctx, server, log } = await setup({ registry: slow.registry })
      const own = await s.sessions.create(ctx, { title: 'Mine' })
      const forget = vi.spyOn(log, 'forget')
      const client = await connect(port, { 'X-Webtoon-Session': own.id })
      const mcpSessionId = (client.transport as StreamableHTTPClientTransport).sessionId
      client.callTool({ name: 'slow', arguments: {} }).catch(() => {})
      const signal = await slow.started
      server.abortCalls('ses_0000000000')
      expect(signal.aborted).toBe(false)
      server.abortCalls(own.id)
      expect(signal.aborted).toBe(true)
      expect((signal.reason as Error).message).toBe('The run was stopped')
      await vi.waitFor(() => expect(forget).toHaveBeenCalledWith(mcpSessionId))
      await expect(client.listTools()).rejects.toThrow()
    })

    it('aborts the tool when the client cancels the call', async () => {
      const slow = slowTool()
      const { port } = await setup({ registry: slow.registry })
      const client = await connect(port)
      const controller = new AbortController()
      const call = client.callTool({ name: 'slow', arguments: {} }, undefined, { signal: controller.signal })
      const signal = await slow.started
      expect(signal.aborted).toBe(false)
      const aborted = new Promise((resolve) => signal.addEventListener('abort', resolve, { once: true }))
      controller.abort()
      await expect(call).rejects.toThrow()
      await aborted
      expect(signal.aborted).toBe(true)
    })

    it('sends progress notifications while a call with a progress token runs', async () => {
      const slow = slowTool()
      const { port } = await setup({ registry: slow.registry, progressIntervalMs: 50 })
      const client = await connect(port)
      const seen: { progress: number; message?: string }[] = []
      const result = await client.callTool({ name: 'slow', arguments: {} }, undefined, {
        onprogress: (p) => {
          seen.push({ progress: p.progress, message: p.message })
          if (seen.length === 3) slow.release()
        }
      })
      expect(textOf(result)).toBe('finished')
      expect(seen.length).toBeGreaterThanOrEqual(3)
      for (let i = 1; i < seen.length; i++) expect(seen[i].progress).toBeGreaterThan(seen[i - 1].progress)
      for (const p of seen) expect(p.message).toMatch(/^Working… \d+ s$/)
    })
  })

  describe('lifecycle', () => {
    it('closeSessions ends open sessions and a new client can connect', async () => {
      const { port, log } = await setup()
      const forget = vi.spyOn(log, 'forget')
      const old = await connect(port)
      await old.listTools()
      await servers[0].closeSessions()
      expect(forget).toHaveBeenCalledTimes(1)
      await expect(old.listTools()).rejects.toThrow()
      const fresh = await connect(port)
      expect((await fresh.listTools()).tools.length).toBeGreaterThan(0)
    })

    it('forgets the log session when the client ends the MCP session', async () => {
      const { port, log } = await setup()
      const forget = vi.spyOn(log, 'forget')
      const client = await connect(port)
      const transport = client.transport as StreamableHTTPClientTransport
      const sessionId = transport.sessionId
      await transport.terminateSession()
      expect(forget).toHaveBeenCalledWith(sessionId)
    })

    it('close aborts in-flight calls and resolves', async () => {
      const slow = slowTool()
      const { port, server } = await setup({ registry: slow.registry })
      const client = await connect(port)
      const call = client.callTool({ name: 'slow', arguments: {} })
      call.catch(() => {})
      const signal = await slow.started
      await server.close()
      expect(signal.aborted).toBe(true)
      // The server's own close reason, not only the SDK's abort when the transport closes.
      expect((signal.reason as Error).message).toBe('The MCP link server closed')
      expect(server.port).toBeNull()
    })

    it('rejects listen on a port in use with PortInUseError', async () => {
      const { port, adapter, log } = await setup()
      const second = new McpLinkServer({ adapter, log, token: () => TOKEN })
      servers.push(second)
      const error = await second.listen(port).catch((e: unknown) => e)
      expect(error).toBeInstanceOf(PortInUseError)
      expect((error as PortInUseError).message).toBe(`Port ${port} is in use`)
      expect((error as PortInUseError).port).toBe(port)
      expect(second.port).toBeNull()
    })

    it('can listen again after close', async () => {
      const { server } = await setup()
      await server.close()
      await server.listen(0)
      const client = await connect(server.port!)
      expect((await client.listTools()).tools.length).toBeGreaterThan(0)
    })
  })
})
