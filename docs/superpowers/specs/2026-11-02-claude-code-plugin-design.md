# Claude Code Plugin — Design Spec

Extends `2026-10-21-webtoon-ai-harness-design.md` and `2026-11-02-item-maker-design.md`. Everything not said here works as those specs say.

## 1. Requirement (user's words)

> Can you use Claude Code session for it. Is there a way to connect claude code with it … Build an MCP link … Make it as a plugin for harness … Both.

Context: the AI-led story test needs a capable agent. The in-app agent role only talks to an API endpoint; Gemma 4 31B failed (43 identical broken `create_panel` calls) and Kimi needs paid credits. The user wants Claude Code to be the story agent, from inside the harness **and** from Claude Code itself.

Decisions taken in brainstorming:

| Question | Decision |
|---|---|
| What the user sees while Claude Code drives | A live chat session in the app with every tool call and result, plus the usual live panels, characters, beats and bible. |
| Access to the link | Off by default; turned on in Settings; `127.0.0.1` only; bearer token. |
| Plugin kind | Both: a built-in harness plugin ("Claude Code") **and** a Claude Code plugin for the harness. |
| Plugin loading | Built-in plugins only. No code is loaded from outside the app. |

## 2. Vocabulary

| Term | Meaning |
|---|---|
| **Harness plugin** | A module that ships inside the app, can be switched on and off in Settings → Plugins, and can start work in the main process, add a Settings section and offer an agent backend. |
| **Claude Code plugin (harness side)** | The first harness plugin, id `claude-code`. It owns the MCP link and the Claude Code agent backend. |
| **MCP link** | An MCP server (Streamable HTTP) inside the app's main process that offers the agent's tools to an MCP client. |
| **Driver session** | A chat session whose steps come from Claude Code, not from the in-app agent loop. |
| **Claude Code plugin (Claude Code side)** | A plugin installed in Claude Code (`integrations/claude-code-plugin/`) that connects to the MCP link and carries the harness's agent rules as a skill and commands. |

## 3. Phases

The work is built and tested in three phases; each one is usable on its own.

| Phase | Delivers | Usable result |
|---|---|---|
| 1 | Plugin system, the `claude-code` plugin with the MCP link, Settings → Plugins | Any Claude Code session can drive the open project; the user watches live. |
| 2 | Claude Code as the in-app agent backend | Chat and **Continue story** in the app run Claude Code. |
| 3 | The Claude Code plugin in `integrations/` | `/plugin install webtoon-harness`, then `/webtoon-harness:continue-story` in Claude Code. |

## 4. Phase 1: plugin system

### 4.1 Plugin contract (`src/main/plugins/types.ts`)

```ts
interface HarnessPlugin {
  id: string                    // 'claude-code'
  name: string                  // 'Claude Code'
  description: string
  /** Called when the plugin is enabled (and at app start if it was enabled). Never throws: problems go to status(). */
  start(host: PluginHost): Promise<void>
  /** Called when disabled and at app quit. Must release ports and child processes. */
  stop(): Promise<void>
  /** A short line for Settings, e.g. "Listening on 127.0.0.1:7880" or "Port 7880 is in use". */
  status(): PluginStatus
  /** Called with a config patch before it is saved; throws a readable error to refuse it. */
  validateConfig?(patch: Record<string, unknown>): void
  /** Whether a saved patch needs a restart to apply; absent means always (ruling R19). */
  restartOnConfig?(patch: Record<string, unknown>): boolean
  /** Phase 2. */
  agentBackend?: AgentBackend
}

interface PluginHost {
  services: Services
  bus: EventBus
  secrets: SecretStore
  activeContext(): ActiveContext   // §4.4
  config(): Record<string, unknown>
  setConfig(patch: Record<string, unknown>): Promise<void>
}

type PluginStatus = { state: 'off' | 'running' | 'error'; message: string }
```

### 4.2 Registry and settings (`src/main/plugins/plugin-manager.ts`)

