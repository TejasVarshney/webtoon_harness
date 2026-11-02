# Claude Code Plugin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let Claude Code be the harness's story agent — through an MCP link inside the app, as a built-in harness plugin that can launch Claude Code itself, and as a Claude Code plugin that drives the harness.

**Architecture:** A small built-in plugin system (`src/main/plugins/`) owns plugins with start/stop hooks and per-plugin config in `<userData>/plugins.json`. The first plugin, `claude-code`, runs an MCP server (low-level `Server` from `@modelcontextprotocol/sdk` over Streamable HTTP on 127.0.0.1) that exposes the existing `ToolRegistry` unchanged, logs every call into a chat session, and (phase 2) offers an `AgentBackend` that spawns `claude -p` against that same link. Phase 3 is static files in `integrations/`.

**Tech Stack:** Electron 45 main process, TypeScript 7, zod 4, `@modelcontextprotocol/sdk` ^1.32, React 19 + zustand, vitest, Playwright `_electron`.

**Spec:** `docs/superpowers/specs/2026-11-02-claude-code-plugin-design.md`

## Global Constraints

- Branch `feat/claude-code-plugin` (off `feat/item-maker`). Commit after every task; messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Built-in plugins only; nothing is loaded from outside the app.
- MCP server: host `127.0.0.1`, path `/mcp`, default port `7880`, allowed range `1024–65535`, server name `webtoon`.
- Token: 32 random bytes, base64url; stored in `SecretStore` under key `plugin:claude-code`; compared with `crypto.timingSafeEqual`; 401 when missing or wrong; 403 when Host/Origin is not `127.0.0.1:<port>` or `localhost:<port>`.
- Progress notification every 15 s while a call with a progress token runs. Plugin `stop()` is awaited with a 5 s cap each at quit.
- Exact copy: "Open a project in the Webtoon AI Harness window first." · "Port <port> is in use" · "Listening on 127.0.0.1:<port>" · session title "Claude Code" · banner "Driven by Claude Code" · "Claude Code was not found. Set its path in Settings → Plugins." · "Turn on the Claude Code plugin's link first."
- Connect command: `claude mcp add --transport http webtoon http://127.0.0.1:<port>/mcp --header "Authorization: Bearer <token>"`.
- Phase-2 tools allow-list: `mcp__webtoon__*`; Claude Code gets no built-in tools (no shell, files or web).
- Header that routes logging to a session: `X-Webtoon-Session: <ses_id>`.
- Follow existing patterns: handler maps per IPC area, `parseInput` for IPC validation, channels added to `IpcContract` **and** `channelSet` in `src/shared/ipc.ts`, colocated `*.test.ts`, test commands `npx vitest run <file>`, `npm run typecheck`.

## Review Focus

1. **App quit or plugin off during a long `create_panel` over MCP** — the running handler's signal must abort and the server must close; the panel then recovers through the existing `recoverInterrupted`. Test in Task 6 (`stop() aborts in-flight calls`).
2. **The user switches project between two MCP calls** — the next call acts on the new project and logs into a new "Claude Code" session there. Test in Task 5 (`new project → new log session`).
3. **Two MCP clients at once** (an outside Claude Code and a phase-2 run) — each logs into its own session, never interleaved. Test in Task 5 (`two MCP sessions log separately`).
4. **Bad requests** — a non-JSON or oversized body (> 4 MB) gets a 400 and the server keeps serving. Test in Task 6 (`malformed body → 400, server still up`).
5. **Claude Code's stdout split mid-line or mid-UTF-8 character** — the stream parser must buffer until newline and decode as UTF-8. Test in Task 10 (`chunk boundaries`).

---

## Phase 1 — plugin system and MCP link

### Task 1: Shared project-state gathering and `secrets` on Services

**Files:**
- Create: `src/main/agent/project-state.ts`, `src/main/agent/project-state.test.ts`
- Modify: `src/main/agent/agent-runner.ts:89-102` (use the new function), `src/main/services.ts` (add `secrets: SecretStore` to `Services` and the returned object)

**Interfaces:**
- Produces: `gatherProjectState(services: Services, ctx: ProjectContext, activeEpisodeId: string | null): Promise<StateSnapshotInput>` (moved body of `AgentRunner.gatherState`, same semantics, `RECENT_PANELS = 3`); `projectStateText(services, ctx, activeEpisodeId): Promise<string>` = `buildStateSnapshot(await gatherProjectState(...))`; `Services.secrets`.

