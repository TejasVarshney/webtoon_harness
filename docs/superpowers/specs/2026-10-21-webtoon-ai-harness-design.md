# Webtoon AI Harness — Design Spec

Date: 2026-10-21 · Status: draft for user review · Plan: `docs/superpowers/plans/2026-10-21-webtoon-ai-harness.md`

## 1. Requirements (user's words)

> Build an ai harness for webtoons.
> At left, there will be session window. It will handle session just like in claude code.
> At middle, it will be a chat area where i can chat and give context to the ai.
> At right there will be webtoon visualizer, it will show webtoons.
> In chat section, I can select a panel and a side chat appear and it have context and change the image accordioning.
> There must be a character creation where I can create a characters and its variation and also I can give it a characterization. This process can be automate using AI chat section.
> The AI must be consistent over it i.e it will select which characters will be in panel, then according to previous panel and the prompt create a new panel. And character must be there. Ai or user an create variation of character in character window and it must show there.
> The story must follow according to the user or AI can decide the story. Create a massive .md files that regulates the agentic workflow.
> User also have ability to create panel in right window.
> User can add or remove different models and new endpoints and select from list of models that will be used.
> Use electron js to build it

## 2. Vocabulary

| Term | Meaning |
|---|---|
| **Project** | One webtoon. Owns story bible, outline, characters, episodes, panels, sessions, and its own copy of the workflow docs. Stored as one folder. |
| **Session** | One chat transcript with the main agent inside a project (like a Claude Code session). Many per project; all share the project's state. |
| **Episode** | An ordered list of panels. The visualizer shows one episode at a time. A project always has at least "Episode 1". |
| **Panel** | One image plus structured data (description, setting, shot, aspect, cast, dialogue, continuity) plus a version history. |
| **Panel version** | One image attempt for a panel (generated, edited, or uploaded). Versions are never overwritten; the panel points at a `currentVersionId`. |
| **Character** | Identity + characterization + structured appearance + **appearance lock** + variations. |
| **Appearance lock** | One canonical paragraph of visual description, injected verbatim into every image prompt that shows the character. |
| **Variation** | A named recurring look of a character (base, outfit, expression, pose, age, form, other) with its own reference image. Every character has exactly one `base` variation. |
| **Endpoint** | A configured API: kind + base URL + (encrypted) API key. |
| **Model** | A model id on an endpoint, with capabilities (`text`, `vision`, `image-gen`, `image-edit`). |
| **Role** | A job a model is assigned to: `agent`, `panelChat`, `vision`, `image`, `imageEdit`. |
| **Story mode** | `user` (user-led: AI follows the user, never invents major plot) or `ai` (AI-led: AI decides and advances the story). |

## 3. UI layout

```
┌──────────────┬───────────────────────────────────────┬──────────────────────────┐
│ SESSIONS     │ CHAT                 │ PANEL SIDE CHAT │ [Webtoon|Characters|Story]│
│ [project ▾]  │ header: mode toggle, │ (only while a   │                          │
│ + New session│ agent model picker,  │  panel is       │  Episode ▾  + Episode    │
│ ● Session A  │ Continue story (ai)  │  selected)      │  ┌──────────────┐        │
│   Session B  │                      │ ‹ v2 / 3 ›  ×   │  │  panel 1     │ ← click│
│   …          │ messages, tool cards,│ thread          │  └──────────────┘ selects│
│              │ panel thumbnails     │                 │        [+]               │
│ ⚙ Settings   │ composer (attach,    │ composer        │  ┌──────────────┐        │
│              │ send / stop)         │                 │  │  panel 2     │        │
└──────────────┴──────────────────────┴─────────────────┴──────────────────────────┘
```