- `PluginManager` holds the built-in plugin list (`[claudeCodePlugin]`), reads and writes `<userData>/plugins.json`:
  `{ "plugins": { "<id>": { "enabled": boolean, "config": { … } } } }` (zod-validated; unknown ids are kept but ignored; a corrupt file is reported and treated as "all off", never overwritten).
- At app start it starts every enabled plugin; at quit it stops all of them (awaited, with a 5 s cap each).
- `setEnabled(id, on)` starts or stops the plugin and persists the flag; `setConfig(id, patch)` first asks the plugin's `validateConfig(patch)` (a throw refuses the patch and nothing is saved), then persists and, if the plugin is running and its `restartOnConfig(patch)` returns true (or it has none), restarts it. The `claude-code` plugin restarts only for `port`: `useAsAgent` and `claudePath` are read at run time, so changing them does not cut off runs and connected clients (ruling R19).
- Every change emits a new app event `{ type: 'plugins.changed' }`.

IPC (all `projectId`-free):

| Channel | Request | Response |
|---|---|---|
| `plugins:list` | `{}` | `PluginView[]` (`id, name, description, enabled, status, config`) |
| `plugins:setEnabled` | `{ id, enabled }` | `PluginView` |
| `plugins:setConfig` | `{ id, patch }` | `PluginView` |
| `claudeCode:connectCommand` | `{}` | `{ command: string }` (the `claude mcp add …` line with the token) |
| `claudeCode:regenerateToken` | `{}` | `void` |

The token crosses to the renderer only through `claudeCode:connectCommand`, which the Settings section calls when the user clicks **Copy command**.

### 4.3 Settings → Plugins (`src/renderer/src/components/settings/PluginsTab.tsx`)

A new tab in the Settings dialog: one card per plugin with its name, description, on/off switch and status line. The `claude-code` card, when on, also shows:

- Port (number field, default 7880, 1024–65535).
- **Copy command**: copies `claude mcp add --transport http webtoon http://127.0.0.1:<port>/mcp --header "Authorization: Bearer <token>"`.
- **Regenerate token** (old connections stop working).
- Phase 2: **Use Claude Code as the agent** switch and **Claude Code path** field with a "Detected: …" hint (§6.2).

### 4.4 Active context

The main process does not know which project and episode the window shows today. Add IPC `app:setActiveContext { projectId: string | null, episodeId: string | null }`, sent by the renderer whenever the open project or episode changes (and once at load). `PluginHost.activeContext()` returns the last value.

## 5. Phase 1: the MCP link (`src/main/plugins/claude-code/`)

### 5.1 Server (`mcp-server.ts`)