- [ ] **Step 1: Write failing tests** in `project-state.test.ts` using the existing test-services helper (see `src/main/test/`): `projectStateText` on a project with one character and two episodes returns text containing `<project_state>`, the character's name and the first episode as current when `activeEpisodeId` is null or unknown, and the named episode when it exists.
- [ ] **Step 2: Run** `npx vitest run src/main/agent/project-state.test.ts` — FAIL (module missing).
- [ ] **Step 3: Implement**; make `AgentRunner` call `gatherProjectState` (delete its own method); add `secrets` to `Services`.
- [ ] **Step 4: Run** `npx vitest run src/main/agent` and `npm run typecheck` — PASS.
- [ ] **Step 5: Commit** `refactor: share project-state gathering and expose secrets on services`.

### Task 2: Session `driver` field

**Files:**
- Modify: `src/main/sessions/session-store.ts` (MetaRecord gains `driver: z.enum(['claude-code']).nullable().optional()`; `summarize` copies it as `driver: meta.driver ?? null`; `create(ctx, opts?: { title?: string; driver?: 'claude-code' | null })`), `src/shared/types.ts:96` (`SessionSummary.driver: 'claude-code' | null`), `src/main/sessions/session-store.test.ts`

**Interfaces:**
- Produces: `SessionStore.create(ctx, { title: 'Claude Code', driver: 'claude-code' })`; `SessionSummary.driver`.

