// A stand-in for `claude` in claude-code-backend.test.ts. It checks the arguments the backend must pass, reads the
// prompt from stdin, writes { argv, pid, cwd, config, stdin, systemPrompt } to $FAKE_CLAUDE_ARGV, then replays
// $FAKE_CLAUDE_FIXTURE to stdout line by line.
// FAKE_CLAUDE_HANG=1 keeps it running until it is killed. FAKE_CLAUDE_EXIT=<n> exits with n after replaying.
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

function check(config) {
  if (!argv.includes('-p')) return fail('missing -p')
  if (!argv.includes('--strict-mcp-config')) return fail('missing --strict-mcp-config')
  if (valueOf('--allowedTools') !== 'mcp__webtoon__*') return fail('missing --allowedTools mcp__webtoon__*')
  if (!valueOf('--mcp-config')) return fail('missing --mcp-config')
  if (config === null) return fail('cannot read --mcp-config')
  const headers = config?.mcpServers?.webtoon?.headers ?? {}
  if (!/^Bearer .+/.test(headers.Authorization ?? '')) return fail('no bearer header in --mcp-config')
  if (!headers['X-Webtoon-Session']) return fail('no X-Webtoon-Session header in --mcp-config')
  return true
}

let stdin = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', (chunk) => {
  stdin += chunk
})
process.stdin.on('end', () => {
  const config = readOr(valueOf('--mcp-config'), JSON.parse, null)
  const systemPrompt = readOr(valueOf('--append-system-prompt-file'), (text) => text, null)
  if (process.env.FAKE_CLAUDE_ARGV) {
    fs.writeFileSync(process.env.FAKE_CLAUDE_ARGV, JSON.stringify({ argv, pid: process.pid, cwd: process.cwd(), config, stdin, systemPrompt }))
  }
  if (check(config) !== true) return
  if (process.env.FAKE_CLAUDE_STDERR) process.stderr.write(process.env.FAKE_CLAUDE_STDERR)
  if (process.env.FAKE_CLAUDE_FIXTURE) {
    for (const line of fs.readFileSync(process.env.FAKE_CLAUDE_FIXTURE, 'utf8').split('\n')) {
      if (line.trim()) process.stdout.write(`${line}\n`)
    }
  }
  if (process.env.FAKE_CLAUDE_HANG === '1') setInterval(() => {}, 60_000)
  else if (process.env.FAKE_CLAUDE_EXIT) process.exitCode = Number(process.env.FAKE_CLAUDE_EXIT)
})