- Node `http` server on `127.0.0.1:<port>`, path `/mcp`, using `@modelcontextprotocol/sdk` (new dependency, `^1.32`): the low-level `Server` (not `McpServer`: the tools' JSON schemas are passed through unchanged, with no zod round trip; ruling R7) with its own `tools/list` and `tools/call` handlers, plus `StreamableHTTPServerTransport` in stateful mode (one `Server` and transport per MCP session id).
- Project: a request with `X-Webtoon-Project: <prj_id>` (the in-app backend's runs, §6.2) acts on that project, opened with `services.projects.open`; one that cannot be opened is an `isError` result, never the window's project. `X-Webtoon-Episode` (an episode id, or empty) is then the episode `get_project_state` names. Without the header (external clients) the window's project and episode are used (§4.4). The chosen project is used for the instructions, the tool context, the session log and `get_project_state` (ruling R18).
- Stop: the server keeps the abort controller of every call in flight by its log session. `abortCalls(sessionId)` aborts them and closes the MCP sessions that logged into that session; the backend calls it when a run is stopped, because killing `claude` does not end the server-side handler (the SDK does not abort it on a client disconnect).
- Every request must carry `Authorization: Bearer <token>`; the comparison uses `crypto.timingSafeEqual`; a missing or wrong token gets 401 and nothing else. Host and Origin headers must be `127.0.0.1:<port>` or `localhost:<port>` (DNS-rebinding guard; 403 otherwise).
- Token: 32 random bytes, base64url, created on first enable, stored in `SecretStore` under the key `plugin:claude-code`. Regenerating closes all open MCP sessions.
- A port already in use leaves the plugin enabled with status `error`, "Port 7880 is in use"; changing the port or toggling retries.

### 5.2 Tools (`mcp-tools.ts`)

- The tool list is `buildAgentTools({ vision: true })` exactly: same names, descriptions and JSON input schemas (`ToolRegistry.specs()`), so the workflow docs apply unchanged.
- One extra tool, `get_project_state` (no input): returns the `<project_state>` snapshot the in-app agent gets with each message (`buildStateSnapshot`). The gathering code moves out of `AgentRunner` into `src/main/agent/project-state.ts` so both use it.
- A call runs `ToolRegistry.execute` with a `ToolContext` for the active project: `project` from `services.projects.open(activeContext.projectId)`, `signal` from the MCP request (a client cancel aborts the generation), `threadKey` = the log session id (§5.4).
- No open project: every tool returns an error result, "Open a project in the Webtoon AI Harness window first."
- Results: `ok: true` → text content (the tool's content string); `ok: false` → `isError: true` with the message. `images` (project-relative paths) become MCP image content via `loadImageForTextModel` (downscaled JPEG), after the text.
- Long calls: when the request has a progress token, a progress notification goes out every 15 s until the call ends ("Generating…, 45 s").
- Episode: tools that need an episode already take an `episodeId`; `get_project_state` names the active episode as `current_episode`, as the in-app snapshot does.

### 5.3 Instructions

The server's `instructions` (sent at initialize) are `buildAgentSystemPrompt(AGENTS.md, docIndex)` for the active project at connect time, plus one paragraph: "You are connected to the Webtoon AI Harness through MCP. Call `get_project_state` before you plan or draw, and again after the user may have changed things. Read workflow docs with `read_workflow_doc`."

### 5.4 Driver session (live log)

- Each MCP session logs into one chat session of the active project:
  - if the request carries `X-Webtoon-Session: <ses_id>` naming a session of that project (phase 2), that session;
  - otherwise a new session titled "Claude Code", created on the first tool call and reused for the rest of that MCP session (a new one if the active project changes).
- New field on the session meta: `driver: 'claude-code' | null` (default null). Sessions created by §5.4's second rule get `'claude-code'`.
- For each call: before running, append an assistant message with that one tool call and emit `agent.event` `tool-started`; after, append the tool message with the result and emit `session.changed`. The `threadKey` is the session id, so the chat pane shows the steps exactly like the in-app agent's.
- In the renderer, a session with `driver: 'claude-code'` shows a banner "Driven by Claude Code" and its composer is disabled.
- If the session file cannot be written, the tool still runs; the log failure is reported once in the plugin status.

## 6. Phase 2: Claude Code as the in-app agent

### 6.1 Backend contract

```ts
interface AgentBackend {
  /** Same shape as AgentRunner.start: appends the user message, streams AgentEvents for `threadKey`, persists the outcome. */
  start(input: StartRunInput): Promise<{ runId: string }>
  stop(sessionId: string): Promise<void>
  isRunning(threadKey: string): boolean
}
```

`AgentRunner` (and the `agent:*` IPC handlers) delegate main-chat runs to the backend of the enabled plugin whose config has `useAsAgent: true`; otherwise they run the model loop as today. The panel side chat is unchanged (it keeps using the `panelChat` model).

### 6.2 Running Claude Code (`claude-code-backend.ts`)

- Executable: config `claudePath`; if empty, `claude` on `PATH`; if absent, the newest `%APPDATA%\Claude\claude-code\<version>\<hash>\claude.exe`. Not found → the run ends with `error` "Claude Code was not found. Set its path in Settings → Plugins."
- The run requires the MCP link to be running; with the plugin off it ends with `error` "Turn on the Claude Code plugin's link first.", and with the plugin on but the link not listening (the port is in use, say) with `error` "The Claude Code link is not running: <plugin status message>".
- Images: Claude Code cannot be given the attached images yet, so `start` refuses a message that has any with "Claude Code can't see attached images yet. Remove them, or switch the agent off Claude Code in Settings → Plugins." Nothing is persisted, and the composer's Attach button is off while Claude Code is the agent (ruling R16).
- The user message is appended with its state snapshot, exactly as the model loop does.
- Spawned as:

```
claude -p
  --output-format stream-json --verbose --include-partial-messages
  --mcp-config <temp file: {"mcpServers":{"webtoon":{"type":"http","url":"http://127.0.0.1:<port>/mcp",
                 "headers":{"Authorization":"Bearer <token>","X-Webtoon-Session":"<ses_id>",
                            "X-Webtoon-Project":"<prj_id>","X-Webtoon-Episode":"<epi_id or empty>"}}}}>
  --strict-mcp-config
  --setting-sources user           # the project folder's .claude/settings*.json (hooks) must not apply (R13)
  --tools ""                       # no built-in tools: no shell, files or web
  --allowedTools "mcp__webtoon__*"
  [--resume <claudeSessionId>]
```

  The prompt goes on stdin, not on the command line (ruling R12): a message starting with `-` or naming a subcommand would be read by the CLI, and Windows caps the command line at about 32K characters. Stdin is the state snapshot, a blank line, then the user's text, the way the model loop attaches the snapshot to the user turn (ruling R17). There is no `--append-system-prompt`: Claude Code records the system prompt on the first request of a session and replays it on `--resume`, so a snapshot passed there would stay frozen at the chat's first message.
  The `X-Webtoon-Project` and `X-Webtoon-Episode` headers keep the run on its own project and episode even if the window switches project mid-run (§5.1, ruling R18).
  The environment adds `MCP_TOOL_TIMEOUT=900000` (15 minutes), so a long image call is not cut off by Claude Code's MCP timeout.
  The temp config file is written with `mode: 0o600` (owner-only on POSIX; on Windows it is the per-user `%TEMP%` folder's ACL that keeps it private) and deleted when the run ends. Working directory: the project folder.
- Stream handling: the `system/init` event's `session_id` is saved on the session meta as `claudeSessionId` (next runs pass `--resume`); text deltas become `text-delta` events; each finished assistant message's text becomes an assistant `ChatMessage` (its `tool_use` blocks are not repeated: §5.4 already logs them); the `result` event ends the run (`end`, or `error` with its message; `max_turns` → `max_steps`).
- Stop: kills the process tree, then aborts the run's tool calls still in flight on the link (`abortCalls`, §5.1); the run ends `cancelled`. App quit stops all runs.
- A session with a `driver` (§5.4) is read-only: `AgentRunner.start` refuses it with "This session is driven by Claude Code and is read-only.", and its composer and **Continue story** button are off.
- A non-zero exit without a `result` event ends the run with `error` and the last stderr lines.

## 7. Phase 3: Claude Code plugin (`integrations/`)

```
integrations/
  .claude-plugin/marketplace.json        # marketplace "webtoon-harness-local" listing the plugin
  claude-code-plugin/
    .claude-plugin/plugin.json           # name "webtoon-harness", version, description
    .mcp.json                            # server "webtoon": http, url http://127.0.0.1:${WEBTOON_MCP_PORT:-7880}/mcp,
                                         #   header Authorization: Bearer ${WEBTOON_MCP_TOKEN}
    skills/webtoon-agent/SKILL.md        # when to use; the harness rules (summary of AGENTS.md); always get_project_state
                                         #   first; read workflow docs via read_workflow_doc; never invent ids
    commands/continue-story.md           # /webtoon-harness:continue-story: AI-led autopilot, same text as the Continue story
                                         #   button, N from $ARGUMENTS (default 4)
    commands/draw-panel.md               # draw one panel from $ARGUMENTS following workflows/panel-generation
    commands/new-character.md            # create a character from $ARGUMENTS following workflows/character-creation
    README.md                            # install: /plugin marketplace add <repo>/integrations; /plugin install webtoon-harness;
                                         #   set WEBTOON_MCP_TOKEN (Settings → Plugins → Copy command shows it)
```

The token is never written into the plugin. The skill quotes no doc in full: it points at `read_workflow_doc` so the project's own (editable) docs stay the source.

Claude Code namespaces plugin commands by the plugin name, so the commands are `/webtoon-harness:continue-story`, `/webtoon-harness:draw-panel` and `/webtoon-harness:new-character` (ruling R15). It also namespaces a plugin's MCP server: installed this way, the tools are `mcp__plugin_webtoon-harness_webtoon__<name>`, while `claude mcp add` gives `mcp__webtoon__<name>`. The skill and commands therefore use the plain tool names, and the READMEs say to use one way of connecting, not both (both would list every tool twice).

## 8. Errors and limits

- One Claude Code client and the in-app agent may act on the same project at once; the services' file locks keep files consistent, as with two app sessions today.
- An external MCP client only acts on the project open in the window. Switching projects mid-call finishes the call on the old project; later calls use the new one. The in-app backend's runs name their project in `X-Webtoon-Project`, so they stay on it (§5.1).
- Out of scope: loading plugins from a folder; the panel side chat on Claude Code; the two Gemma findings (infer `characterId` from `variationId`; stop repeated identical failed calls), which are a separate change.

## 9. Testing

Phase 1:
- `plugin-manager.test.ts`: start enabled plugins, persist toggles, corrupt file → all off and reported, stop on quit, `plugins.changed` events.
- `mcp-server.test.ts` (real HTTP, real SDK client, test services on a temp project): 401 without or with a wrong token; 403 on a foreign Host; `tools/list` equals `ToolRegistry.specs()` plus `get_project_state`; `create_character` through MCP creates the character; an `ok: false` tool gives `isError`; images arrive as image content; no open project → the "Open a project" error; client cancel aborts the handler's signal; progress notifications on a slow stub tool; regenerate token closes sessions.
- `driver session` tests: a new "Claude Code" session with `driver`; `X-Webtoon-Session` routes to that session; each call appends a tool-call message and a result message.
- Renderer: `PluginsTab.test.tsx` (toggle, status, copy command); the read-only banner on a driver session.
- e2e `tests/e2e/claude-code-link.spec.ts`: enable the plugin in Settings, connect with the SDK client from the test, create a character, see it in the Characters tab and the steps in the "Claude Code" session.

Phase 2:
- `claude-code-backend.test.ts` with a fake `claude` (a Node script that checks its arguments and replays recorded stream-json): text deltas, the saved `claudeSessionId` and `--resume` on the next run, stop kills the process, missing executable and link-off errors, temp config deleted.
- A backend-to-link test: a real `McpLinkServer` and a fake `claude` that runs initialize and a `tools/call` with the headers from its `--mcp-config`, while the window shows another project; the call lands in the run's project and session.
- Opt-in live test (`WEBTOON_LIVE_CLAUDE=1`): a character-creation smoke test (one real run that creates a character through the link). A real Continue is the story benchmark below, which runs once Claude Code is signed in (ruling R20).

Phase 3:
- A vitest that validates `plugin.json`, `marketplace.json` and `.mcp.json` shapes and checks that every tool named in the skill and commands exists in `ALL_TOOL_NAMES`.
- Manual: install from the local marketplace, run `/webtoon-harness:continue-story 2` against the running app.

Acceptance: the story-flow benchmark (`E:\claude\manhwa-benchmark\run\story.spec.ts`) runs end to end with Claude Code as the author (phase 2 backend), the ChatGPT bridge drawing, and its output scored against `story/study.md`.
