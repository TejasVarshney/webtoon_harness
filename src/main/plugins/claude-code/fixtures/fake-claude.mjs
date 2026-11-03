// A stand-in for `claude` in claude-code-backend.test.ts. It checks the arguments the backend must pass, reads the
// prompt from stdin, writes { argv, pid, cwd, config, stdin, env, mcp } to $FAKE_CLAUDE_ARGV, then replays
// $FAKE_CLAUDE_FIXTURE to stdout line by line.
// FAKE_CLAUDE_HANG=1 keeps it running until it is killed. FAKE_CLAUDE_EXIT=<n> exits with n after replaying.
// FAKE_CLAUDE_MCP_CALLS=<JSON [{ name, arguments }]> first talks MCP to the server in --mcp-config, as Claude Code
// does: initialize, then one tools/call per entry, with that config's headers. `mcp` records what came back.
import fs from 'node:fs'

const argv = process.argv.slice(2)

function fail(message) {
  process.stderr.write(`fake-claude: ${message}\n`)
  process.exitCode = 3
}

function valueOf(flag) {
  const i = argv.indexOf(flag)
  return i === -1 ? undefined : argv[i + 1]
}

function readOr(file, parse, fallback) {
  try {
    return parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return fallback
  }
}

function check(config, stdin) {
  if (!argv.includes('-p')) return fail('missing -p')
  if (!argv.includes('--strict-mcp-config')) return fail('missing --strict-mcp-config')
  if (valueOf('--allowedTools') !== 'mcp__webtoon__*') return fail('missing --allowedTools mcp__webtoon__*')
  if (argv.some((a) => a.startsWith('--append-system-prompt'))) return fail('the snapshot must go on stdin, not in the system prompt')
  if (!valueOf('--mcp-config')) return fail('missing --mcp-config')
  if (config === null) return fail('cannot read --mcp-config')
  const headers = config?.mcpServers?.webtoon?.headers ?? {}
  if (!/^Bearer .+/.test(headers.Authorization ?? '')) return fail('no bearer header in --mcp-config')
  if (!headers['X-Webtoon-Session']) return fail('no X-Webtoon-Session header in --mcp-config')
  if (!headers['X-Webtoon-Project']) return fail('no X-Webtoon-Project header in --mcp-config')
  if (!('X-Webtoon-Episode' in headers)) return fail('no X-Webtoon-Episode header in --mcp-config')
  if (!stdin.startsWith('<project_state>')) return fail('stdin does not start with the <project_state> snapshot')
  return true
}

/** The JSON-RPC message with `id` in a JSON or SSE response body. */
function messageOf(contentType, text, id) {
  if (!contentType.includes('text/event-stream')) return JSON.parse(text)
  for (const line of text.split(/\r?\n/)) {
    if (!line.startsWith('data:')) continue
    const message = JSON.parse(line.slice('data:'.length))
    if (message.id === id) return message
  }
  throw new Error(`no response with id ${id} in the event stream`)
}

/** initialize, notifications/initialized, then each tools/call; the session is ended with DELETE. */
async function talkMcp(server, calls) {
  const base = { ...server.headers, 'content-type': 'application/json', accept: 'application/json, text/event-stream' }
  const init = await fetch(server.url, {
    method: 'POST',
    headers: base,
    body: JSON.stringify({ jsonrpc: '2.0', id: 0, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'fake-claude', version: '1.0.0' } } })
  })
  const initialized = messageOf(init.headers.get('content-type') ?? '', await init.text(), 0)
  const headers = { ...base, 'mcp-session-id': init.headers.get('mcp-session-id'), 'mcp-protocol-version': initialized.result.protocolVersion }
  await fetch(server.url, { method: 'POST', headers, body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) })
  const results = []
  for (const [i, call] of calls.entries()) {
    const id = i + 1
    const res = await fetch(server.url, { method: 'POST', headers, body: JSON.stringify({ jsonrpc: '2.0', id, method: 'tools/call', params: call }) })
    results.push(messageOf(res.headers.get('content-type') ?? '', await res.text(), id).result)
  }
  await fetch(server.url, { method: 'DELETE', headers })
  return { instructions: initialized.result.instructions ?? null, results }
}

let stdin = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', (chunk) => {
  stdin += chunk
})
process.stdin.on('end', async () => {
  const config = readOr(valueOf('--mcp-config'), JSON.parse, null)
  let mcp = null
  if (process.env.FAKE_CLAUDE_MCP_CALLS && config) {
    try {
      mcp = await talkMcp(config.mcpServers.webtoon, JSON.parse(process.env.FAKE_CLAUDE_MCP_CALLS))
    } catch (error) {
      mcp = { error: String(error) }
    }
  }
  if (process.env.FAKE_CLAUDE_ARGV) {
    const env = { MCP_TOOL_TIMEOUT: process.env.MCP_TOOL_TIMEOUT ?? null }
    fs.writeFileSync(process.env.FAKE_CLAUDE_ARGV, JSON.stringify({ argv, pid: process.pid, cwd: process.cwd(), config, stdin, env, mcp }))
  }
  if (check(config, stdin) !== true) return
  if (process.env.FAKE_CLAUDE_STDERR) process.stderr.write(process.env.FAKE_CLAUDE_STDERR)
  if (process.env.FAKE_CLAUDE_FIXTURE) {
    for (const line of fs.readFileSync(process.env.FAKE_CLAUDE_FIXTURE, 'utf8').split('\n')) {
      if (line.trim()) process.stdout.write(`${line}\n`)
    }
  }
  if (process.env.FAKE_CLAUDE_HANG === '1') setInterval(() => {}, 60_000)
  else if (process.env.FAKE_CLAUDE_EXIT) process.exitCode = Number(process.env.FAKE_CLAUDE_EXIT)
})