- **Left — Sessions** (Claude Code-like): project switcher + "New project"; "New session" (Ctrl+N); list sorted by last activity with title and relative time; running indicator (●) while an agent run is active; rename (double-click / context menu); delete (moves file to OS trash); click to resume. Title auto-derives from the first user message (first 60 chars). Settings button at the bottom.
- **Middle — Chat**: markdown assistant messages streamed live; collapsible tool-call cards; tool results that produced images show thumbnails, and clicking a panel thumbnail selects that panel; composer with Enter-to-send, Shift+Enter newline, image attach, Stop button while running. Header: story mode toggle, agent model picker (sets the `agent` role), and a "Continue story" button visible only in AI-led mode. Banner when the agent role is the offline mock model.
- **Panel side chat**: selecting a panel (in the visualizer or from a chat thumbnail) splits the middle column; the side chat is bound to that panel, has its own persisted thread, shows a version switcher (‹ vN / M ›, which reverts), and closes with × or Escape.
- **Right — tabs**:
  - **Webtoon**: episode selector, vertical strip of panel cards (image, status overlay, dialogue bubbles rendered as HTML over the image), "+" insert buttons between panels, hover toolbar (edit, regenerate, move up/down, delete). Insert/edit opens the manual **Panel editor** (description, setting, shot, aspect, cast picker with variation select + action + expression, dialogue lines; buttons "Create & generate", "Create without image", "Upload image…").
  - **Characters** (the "character window"): character cards; detail view with characterization/appearance/appearance-lock form, "Draft with AI" button (prefills the main chat composer), variation grid with status badges, "Add variation", regenerate, upload image, archive. Updates live when the AI creates or changes characters/variations.
  - **Story**: story bible (editable markdown) and beats list for the current episode.
- **Settings dialog**: *Models* tab (endpoints add/edit/remove with presets, write-only API key field, test connection; models per endpoint with capabilities and params JSON; role assignment selects filtered by capability) and *Workflow docs* tab (list, open in system editor, reset to defaults).

## 4. Architecture

- **Electron** with `electron-vite`, **React 19 + TypeScript (strict)**, **Zustand** for renderer state, **zod 4** for every schema (files, IPC inputs, tool inputs; JSON Schema via `z.toJSONSchema`).
- **Main process owns everything stateful**: file I/O, model calls, API keys, agent loops. The renderer is a view: it calls typed IPC and re-fetches on events.
- **Security**: `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`; preload exposes only `window.api.invoke(channel, req)` (allow-listed channels) and `window.api.onEvent(fn)`; keys never cross IPC; CSP limits images to `'self' data: webtoon-asset:`.
- **One typed IPC contract** (`src/shared/ipc.ts`) maps channel → request/response types; a compile-time-complete channel list backs the preload allow-list and a test that every channel has a main handler.
- **Event bus**: every service mutation emits an `AppEvent` (`project.changed`, `session.changed`, `character.changed`, `episode.changed`, `panel.changed`, `story.changed`, `models.changed`, `agent.event`); main broadcasts to all windows; renderer stores re-fetch. This is how AI-made variations appear live in the Characters tab.
- **Shared services, two callers**: UI IPC handlers and agent tools call the same `CharacterService` / `PanelService` / `StoryService`, so manual panel creation gets the same validation and prompt composition as agent panels.
- **Assets** are served by a privileged custom protocol `webtoon-asset://<projectId>/<project-relative path>` with a path-traversal guard. Every image file name is unique (version/variation ids + suffix), so no cache busting is needed.
- **Writes** go through `writeFileAtomic` (temp file + rename, EPERM/EBUSY retry) under a per-file `KeyedMutex`. Reads validate with zod; a corrupt file is reported, never crashes the app.
- **No native Node modules.** Image resizing uses Electron `nativeImage` behind an `ImageOps` interface (fake in unit tests). Secrets use Electron `safeStorage` behind an `Encryptor` interface.

## 5. On-disk layout

User data (`app.getPath('userData')`, overridable by env `WEBTOON_USER_DATA`): `models.json` (endpoints, models, roles — no keys), `secrets.json` (base64 of `safeStorage`-encrypted keys, by endpoint id).