- [ ] **Step 1: Failing tests**: `create(ctx, { title: 'Claude Code', driver: 'claude-code' })` → `list()` shows that title and `driver: 'claude-code'`; a session file written by the old code (meta without `driver`) lists with `driver: null`; `create(ctx)` still titles "New session" with `driver: null`.
- [ ] **Step 2: Run** `npx vitest run src/main/sessions` — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npx vitest run src/main/sessions` and `npm run typecheck` — PASS (fix renderer type errors from the new required field by passing it through).
- [ ] **Step 5: Commit** `feat: sessions can record which driver writes them`.

### Task 3: Plugin manager, active context and their IPC

**Files:**
- Create: `src/main/plugins/types.ts`, `src/main/plugins/plugin-manager.ts`, `src/main/plugins/plugin-manager.test.ts`, `src/main/plugins/active-context.ts`, `src/main/ipc/handlers/plugins.ts`, `src/main/ipc/handlers/plugins.test.ts`
- Modify: `src/shared/ipc.ts` (contract + `channelSet`), `src/shared/types.ts` (`AppEvent` gains `{ type: 'plugins.changed' }`; `PluginView`), `src/main/services.ts` (`activeContext`, `plugins`), `src/main/ipc/register.ts`, `src/main/index.ts` (start enabled plugins after `registerIpc`; on `before-quit` call `services.plugins.stopAll()`)

**Interfaces:**
- Produces (types.ts): `HarnessPlugin`, `PluginHost`, `PluginStatus` exactly as spec §4.1; `AgentBackend` (spec §6.1) declared now so the type is stable.
- Produces: `class ActiveContext { get(): { projectId: string | null; episodeId: string | null }; set(v): void }`.
- Produces: `class PluginManager { constructor(opts: { file: string; plugins: HarnessPlugin[]; services: Services; activeContext: ActiveContext }); load(): Promise<void>; startEnabled(): Promise<void>; list(): PluginView[]; setEnabled(id: string, enabled: boolean): Promise<PluginView>; setConfig(id: string, patch: Record<string, unknown>): Promise<PluginView>; get(id: string): HarnessPlugin | undefined; isEnabled(id: string): boolean; stopAll(): Promise<void>; agentBackend(): AgentBackend | null }` — `agentBackend()` returns the backend of an enabled plugin whose config has `useAsAgent: true`.
- Produces: `PluginView = { id; name; description; enabled: boolean; status: PluginStatus; config: Record<string, unknown> }`.
- Produces IPC: `plugins:list`, `plugins:setEnabled`, `plugins:setConfig` (spec §4.2) and `app:setActiveContext { projectId: string | null; episodeId: string | null } → void`.
- `Services.plugins` is built in `createServices` with `plugins: builtinPlugins()` from `src/main/plugins/index.ts` (empty array in this task; Task 7 adds the Claude Code plugin).

- [ ] **Step 1: Failing tests** (`plugin-manager.test.ts`, with a fake plugin recording calls): enabled-at-load plugins get `start` once from `startEnabled`; `setEnabled(id, false)` calls `stop` and persists `{"plugins":{"<id>":{"enabled":false,"config":{}}}}`; `setConfig` on a running plugin calls `stop` then `start`; a corrupt `plugins.json` → `list()` all disabled, the file is left byte-identical, and the error is returned by `loadError()`; unknown ids in the file survive a save; `stopAll()` resolves even when a plugin's `stop` hangs (fake timers, 5 s cap); every change emits `plugins.changed`; `agentBackend()` is null unless enabled and `config.useAsAgent === true`; a `start` that throws does not throw out of `setEnabled` (status shows `error`).
- [ ] **Step 2: Failing tests** (`plugins.test.ts`): handlers validate input (`plugins:setEnabled` with a non-boolean → readable error), `app:setActiveContext` updates `services.activeContext.get()`.
- [ ] **Step 3: Run** `npx vitest run src/main/plugins src/main/ipc` — FAIL.
- [ ] **Step 4: Implement.** `plugins.json` schema: `z.object({ plugins: z.record(z.string(), z.object({ enabled: z.boolean(), config: z.record(z.string(), z.unknown()).default({}) })) })`; write with `writeJsonAtomic` under `mutex`.
- [ ] **Step 5: Run** `npx vitest run` (the register test proves every contract channel has a handler) and `npm run typecheck` — PASS.
- [ ] **Step 6: Commit** `feat: built-in plugin manager and active window context`.

### Task 4: MCP tool adapter

**Files:**
- Create: `src/main/plugins/claude-code/mcp-tools.ts`, `src/main/plugins/claude-code/mcp-tools.test.ts`

**Interfaces:**
- Consumes: `buildAgentTools`, `ToolRegistry.specs()/execute()`, `projectStateText` (Task 1), `loadImageForTextModel`, `ActiveContext` (Task 3).
- Produces:
  ```ts
  type McpContent = { type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string }
  interface McpCallResult { content: McpContent[]; isError?: boolean }
  interface McpToolCallInput { name: string; args: unknown; signal: AbortSignal; threadKey: string }
  class McpToolAdapter {
    constructor(opts: { services: Services; activeContext: ActiveContext })
    listTools(): { name: string; description: string; inputSchema: Record<string, unknown> }[]
    /** Resolves the active project or null. */
    activeProject(): Promise<ProjectContext | null>
    call(ctx: ProjectContext, input: McpToolCallInput): Promise<{ result: McpCallResult; toolResult: ToolResult; toolCall: ToolCall }>
    instructions(ctx: ProjectContext | null): Promise<string>
  }
  export const NO_PROJECT = 'Open a project in the Webtoon AI Harness window first.'
  ```
  `listTools()` = `buildAgentTools({ vision: true }).specs()` plus `get_project_state` (`{ type: 'object', properties: {} }`, description "The current <project_state> snapshot: project, story mode, style, characters, items, current episode and its last panels. Call it before planning or drawing."). `call` builds a `ToolCall` with `id: newId('call')`, runs `execute` (or `projectStateText` for `get_project_state`), and maps `ok:false` → `isError: true`; images → image content after the text. `instructions(ctx)` = `buildAgentSystemPrompt(agentsMd, docList)` + the spec §5.3 paragraph (exact text), or that paragraph alone when ctx is null.

- [ ] **Step 1: Failing tests:** `listTools()` names equal `buildAgentTools({vision:true}).names()` plus `get_project_state`, and each `inputSchema` deep-equals the registry spec; `call(create_character)` creates the character on disk; an invalid input returns `isError: true` with the registry's "Invalid input for create_character: …" text; a tool returning `images: ['characters/…png']` yields an `image` item with `mimeType: 'image/jpeg'` (identity image ops in tests return the input mime — assert it equals what `loadImageForTextModel` returns); `get_project_state` returns text starting with `<project_state>`; an aborted `signal` reaches the handler (`ctx.signal.aborted` seen by a stub tool via a test registry seam: constructor option `registry?: ToolRegistry`); `instructions(null)` contains "get_project_state".
- [ ] **Step 2: Run** `npx vitest run src/main/plugins/claude-code/mcp-tools.test.ts` — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** — PASS; `npm run typecheck`.
- [ ] **Step 5: Commit** `feat: expose the agent tool registry in MCP shape`.

### Task 5: Driver-session log

**Files:**
- Create: `src/main/plugins/claude-code/session-log.ts`, `src/main/plugins/claude-code/session-log.test.ts`

**Interfaces:**
- Consumes: `SessionStore.create/append/list` (Task 2), `EventBus`.
- Produces:
  ```ts
  class DriverSessionLog {
    constructor(opts: { sessions: SessionStore; bus: EventBus })
    /** The session for one MCP session id: `requested` when it names a session of ctx's project, else a "Claude Code" driver session created on first use and reused while the project stays the same. */
    resolve(ctx: ProjectContext, mcpSessionId: string, requested: string | null): Promise<string>
    recordCall(ctx: ProjectContext, sessionId: string, call: ToolCall): Promise<void>     // assistant message { text: '', toolCalls: [call] } + agent.event tool-started + agent.event message
    recordResult(ctx: ProjectContext, sessionId: string, result: ToolResult): Promise<void> // tool message + agent.event message + session.changed
    forget(mcpSessionId: string): void
    lastError(): string | null
  }
  ```
  Write failures are caught: the call still runs, `lastError()` returns the first message.

- [ ] **Step 1: Failing tests:** first `resolve` creates one session titled "Claude Code" with `driver: 'claude-code'`, second `resolve` with the same MCP id returns the same id; `requested` naming an existing session returns it and creates nothing; `requested` naming an unknown id falls back to a driver session; **new project → new log session** (same MCP id, a second project ctx → a different session in that project); **two MCP sessions log separately** (two MCP ids → two sessions, each with only its own calls); `recordCall` + `recordResult` append exactly an assistant message with that tool call and a tool message with that result, and emit `tool-started` then two `message` events with `threadKey` = session id; an append that throws leaves `lastError()` set and does not reject.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `feat: log MCP tool calls into a driver chat session`.

### Task 6: MCP HTTP server

**Files:**
- Modify: `package.json` (dependency `"@modelcontextprotocol/sdk": "^1.32.2"`; run `npm install`)
- Create: `src/main/plugins/claude-code/mcp-server.ts`, `src/main/plugins/claude-code/mcp-server.test.ts`
- Modify: `electron.vite.config.ts` only if the SDK must be externalized differently (check the main bundle builds: `npm run build`).

**Interfaces:**
- Consumes: `McpToolAdapter` (Task 4), `DriverSessionLog` (Task 5).
- Produces:
  ```ts
  class McpLinkServer {
    constructor(opts: { adapter: McpToolAdapter; log: DriverSessionLog; token: () => string; progressIntervalMs?: number /* default 15_000 */ })
    listen(port: number): Promise<void>        // rejects with PortInUseError(port) on EADDRINUSE
    close(): Promise<void>                      // aborts in-flight calls, closes transports and the socket
    closeSessions(): Promise<void>              // used after token regeneration
    get port(): number | null
  }
  class PortInUseError extends Error { constructor(readonly port: number) } // message "Port <port> is in use"
  ```
  Use the SDK's low-level `Server` (`@modelcontextprotocol/sdk/server/index.js`) with `ListToolsRequestSchema` / `CallToolRequestSchema` handlers so JSON schemas pass through unchanged; `StreamableHTTPServerTransport` (`…/server/streamableHttp.js`) in stateful mode, one `Server`+transport pair per MCP session (map by `mcp-session-id`), `enableDnsRebindingProtection: true`, `allowedHosts: ['127.0.0.1:<port>', 'localhost:<port>']`. Auth check before the transport sees the request. Body: read up to 4 MB, `JSON.parse`; failure → 400 JSON-RPC error. In the call handler: `ctx = await adapter.activeProject()` (null → `{ content: [{type:'text', text: NO_PROJECT}], isError: true }`), `sessionId = await log.resolve(ctx, mcpSessionId, header 'x-webtoon-session')`, `recordCall`, `adapter.call(...)` with `extra.signal` combined with the server's own close signal, `recordResult`; if `extra._meta?.progressToken` is set, send `notifications/progress` every interval with `{ progress: elapsedSeconds, message: 'Working… <n> s' }`. `instructions` are computed per session at initialize from `adapter.instructions(await adapter.activeProject())`.

- [ ] **Step 1: Failing tests** (real HTTP on port 0-assigned free port; SDK `Client` + `StreamableHTTPClientTransport` with `requestInit.headers`): no token → 401; wrong token → 401; foreign `Host` header (raw `fetch` with `Host: evil.test`) → 403; `listTools` equals `adapter.listTools()`; `callTool('create_character', …)` creates the character and the log session gets two messages; a failing tool → `isError: true`; no active project → the NO_PROJECT text; client-side abort of a slow stub tool aborts its signal; progress notifications arrive for a slow stub tool with `progressIntervalMs: 50`; `closeSessions()` → the old client's next call fails, a new client connects; **stop() aborts in-flight calls** (`close()` during a slow stub tool → its signal aborted, `close()` resolves); **malformed body → 400, server still up** (raw POST `{not json`, then a normal `listTools` works); a second `listen` on a used port → `PortInUseError`.
- [ ] **Step 2: Run** `npx vitest run src/main/plugins/claude-code/mcp-server.test.ts` — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** — PASS; `npm run typecheck`; `npm run build` succeeds.
- [ ] **Step 5: Commit** `feat: MCP link server over Streamable HTTP on localhost`.

### Task 7: The `claude-code` plugin (phase 1 part)

**Files:**
- Create: `src/main/plugins/claude-code/plugin.ts`, `src/main/plugins/claude-code/plugin.test.ts`, `src/main/plugins/index.ts` (`builtinPlugins(): HarnessPlugin[]` → `[createClaudeCodePlugin()]`)
- Modify: `src/main/ipc/handlers/plugins.ts` (add `claudeCode:connectCommand`, `claudeCode:regenerateToken`), `src/shared/ipc.ts`

**Interfaces:**
- Consumes: Tasks 3–6.
- Produces: `createClaudeCodePlugin(opts?: { serverFactory?: … }): HarnessPlugin & { connectCommand(): string; regenerateToken(): Promise<void>; linkUrl(): string | null; token(): string }` with id `claude-code`, name `Claude Code`, description "Lets Claude Code drive this app through an MCP link, and (optionally) act as the agent." Config keys: `port` (number, default 7880, validated 1024–65535), `useAsAgent` (boolean, default false; Task 9), `claudePath` (string, default ''; Task 10). `start`: ensure token in secrets (`plugin:claude-code`), `listen(port)`; status `running` "Listening on 127.0.0.1:<port>" or `error` "Port <port> is in use" (any other error: its message). `stop`: `close()`, status `off` "Off". Status message appends " · session log: <lastError>" when the log reported a failure.

- [ ] **Step 1: Failing tests:** enabling through `PluginManager` starts a server on the configured port and status says "Listening on 127.0.0.1:<port>"; the token is created once and survives a restart (same value from secrets); `connectCommand()` equals the Global Constraints command with that port and token; `regenerateToken()` changes the token and calls `closeSessions()`; a busy port gives status `error` "Port <port> is in use" while `enabled` stays true; `setConfig({ port: 80 })` is rejected with "Port must be between 1024 and 65535"; disabling closes the server.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4: Run** `npx vitest run src/main/plugins` + typecheck — PASS.
- [ ] **Step 5: Commit** `feat: Claude Code plugin runs the MCP link`.

### Task 8: Renderer — active context, Settings → Plugins, driver banner

**Files:**
- Create: `src/renderer/src/components/settings/PluginsTab.tsx`, `PluginsTab.test.tsx`, `src/renderer/src/stores/plugins-store.ts`
- Modify: `src/renderer/src/components/settings/SettingsDialog.tsx` (tab `plugins`, label "Plugins"), `src/renderer/src/stores/app-store.ts` (call `app:setActiveContext` whenever `projectId` or `activeEpisodeId` changes, and once after startup), `src/renderer/src/events.ts` (`plugins.changed` → plugins store reload), `src/renderer/src/components/chat/ChatPane.tsx` and `Composer.tsx` (session with `driver === 'claude-code'`: banner text "Driven by Claude Code" with `data-testid="driver-banner"`, composer disabled)

**Interfaces:**
- Consumes: IPC from Tasks 3 and 7; `SessionSummary.driver`.

- [ ] **Step 1: Failing tests:** `PluginsTab` lists the plugin card with name, description, switch and status; toggling calls `plugins:setEnabled`; when enabled the card shows the port field (saving calls `plugins:setConfig` with a number), **Copy command** calls `claudeCode:connectCommand` and writes its result to `navigator.clipboard.writeText`, **Regenerate token** calls `claudeCode:regenerateToken`; ChatPane on a driver session shows the banner and a disabled composer, and on a normal session neither; app-store test: opening a project and choosing an episode each invoke `app:setActiveContext` with the new ids.
- [ ] **Step 2: Run** `npx vitest run src/renderer` — FAIL. **Step 3: Implement.** **Step 4: Run** — PASS; typecheck.
- [ ] **Step 5: Commit** `feat: Settings → Plugins and the driven-session banner`.

### Task 9 (phase-1 acceptance): e2e link test and docs

**Files:**
- Create: `tests/e2e/claude-code-link.spec.ts`
- Modify: `README.md` (or the user doc the repo already has for Settings) — a short "Claude Code link" section with the connect command.

- [ ] **Step 1: Write the e2e:** launch the app, create a project and session, open Settings → Plugins, switch on Claude Code, set port to a free port, read the command via **Copy command** (stub `navigator.clipboard` in the page or call `claudeCode:connectCommand` through `window.api`), connect an SDK `Client` from the test process with that URL and token, `callTool('create_character', { name: 'Mina', role: 'protagonist', appearanceLock: '…', generateBaseImage: false })`; expect the Characters tab to show Mina and the sessions sidebar to show a "Claude Code" session whose view has `driver-banner` and the tool card.
- [ ] **Step 2: Run** `npm run build && npx playwright test tests/e2e/claude-code-link.spec.ts` — PASS (it fails first only if something above is wrong; fix the cause).
- [ ] **Step 3: Run the whole suite** `npx vitest run` and `npx playwright test` (the live specs skip without their env vars) — PASS.
- [ ] **Step 4: Commit** `test: Claude Code link end to end`.

## Phase 2 — Claude Code as the in-app agent

### Task 10: Stream-json parser and executable lookup

**Files:**
- Create: `src/main/plugins/claude-code/stream-json.ts`, `stream-json.test.ts`, `src/main/plugins/claude-code/locate-claude.ts`, `locate-claude.test.ts`, `src/main/plugins/claude-code/fixtures/*.jsonl`

**Interfaces:**
- Produces:
  ```ts
  type ClaudeStreamEvent =
    | { kind: 'init'; sessionId: string }
    | { kind: 'text-delta'; text: string }
    | { kind: 'assistant-text'; text: string }                 // text blocks of one finished assistant message, joined; '' when it had only tool_use
    | { kind: 'result'; ok: boolean; subtype: string; text: string; sessionId: string }
  class StreamJsonParser { push(chunk: Buffer): ClaudeStreamEvent[]; end(): ClaudeStreamEvent[] }  // splits on \n, decodes with a streaming TextDecoder, ignores unknown event types and non-JSON lines
  function locateClaude(opts: { configured: string; pathLookup: (cmd: string) => string | null; appData: string; exists: (p: string) => boolean; listDir: (p: string) => string[] }): string | null
  ```
  `locateClaude`: configured (if it exists) → `pathLookup('claude')` → newest `<appData>/Claude/claude-code/<version>/<hash>/claude.exe` by semver of `<version>`.

- [ ] **Step 1: Record fixtures** from the real binary (path from `locateClaude` on this machine): `claude -p "say hi" --output-format stream-json --verbose --include-partial-messages --tools "" > fixtures/hello.jsonl`, and one run that calls an MCP tool against a running link (Task 9's app) → `fixtures/tool.jsonl`. Also confirm here that `--tools ""` leaves MCP tools usable; if it does not, use `--disallowedTools Bash Edit Write Read Glob Grep WebFetch WebSearch NotebookEdit Task` instead and note it in the ledger and spec §6.2.
- [ ] **Step 2: Failing tests:** `hello.jsonl` yields `init` (its session id), ≥1 `text-delta`, one `assistant-text` "hi"-ish non-empty, and `result` ok; `tool.jsonl` yields an `assistant-text` '' for the tool-use message; **chunk boundaries**: feeding the fixture one byte at a time (including a multi-byte "→" split across chunks) gives the same events as feeding it whole; a garbage line is skipped. `locateClaude` cases: configured wins; PATH next; newest version folder (`2.1.309` beats `2.1.99`); none → null.
- [ ] **Step 3: Run** — FAIL. **Step 4: Implement.** **Step 5: Run** — PASS.
- [ ] **Step 6: Commit** `feat: parse Claude Code stream-json and find its executable`.

### Task 11: Claude Code agent backend and runner delegation

**Files:**
- Create: `src/main/plugins/claude-code/claude-code-backend.ts`, `claude-code-backend.test.ts`, `src/main/plugins/claude-code/fixtures/fake-claude.mjs`
- Modify: `src/main/sessions/session-store.ts` (new record `{ type: 'link', claudeSessionId: string, at: string }`; `SessionSummary.claudeSessionId: string | null`; `setClaudeSessionId(ctx, sessionId, id)`), `src/main/agent/agent-runner.ts` (`start`/`stop`/`isRunning`/`cancel` delegate to `services.plugins.agentBackend()` when it is non-null), `src/main/plugins/claude-code/plugin.ts` (expose `agentBackend`)

**Interfaces:**
- Consumes: `AgentBackend` (Task 3), `StreamJsonParser`, `locateClaude` (Task 10), `projectStateText` (Task 1), plugin `linkUrl()/token()` (Task 7).
- Produces: `class ClaudeCodeBackend implements AgentBackend { constructor(opts: { services: Services; plugin: { linkUrl(): string | null; token(): string; config(): Record<string, unknown> }; spawn?: typeof child_process.spawn; locate?: () => string | null }) }`. Run flow per spec §6.2: append the user message with its snapshot; emit `run-started`; write the temp MCP config (`fs.mkdtemp` + file mode `0o600`) with the `X-Webtoon-Session` header; spawn with the spec's argument list (plus `--resume <claudeSessionId>` when the session has one; `cwd` = project dir; `windowsHide: true`); map events: `init` → `setClaudeSessionId`, `text-delta` → `text-delta`, non-empty `assistant-text` → append assistant `ChatMessage` (`model: { endpointId: 'plugin:claude-code', modelId: 'claude-code' }`, `stopReason: 'end_turn'`) + `message` event, `result` → `run-finished` (`end`, or `error` with `text`; subtype `error_max_turns` → `max_steps`); exit without `result` → `error` with the last 5 stderr lines; `stop` → kill the process tree (`taskkill /pid <pid> /T /F` on win32, `kill('SIGTERM')` elsewhere) → `cancelled`; always delete the temp dir. Errors before spawning use the exact copy from Global Constraints.

- [ ] **Step 1: Write `fake-claude.mjs`**: asserts its argv contains `-p`, `--strict-mcp-config`, `--allowedTools mcp__webtoon__*` and the `--mcp-config` file whose JSON has the bearer and `X-Webtoon-Session` headers (exit 3 with a message otherwise); writes argv to `$FAKE_CLAUDE_ARGV`; replays `$FAKE_CLAUDE_FIXTURE` line by line; with `FAKE_CLAUDE_HANG=1` it waits forever.
- [ ] **Step 2: Failing tests** (spawn the fake via `process.execPath`): a run appends the user message (with `<project_state>` snapshot), streams `text-delta`s, appends one assistant message, ends `end`; the session now has `claudeSessionId` and the next run's argv contains `--resume <that id>`; `stop()` on a hanging fake ends `cancelled` and the process is gone; link off → `error` "Turn on the Claude Code plugin's link first."; `locate` null → `error` "Claude Code was not found. Set its path in Settings → Plugins."; the temp config dir no longer exists after each run; `AgentRunner.start` goes to the backend when `plugins.agentBackend()` is non-null and to the model loop otherwise.
- [ ] **Step 3: Run** — FAIL. **Step 4: Implement.** **Step 5: Run** `npx vitest run src/main` + typecheck — PASS.
- [ ] **Step 6: Commit** `feat: Claude Code as the in-app agent backend`.

### Task 12: Settings and chat UI for the backend, live test

**Files:**
- Modify: `PluginsTab.tsx` (+test): switch "Use Claude Code as the agent" (`useAsAgent`), field "Claude Code path" (`claudePath`) with hint "Detected: <path>" or "Not found" from a new IPC `claudeCode:detect → { path: string | null }`; `src/renderer/src/components/chat/ModelPicker.tsx` (+test): when the backend is active, show "Claude Code" instead of the agent model and disable the picker.
- Create: `tests/e2e/claude-code-live.spec.ts` (skipped unless `WEBTOON_LIVE_CLAUDE=1`): mock image model, plugin on with `useAsAgent`, send "Create a character named Mina, a high-school girl with a black bob and a navy school uniform, without generating an image." and expect Mina in the Characters tab and an assistant reply in the chat.

- [ ] **Step 1: Failing tests** for the switch, path field, detect hint and the ModelPicker label. **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4: Run** — PASS.
- [ ] **Step 5: Run the live test once** `WEBTOON_LIVE_CLAUDE=1 npx playwright test tests/e2e/claude-code-live.spec.ts` — PASS; record the run time in the ledger.
- [ ] **Step 6: Commit** `feat: choose Claude Code as the agent in Settings`.

## Phase 3 — Claude Code plugin for the harness

### Task 13: `integrations/` plugin and its check

**Files:**
- Create: `integrations/.claude-plugin/marketplace.json`, `integrations/claude-code-plugin/.claude-plugin/plugin.json`, `integrations/claude-code-plugin/.mcp.json`, `integrations/claude-code-plugin/skills/webtoon-agent/SKILL.md`, `integrations/claude-code-plugin/commands/{continue-story,draw-panel,new-character}.md`, `integrations/claude-code-plugin/README.md`, `src/main/plugins/claude-code/integrations.test.ts`

**Interfaces:**
- Consumes: tool names (`ALL_TOOL_NAMES` + `get_project_state`), `continueStoryPrompt` text from `src/shared/prompts.ts`.
- Contents per spec §7. `marketplace.json`: `{ "name": "webtoon-harness-local", "owner": { "name": "Webtoon AI Harness" }, "plugins": [{ "name": "webtoon-harness", "source": "./claude-code-plugin", "description": "…" }] }`. `.mcp.json`: `{ "mcpServers": { "webtoon": { "type": "http", "url": "http://127.0.0.1:${WEBTOON_MCP_PORT:-7880}/mcp", "headers": { "Authorization": "Bearer ${WEBTOON_MCP_TOKEN}" } } } }`. `SKILL.md` frontmatter `name: webtoon-agent`, `description:` "Use when driving the Webtoon AI Harness through its MCP tools: planning beats, creating characters or items, drawing or editing panels, AI-led story runs." Body: always `get_project_state` first; follow the harness rules (one beat per panel, never invent ids, read `workflows/*` with `read_workflow_doc` before each kind of work); tool names in backticks. `continue-story.md`: `$ARGUMENTS` panels (default 4), body = the `continueStoryPrompt` sentence plus "Follow workflows/story-direction (AI-Led Mode)."

- [ ] **Step 1: Failing test** (`integrations.test.ts`): the three JSON files parse and have the keys above; the marketplace `source` folder exists; every backticked `snake_case` tool name in `SKILL.md` and the commands is in `ALL_TOOL_NAMES` or is `get_project_state`; `continue-story.md` contains exactly `Continue the story (AI-led): plan the next beats and draw the next $ARGUMENTS panels.` (the `continueStoryPrompt` sentence with the count as `$ARGUMENTS`) and says the default is 4 when no argument is given; no file contains a token-looking string (`/[A-Za-z0-9_-]{40,}/`).
- [ ] **Step 2: Run** `npx vitest run src/main/plugins/claude-code/integrations.test.ts` — FAIL. **Step 3: Write the files.** **Step 4: Run** — PASS.
- [ ] **Step 5: Manual check:** in a Claude Code terminal, `/plugin marketplace add "E:\claude\Webtoon AI Harness\integrations"`, `/plugin install webtoon-harness`, set `WEBTOON_MCP_TOKEN`, run `/webtoon:continue-story 1` against the running app; note the result in the ledger.
- [ ] **Step 6: Commit** `feat: Claude Code plugin for driving the harness`.