Projects root: `<Documents>/Webtoon AI Harness/projects` (overridable by env `WEBTOON_PROJECTS_ROOT`). Each project:

```
<projectsRoot>/<projectId>/
  project.json
  story/bible.md                     # markdown, "## Section" structure
  story/outline.json                 # { beats: Beat[] }
  characters/<chrId>.json
  characters/<chrId>/<varId>_<suffix>.png
  episodes/<epiId>.json
  panels/<pnlId>.json
  panels/<pnlId>/<verId>.png
  panels/<pnlId>.chat.jsonl          # panel side-chat thread
  sessions/<sesId>.jsonl             # main chat transcripts
  uploads/<id>.<ext>                 # images the user attached to chat
  agent/AGENTS.md, agent/workflows/*.md, agent/reference/*.md   # per-project copy of workflow docs
```

All paths stored in JSON are project-relative POSIX paths (forward slashes). IDs are `<prefix>_<10 lowercase hex>`; prefixes: `prj ses chr var epi pnl ver msg run end mdl bt dlg upl`.

## 6. Data model (zod schemas in `src/shared/schemas.ts`; types are `z.infer`)

- **ProjectMeta**: `id, title, logline (""), stylePreset ("Clean full-color Korean webtoon style, crisp line art, soft cel shading, expressive faces"), storyMode ("user"), defaultAspect ("2:3"), autopilotPanels (4), consistencyRetries (1), createdAt, updatedAt`.
- **Character**: `id, name, aliases ([]), role ("protagonist"|"antagonist"|"supporting"|"minor"), characterization {personality, backstory, motivation, speechStyle, relationships: {characterId, relation}[], notes}, appearance {age, gender, build, height, hair, eyes, skin, distinguishingFeatures, defaultOutfit, palette}, appearanceLock, variations: Variation[], archived (false), createdBy ("user"|"ai"), createdAt, updatedAt`. All characterization/appearance strings default to "".
- **Variation**: `id, characterId, name, kind ("base"|"outfit"|"expression"|"pose"|"age"|"form"|"other"), delta (""), imagePath (null), status ("pending"|"ready"|"failed"), error (null), createdBy, createdAt`.
- **Episode**: `id, number, title, synopsis (""), panelIds ([]), createdAt, updatedAt`.
- **Panel**: `id, episodeId, description, setting, shot ("establishing"|"wide"|"medium"|"close-up"|"extreme-close-up"|"over-the-shoulder"|"birds-eye"|"worms-eye"), aspect ("1:1"|"2:3"|"3:4"|"9:16"|"4:3"|"16:9"), characters: PanelCharacter[], dialogue: DialogueLine[], continuityNotes (""), offPanelMentions ([]), versions: PanelVersion[] ([]), currentVersionId (null), createdBy, createdAt, updatedAt`.
- **PanelCharacter**: `characterId, variationId, action (""), expression (""), position ("left"|"center"|"right"|"background", default "center")`.
- **DialogueLine**: `id, speakerId (character id or null), kind ("speech"|"thought"|"narration"|"sfx"), text`.
- **PanelVersion**: `id, source ("generate"|"edit"|"upload"), status, error, imagePath, prompt, referenceImagePaths ([]), instruction (null), parentVersionId (null), check (CheckResult|null), createdAt`.
- **CheckResult**: `passed, issues: string[], skipped (false)`.
- **Beat**: `id, episodeId, summary, status ("planned"|"drawn"|"dropped"), createdAt`.
- **ChatMessage** (discriminated on `role`):
  - user: `id, text, imagePaths ([]), stateSnapshot (string|null), createdAt`
  - assistant: `id, text, toolCalls: {id, name, input}[], stopReason ("end"|"tool_use"|"max_tokens"|"refusal"), model {endpointId, modelId}, raw ({provider: "anthropic", content: unknown[]} | null), createdAt`
  - tool: `id, results: {toolCallId, name, ok, content, images: string[]}[], createdAt`
- **Models file**: `endpoints: EndpointConfig[], models: ModelConfig[], roles: RoleAssignments`.
  - EndpointConfig: `id, name, kind ("anthropic"|"openai"|"gemini"|"mock"), baseUrl, options {serverSideFallback?: boolean}`.
  - ModelConfig: `id, endpointId, modelId, label, capabilities: ("text"|"vision"|"image-gen"|"image-edit")[], params (Record<string, unknown>, {}), maxReferenceImages (4)`.
  - RoleAssignments: optional model id per role.

## 7. Models, endpoints, providers

- **Endpoint kinds and what each serves**:
  - `anthropic` → text (+vision) via the official `@anthropic-ai/sdk`.
  - `openai` → text via Chat Completions with configurable base URL (covers OpenAI, OpenRouter, Ollama, LM Studio, vLLM, Gemini's OpenAI-compatible endpoint) using the `openai` SDK; images via the Images API (`images.generate`; `images.edit` with up to 16 input images, multipart).
  - `gemini` → images only, via the Interactions API (`POST {baseUrl}/v1beta/interactions`, header `x-goog-api-key`, input blocks `{type:"text"}` / `{type:"image", mime_type, data}`, `response_format {type:"image", mime_type, aspect_ratio}`; output image is the last `type:"image"` block in `steps[].content[]`, or `output_image.data`).
  - `mock` → offline scripted text model and placeholder-image model (always available, seeded on first run).
- **Presets** in "Add endpoint" (editable): Anthropic `https://api.anthropic.com` (suggested models `claude-opus-5-5`, `claude-sonnet-5-5`, `claude-haiku-5-5`); OpenAI `https://api.openai.com/v1` (suggested image model `gpt-image-2`); Google Gemini `https://generativelanguage.googleapis.com` (suggested `gemini-3.1-flash-image`, `gemini-3-pro-image`); OpenRouter `https://openrouter.ai/api/v1`; Ollama `http://localhost:11434/v1`; LM Studio `http://localhost:1234/v1`. Model ids are user-editable text; nothing beyond these suggestions is hardcoded.
- **Per-model `params`** are merged into provider requests (e.g. `{"effort":"high"}` for Anthropic, `{"quality":"high"}` or `{"input_fidelity":"high"}` for OpenAI image models that support it — `gpt-image-2` must omit `input_fidelity`).
- **Roles**: `agent` (requires `text`), `panelChat` (requires `text`; falls back to `agent`), `vision` (requires `vision`; optional — unset disables the consistency check), `image` (requires `image-gen`), `imageEdit` (requires `image-edit`; falls back to `image`). Removing a model or endpoint clears the roles that pointed at it and the UI says which; running with an unassigned role fails with "No model assigned to role '<role>'. Open Settings → Models."
- **Anthropic adapter rules** (from the Claude API reference, 2026-10): default model `claude-opus-5-5`; stream with `.stream(...)` + `finalMessage()`, forwarding text deltas; `max_tokens: 64000`; `output_config.effort` set explicitly (`params.effort ?? "high"`); omit `thinking` (adaptive by default); `tool_choice` never forced (auto only); tools carry `eager_input_streaming: true` and inputs are validated with zod before execution; top-level `cache_control: {type:"ephemeral"}`; check `refusal` and `max_tokens` stop reasons before running tools; server-side refusal fallback `fallbacks: "default"` with beta `server-side-fallback-2026-07-01` via `client.beta.messages.stream`, enabled by default only when the base URL is `https://api.anthropic.com` and the model id starts with `claude-opus-5`, `claude-sonnet-5`, or `claude-fable-5` (endpoint option can turn it off). Assistant content is replayed **unchanged** (thinking blocks included) from `raw`; after a `fallback` block, `thinking`, `redacted_thinking` and `tool_use` blocks that appear before the last `fallback` block are omitted from replay and never executed. Transcripts are append-only; any future "rewind" must fork into a new session, never edit history.

## 8. Agent

- **Loop** (`runAgentLoop`, shared by main chat and panel side chat): send transcript → persist assistant message → if refusal/max_tokens/no tool calls, stop → execute tool calls sequentially (zod-validated; errors become `ok:false` results) → persist one tool message containing a result for **every** tool call (cancelled ones get `"Cancelled by user"`) → repeat; max 24 steps. One active run per session (and per panel thread). Stop button aborts via `AbortSignal`.
- **System prompt** is stable across turns (cache-friendly): the project's `agent/AGENTS.md` + an index of the other docs (name + title) + tool-use instructions. Detailed docs are fetched with `read_workflow_doc`.
- **State snapshot**: each new user message stores a compact `<project_state>…</project_state>` block (title, story_mode, style, current episode, roster with variation ids/status, last 3 panels' summaries) that is sent ahead of the user's text. It is persisted with the message, so replays are byte-identical.
- **Main agent tools**: `get_story`, `update_story_bible`, `add_beats`, `update_beat`, `list_characters`, `get_character`, `create_character`, `update_character`, `create_variation`, `regenerate_variation`, `list_episodes`, `create_episode`, `list_panels`, `get_panel`, `view_panel_image` (only when the agent model has `vision`), `create_panel`, `update_panel`, `regenerate_panel`, `edit_panel_image`, `read_workflow_doc`. The agent has **no delete tools**; deletion is a user action.
- **Panel side-chat tools** (bound to one panel; no panel id in inputs): `get_panel_context`, `view_current_image` (vision only), `update_panel_fields`, `regenerate_image`, `edit_image`, `revert_to_version`. Each user message stores a `<panel_context>` snapshot (panel fields, version label, cast, previous/next panel summaries). System prompt = AGENTS.md "Hard Rules" section + `workflows/panel-editing.md`.

## 9. Consistency pipeline (enforced in code, explained in docs)

1. **Cast selection** is explicit: `create_panel` takes `characters: [{characterId, variationId, action, expression, position}]`.
2. **Validation** (`validatePanelDraft`) rejects: unknown or archived characters; a variation that does not belong to the character; a variation whose reference image is not `ready`; duplicate cast entries; dialogue speakers not in the roster. **Mention guard**: a roster name or alias (whole word, case-insensitive) in the description that is neither in the cast nor in `offPanelMentions` is an error for the agent (strict) and a warning in the manual editor.
3. **Prompt composition** (`composePanelPrompt`, pure) builds the exact template below and an ordered reference list: each cast member's variation image (cast order), then the previous panel's current image. When references exceed the image model's `maxReferenceImages`, the previous panel is dropped first, then cast members from the end; dropped entries are marked "(no reference image)".

```
[STYLE] {stylePreset}. Vertical-scroll webtoon panel, {aspect} aspect ratio, {shot} shot. No text, no speech bubbles, no captions, no watermark.
[SETTING] {setting}
[ACTION] {description}
[CHARACTERS]
- {name} (reference image {n}): {appearanceLock} Look: {variation.name} — {variation.delta}. Action: {action}. Expression: {expression}. Position: {position}.
[CONTINUITY] Continues directly from the previous panel (reference image {m}). Keep setting layout, lighting, time of day and outfits consistent. {continuityNotes}
```

   Dialogue never enters the image prompt; it is rendered as HTML over the panel.
4. **Generation** uses the `image` role with references; every attempt is a new `PanelVersion` storing the composed prompt and reference paths.
5. **Vision check** (when `vision` role is set): the generated image + references go to the vision model with `reference/consistency-checklist.md` as instructions; it returns `{"passed": bool, "issues": [...]}`. On failure the panel is regenerated up to `consistencyRetries` (default 1) times with "Fix these consistency issues: …" appended; every attempt stays in history; the last passing (else last) attempt becomes current. Images sent to text/vision models are downscaled to ≤1568 px on the long edge; reference images sent to image models to ≤1536 px.
6. **Character base reference**: created with prompt "Character reference sheet … full body, front view, neutral expression, plain light-gray background … {appearanceLock}". Non-base variations use the base image as a reference plus "{appearanceLock} Variation: {name} — {delta}. Keep face, hair, body and colors identical to the reference except for the variation."

## 10. Story direction

- `story/bible.md` with default sections `## Premise`, `## World`, `## Tone`, `## Characters & Relationships`, `## Arcs`, `## Open Threads`; `update_story_bible({section, content})` replaces or appends one section.
- `story/outline.json` beats per episode (`add_beats`, `update_beat`).
- **User-led** (`storyMode: "user"`): the agent executes the user's direction, may propose 2–3 options when asked or when the direction is ambiguous, and never introduces major plot events, new named characters, or deaths without the user's approval.
- **AI-led** (`storyMode: "ai"`): the agent decides the story. "Continue story" sends exactly: `Continue the story (AI-led): plan the next beats and draw the next {autopilotPanels} panels.` The agent adds beats, draws that many panels, updates the bible, then stops and summarizes.

## 11. Workflow docs (the regulating .md files)

Shipped in `resources/agent-docs/`, copied into each project's `agent/` on creation (missing files only), editable per project, resettable. Total length ≥ 1,200 lines. Required `##` sections (a lint test checks them):

| File | Required sections | Must cover |
|---|---|---|
| `AGENTS.md` (always in system prompt) | Mission · Operating Loop · Story Modes · Hard Rules · Tool Catalog · Workflow Docs Index · Communication Style · Failure Handling | Hard rules **R1–R12** (below); every tool listed with when-to-use; which doc to read before which task. |
| `workflows/story-direction.md` | Purpose · User-Led Mode · AI-Led Mode · Story Bible · Beats and Outline · Episode Structure · Vertical Pacing · Continuity Across Sessions · Conflicts and Retcons · Examples | Mode behaviors, autopilot loop, hook/rising/cliffhanger episode shape, how to propose options, how to resolve user-vs-bible conflicts. |
| `workflows/character-creation.md` | Purpose · Character Sheet · Writing the Appearance Lock · Base Reference Image · Variations · Variation Naming · When Not to Create a Variation · Automating Creation from Chat · Updating Characters · Examples | Appearance lock rules (40–90 words; concrete visual tokens in fixed order: age/build → face → hair → eyes → skin → marks → default outfit → palette; no personality or camera words); variation kinds and naming (`Outfit: School uniform`); per-panel expressions are text, not variations; interview-or-brief automation flow. |
| `workflows/panel-generation.md` | Purpose · Pipeline · Selecting the Cast · Choosing Variations · Using the Previous Panel · Shot and Aspect Selection · Writing the Description · Dialogue and SFX · Off-Panel Mentions · Reading the Consistency Check · Examples | The 10-step pipeline (read state → choose beat → cast → variations (keep previous panel's variation unless the story changes it) → shot/aspect → description without appearance → continuity notes → dialogue → `create_panel` → read check and fix/report); max 3 foreground characters; unnamed extras described generically. |
| `workflows/panel-editing.md` | Purpose · Scope · Edit vs Regenerate · Preserving Identity · Versions and Revert · Dialogue-Only Changes · Reporting Changes · Examples | Side-chat scope is one panel; `edit_image` for local changes, `regenerate_image` for composition changes; dialogue edits need no image call. |
| `reference/webtoon-style-guide.md` | Format · Panel Aspects · Shot Vocabulary · Pacing and Gutters · Dialogue Conventions · Color and Lighting Continuity · Genre Notes | Vertical reading, when to use each aspect/shot, ≤2 bubbles and ≤25 words per bubble. |
| `reference/prompt-templates.md` | Panel Prompt · Base Reference Prompt · Variation Prompt · Panel Edit Prompt · Consistency Check Prompt | Mirrors the code templates (§9), including the `[STYLE] [SETTING] [ACTION] [CHARACTERS] [CONTINUITY]` markers. |
| `reference/consistency-checklist.md` | Checklist · Output Format · Severity · Retry Guidance | Used verbatim as the vision checker's instructions; output is one JSON object `{"passed": boolean, "issues": string[]}`. |

**Hard rules (AGENTS.md, numbered R1–R12):**
R1 Roster first — never depict a named character who is not in the roster; create them first. ·
R2 Attach, don't describe — every visible named character is attached by id + variation; descriptions never restate appearance. ·
R3 The appearance lock is sacred — change it only on explicit user request; show changes with variations. ·
R4 Read before you draw — read recent panels before `create_panel`; continue from the previous panel. ·
R5 One beat per panel. ·
R6 No text in images — dialogue, narration and SFX go in `dialogue`. ·
R7 Respect the story mode. ·
R8 Never destroy work — no delete tools; edits create versions. ·
R9 Keep the bible current after major events. ·
R10 Declare off-panel mentions in `offPanelMentions`. ·
R11 Verify and report — read every tool result, including the consistency check; fix or report. ·
R12 Stop when blocked — a missing model role, or the same tool failing twice, ends the turn with a clear message to the user.

## 12. Errors and edge cases

- Image calls time out after 180 s; failures set the variation/version to `failed` with the error; a previously good current version stays current; Retry is offered in the UI.
- On project open, any `pending` variation/version is marked `failed` with "Interrupted: the app closed during generation".
- Archive instead of delete for characters used by any panel; archived characters can't be cast in new panels but existing panels still render. Variations used by panels can't be deleted.
- Corrupt JSON files are listed as project problems (toast) and skipped; JSONL transcripts ignore an unparsable trailing line.
- Cancel mid-run leaves a valid transcript (every tool call has a result).
- Paths with spaces (the dev folder itself has spaces) work in the asset protocol.

## 13. Testing

- **Vitest**: `main` project (Node env) for storage, services, prompts, validation, adapters (injected fake SDK clients / fetch with recorded fixtures), loop, tools; `renderer` project (jsdom + Testing Library) for components with a fake `window.api`.
- **Playwright `_electron`** end-to-end against the built app with env `WEBTOON_USER_DATA`, `WEBTOON_PROJECTS_ROOT` (temp dirs) and `WEBTOON_MOCK_SCRIPT` (scripted mock agent turns). The seeded mock endpoint makes every flow runnable offline.

## 14. Out of scope for v1

Exporting a stitched long image or publishing; packaging/installers and auto-update; real-time collaboration; inpainting masks UI; per-token cost tracking; a Gemini text adapter (use Gemini's OpenAI-compatible endpoint); session rewind/fork; bubble positioning by drag.

## 15. Decisions made without asking (please review)

1. Panels belong to episodes; the visualizer shows one episode at a time.
2. Story mode is a two-way toggle (user-led / AI-led) stored on the project.
3. The "character window" is the Characters tab of the right pane, not a separate OS window.
4. The panel side chat opens inside the middle column, beside the main chat.
5. Dialogue is data rendered as HTML bubbles; images are generated without text.
6. Image providers in v1: OpenAI Images, Gemini (Interactions API), mock. Text providers: Anthropic, any OpenAI-compatible API, mock.
7. Anthropic server-side refusal fallback is on by default for supported models on api.anthropic.com (toggle per endpoint).
8. A vision consistency check with one automatic retry runs when a `vision` model is assigned.
9. The agent cannot delete anything; deletions go to the OS trash.
10. Project data is plain files (JSON/JSONL/PNG/MD) in a folder per project; no database.
