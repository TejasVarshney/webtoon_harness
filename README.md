# Webtoon AI Harness

A desktop app (Electron + React + TypeScript) where an AI agent co-creates a vertical-scroll webtoon with you. You chat with the agent in the middle pane; it develops the story, builds characters with reference images, and draws panels one beat at a time. The right pane shows the result as a webtoon strip, the character studio, and the story bible. Click any panel to open it in an editor, with its own chat, that keeps every image version.

Everything runs on your machine. Model calls are made by the app's main process, projects are plain folders of JSON, markdown and PNG files, and the app works offline on a built-in mock model until you add real endpoints.

## Prerequisites

- Node.js 22 or newer (developed on Node 24) and npm.
- Windows, macOS or Linux with a desktop session (Electron needs a display).
- For real models: an API key for at least one text provider (Anthropic, or any OpenAI-compatible server) and one image provider (OpenAI, Google Gemini, or an OpenAI-compatible image server).

## Install and run

```bash
npm install
npm run dev
```

`npm run dev` starts the app with hot reload. Other scripts: `npm run build` (bundle into `out/`), `npm run typecheck`, `npm test`, `npm run test:e2e` (see [Tests](#tests)).

## First run on the mock models

A fresh install is seeded with an offline **Mock (offline)** endpoint, so nothing needs configuring to try the app. A banner in the chat header says the mock model is in use.

1. Click **New project** in the left pane and give it a title.
2. Click **New session** and type a message. Without a script, the mock text model replies `(mock) <your text>`.
3. Image calls on the mock return small solid-color PNGs, so panels and characters appear with placeholder images.

To see the whole agent flow offline, point `WEBTOON_MOCK_SCRIPT` at a JSON file of scripted replies before launching. Each turn is one model reply: text, tool calls, or both. A turn with tool calls runs the tools, and the agent's next turn is the next entry.

```json
{
  "turns": [
    {
      "toolCalls": [
        { "name": "create_character", "input": { "name": "Mina", "role": "protagonist", "appearanceLock": "Teenage girl, silver bob haircut, amber eyes, red bomber jacket." } }
      ]
    },
    { "text": "Created Mina." }
  ]
}
```

```bash
WEBTOON_MOCK_SCRIPT=./mock-script.json npm run dev
```

(In PowerShell: `$env:WEBTOON_MOCK_SCRIPT = ".\mock-script.json"; npm run dev`.)

The script has one cursor for the whole app: every run, main chat or panel chat, takes the next unused turn, and once the script is exhausted the mock goes back to `(mock) <your text>`. Tool inputs can use placeholders instead of real ids: `{"$character": "Mina"}`, `{"$variation": ["Mina", "Base"]}` and `{"$episode": "current"}`. They are resolved from the project state that was sent with the user's message, so a character has to be created in an earlier message than the one whose panels cast it. `tests/e2e/full-flow.spec.ts` is a complete worked example.

## Connect real models

Open **Settings** (bottom of the left pane) and choose **Models**. Add an endpoint, give it an API key, add its models, then assign models to roles.

1. **Add endpoint.** Pick a preset (Anthropic, OpenAI, Google Gemini, OpenRouter, Ollama, LM Studio) or fill in a custom name, kind and base URL. The Anthropic, OpenAI and Gemini presets offer suggested models, which you can untick.
2. **Set key.** Paste the API key in the form, or use **Set key** later. **Test** next to a text model sends a tiny request to check the connection; for a model without the text capability it only checks that a key is set.
3. **Assign roles** in the Roles section at the top.

An endpoint has a kind, and the kind decides which capabilities its models may have:

| Kind | Can serve | Presets |
| --- | --- | --- |
| `anthropic` | text, vision | Anthropic (`claude-opus-5-5`, `claude-sonnet-5-5`, `claude-haiku-5-5`) |
| `openai` | text, vision, image-gen, image-edit | OpenAI (`gpt-image-2`), OpenRouter, Ollama, LM Studio |
| `gemini` | image-gen, image-edit | Google Gemini (`gemini-3.1-flash-image`, `gemini-3-pro-image`) |

Anthropic cannot draw, so a working setup needs an image model from an `openai` or `gemini` endpoint. A typical one is Anthropic for the text roles plus OpenAI or Gemini for the image roles.

| Role | Needs | If unassigned | Used for |
| --- | --- | --- | --- |
| `agent` | text | none: chat shows "No model assigned to role 'agent'. Open Settings → Models." | The main chat. The default and recommended model is `claude-opus-5-5`. |
| `panelChat` | text | uses `agent` | The chat of a panel open in the editor. A cheaper, faster model is fine. |
| `vision` | vision | none: no consistency check | The consistency check (below). |
| `image` | image-gen | none: image calls fail with a clear message and a Retry | Character and panel images. |
| `imageEdit` | image-edit | uses `image` | Editing a panel's current image from its panel chat. |

**Edit endpoint** changes an endpoint's name, base URL and timeout (see [Slow providers](#slow-providers)). Moving the base URL to another host clears the endpoint's stored key, so a key is never sent to a server it was not entered for; the Settings screen says "Key cleared because the host changed", and you set the key again. Removing an endpoint or model that is assigned to a role clears that role and tells you which. The model form also takes a JSON `params` object; for Anthropic text models `{"effort": "high"}` is the default and `low`, `medium`, `high`, `xhigh` and `max` are accepted. **Max reference images** (`maxReferenceImages`) caps how many reference images are sent with one image request. It is read at every draw, so a new value applies to the next panel drawn with the model in the `image` role. When drawing a panel would go over it, the app first stitches cast sheets onto one image, each under the character's name, and sends that as one reference: as few sheets as it takes, two to four, from the end of the cast. A lower cap stitches more; at 1, a cast of two to four goes on that one image and nothing else is sent. Only what still does not fit is dropped. Edits never stitch, so a low cap also leaves out cast and item sheets from a panel edit, unless the `imageEdit` role has a model of its own.

### Consistency check (vision role)

Assign a vision-capable model to the `vision` role to turn on the consistency check. After every panel image is generated, that model compares it with the cast's reference images and the panel's description, and reports whether the characters, outfits and continuity hold. A failed check redraws the panel with the issues added to the prompt. The number of extra attempts is the project's `consistencyRetries` (default `1`, so at most two versions per draw); `0` checks without redrawing. It is stored in the project's `project.json`, which has no settings screen: edit it with the app closed. With no `vision` model assigned, panels are never checked. The checker's instructions are the project's `agent/reference/consistency-checklist.md` (see [Workflow docs](#workflow-docs)).

### API keys

Keys are entered in the Models settings, then encrypted by the main process with the operating system's secret storage through Electron `safeStorage` (Windows DPAPI, macOS Keychain, Linux libsecret) and saved as ciphertext in `secrets.json` in the app's user-data folder. A key never reaches the renderer: the interface only learns whether a key is set ("Key set" or "No key"), and every network call is made in the main process. If the system cannot encrypt (for example Linux without a keyring), saving a key is refused instead of storing it in the clear. A `secrets.json` copied to another machine or user cannot be decrypted; enter the keys again.

The user-data folder is Electron's per-user data folder for the app, for example `%APPDATA%\Webtoon AI Harness` on Windows. It also holds `models.json` (endpoints, models and role assignments, without keys). If you edit `models.json` by hand, do it with the app closed: the app keeps it in memory and rewrites it whenever you change an endpoint, a model or a role in Settings (setting or clearing a key writes only `secrets.json`). Set `WEBTOON_USER_DATA` to use another folder.

### Server-side refusal fallback

For supported Anthropic models the app asks the API to retry on a fallback model, on the server, when the model refuses a request. This is **on by default** when both hold:

- the endpoint's base URL is `https://api.anthropic.com` (a trailing slash is fine), and
- the model id starts with `claude-opus-5`, `claude-sonnet-5` or `claude-fable-5`.

Other models (such as `claude-haiku-5-5`) and other base URLs, including proxies, never use it.

To turn it off for an endpoint, open **Settings → Models**, choose **Edit endpoint** on that endpoint and clear **Server-side refusal fallback** (it is on unless you clear it). The switch is stored in `models.json` as `serverSideFallback` in the endpoint's `options`:

```json
{
  "id": "end_0123456789",
  "name": "Anthropic",
  "kind": "anthropic",
  "baseUrl": "https://api.anthropic.com",
  "options": { "serverSideFallback": false }
}
```

### Slow providers

One image draw, and one consistency check, may take 180 seconds by default. A draw that takes longer fails with "Image generation timed out after 180s" and a Retry; a check that takes longer counts as passed and skipped. The limit counts from when the app sends the request, so time the server spends with the request waiting in its own queue counts too.

For a slower endpoint, such as a local image server on a small GPU or a bridge that serves one request at a time, raise its limit: open **Settings → Models**, choose **Edit endpoint** and set **Image and check timeout (seconds)**, a whole number from 10 to 3600. Leave it empty for the default. The limit applies to the image draws of the endpoint's image models and to the checks of its vision model; agent turns are not affected. It is stored in `models.json` as `timeoutSeconds` in the endpoint's `options`:

```json
{
  "id": "end_0123456789",
  "name": "Local image server",
  "kind": "openai",
  "baseUrl": "http://127.0.0.1:7870/v1",
  "options": { "timeoutSeconds": 600 }
}
```

### OpenAI-compatible local servers

Any server that speaks the OpenAI API can be added as an endpoint of kind `openai`. The Ollama (`http://localhost:11434/v1`) and LM Studio (`http://localhost:1234/v1`) presets fill in the base URL for you. Local servers need no real API key; leave the key empty. Add each model yourself with the capabilities it really has. The `agent` and `panelChat` roles need a model that supports tool calling, and `vision` needs one that accepts images. An OpenAI-compatible image server can serve `image` and `imageEdit` the same way.

For a ready-made fully local setup (gemma4 on Ollama for the agent, a local SDXL webtoon pipeline for images, in a sandboxed data folder), see [tools/local-models/README.md](tools/local-models/README.md) and run `npm run local:start`.

## Project folder layout

Projects live under the projects folder, by default `Documents/Webtoon AI Harness/projects` (change it with `WEBTOON_PROJECTS_ROOT`). Each project is one folder named after its id. All paths stored inside the files are relative to the project folder. Exported episodes go to an `Exports` folder next to the projects folder (see [Export](#export)).

```text
prj_0123456789/
  project.json            title, style preset, story mode, default aspect, autopilotPanels, consistencyRetries
  agent/                  this project's copy of the workflow docs (editable)
    AGENTS.md
    workflows/            character-creation, item-creation, panel-generation, panel-editing, story-direction
    reference/            consistency-checklist, sheet-checklist, prompt-templates, webtoon-style-guide
  story/
    bible.md              the story bible (markdown, one ## section per topic)
    outline.json          the beat outline
  characters/
    chr_xxxxxxxxxx.json   one character: appearance lock, variations
    chr_xxxxxxxxxx/       its reference images, one per variation attempt
  items/
    itm_xxxxxxxxxx.json   one item: appearance lock, owner, usages
    itm_xxxxxxxxxx/       its reference images, one per usage attempt
  episodes/
    epi_xxxxxxxxxx.json   episode title, synopsis, ordered panel ids
  panels/
    pnl_xxxxxxxxxx.json   one panel: description, cast, dialogue, every image version
    pnl_xxxxxxxxxx/       its images, one per version
    pnl_xxxxxxxxxx.chat.jsonl   the panel's side-chat transcript
  sessions/
    ses_xxxxxxxxxx.jsonl  one chat session, append-only
  uploads/                images you attach in chat
```

Dialogue is stored as data and drawn over the image by the app; generated images contain no text. Everything you delete in the app goes to the operating system's trash, and the agent has no delete tools: characters used by panels are archived instead of deleted, and every image attempt is kept as a version. A project file that was hand-edited into invalid JSON is reported as a problem and left untouched, and the project still opens.

In the panel editor you can letter a panel yourself. **Add bubble** on the stage offers speech, shout, whisper, thought, caption and sound-effect bubbles. Under a line in the **Lines** tab you can change its font, size, colors and outline, and **Reset style** puts it back. To point a bubble's tail, drag the dot at its tip; moving the bubble leaves the tip where it is. Drag the handles on a bubble's sides to set its width, and its text wraps to it. Export draws the same look as the stage.

## Workflow docs

The agent's behavior is governed by markdown files, not hard-coded prompts. The shipped defaults live in `resources/agent-docs`, and each project gets its own copy in its `agent/` folder. `agent/AGENTS.md` is the agent's system prompt, and the files under `workflows/` and `reference/` are read on demand through the `read_workflow_doc` tool.

To change how the agent works in one project, edit the files in that project's `agent/` folder. **Settings → Workflow docs** lists them and opens a file in your editor; the agent follows your version from its next message. **Reset all to defaults** (after a confirmation) overwrites the project's copies with the shipped ones. Files a project is missing are copied in when it is opened; existing files are never replaced except by a reset.

Two files are more than prose. `reference/consistency-checklist.md` is the consistency checker's system prompt, and it must keep ending with its JSON output contract (`{"passed": true|false, "issues": [...]}`). `reference/prompt-templates.md` mirrors the prompts the app builds. When you change the shipped docs in `resources/agent-docs`, the lint tests in `src/main/agent/workflow-docs.lint.test.ts` check every example tool call against the real tool schemas and compare the prompt templates with the code.

## Claude Code link

The built-in Claude Code plugin lets Claude Code (or any MCP client) work on your project through the same tools the in-app agent uses. It is off by default.

1. Open **Settings → Plugins** and switch on **Claude Code**. The status line reads `Listening on 127.0.0.1:<port>`; the default port is `7880`, and you can change it (1024-65535) and press **Save port**, which restarts the link.
2. Press **Copy command** and paste it into a terminal. It has this shape:

```bash
claude mcp add --transport http webtoon http://127.0.0.1:<port>/mcp --header "Authorization: Bearer <token>"
```

3. Claude Code now sees the harness tools as `mcp__webtoon__*`. Each call is logged in a session titled "Claude Code" (marked "Driven by Claude Code"), so you can follow what it did.

Image tools wait for the image, so one call can take minutes. Claude Code's default MCP tool timeout can cut such a call off; set `MCP_TOOL_TIMEOUT` (milliseconds) in the environment that starts `claude`, for example `$env:MCP_TOOL_TIMEOUT = "900000"` for 15 minutes, the value the app uses for its own Claude Code runs.

The [Claude Code plugin](integrations/claude-code-plugin/README.md) in `integrations/` adds the same server together with a skill and commands; its tools are named `mcp__plugin_webtoon-harness_webtoon__*`. Use either `claude mcp add` or the plugin, not both: with both, Claude Code connects twice and every tool appears twice.

The link only acts on the project that is open in the app window; with no project open, calls fail with "Open a project in the Webtoon AI Harness window first." It listens on `127.0.0.1` only and every request needs the token (stored in the app's secret store). **Regenerate token** in Settings → Plugins disconnects every client that has the old one.

## Story modes

The chat header has a story-mode switch. In **User-led** mode the agent follows your story. In **AI-led** mode it decides what happens next, and a **Continue story** button appears: it asks the agent to plan the next beats and draw the project's `autopilotPanels` panels (default `4`, set in `project.json`).

## Export

Press **Export** in the episode bar to open the **Export episodes** dialog. Tick the episodes you want, pick a **Format**, and press **Export**. The button is disabled while the project has no episodes, and the dialog starts with the active episode ticked.

| Format | What you get |
| --- | --- |
| **Webtoon upload (JPEG slices)** | 800 px wide slices, each at most 1280 px tall, as JPEG or PNG (**Image type**). |
| **Long image** | One image per episode, JPEG or PNG. An episode taller than 65,000 px is split into numbered parts. **Image type** applies here too. |
| **PDF for reading** | 800×1280 px images on 600×960 pt pages, with no margin. |
| **PDF for print** | **Paper** (A4 or Letter; shown for this format only) with 36 pt margins, always at 2× resolution, and pages break between rows. |
| **CBZ (comic readers)** | Pages up to 1280 px tall that break between rows, with a `ComicInfo.xml` for the reader. |

Set **Resolution** to **High** to double the pixels, so slices are 1600 px wide. **Resolution** is shown for every format except **PDF for print**, which is always High.

**Without lettering** exports the art alone, with no dialogue or captions drawn over it.

A panel counts as finished when its current version is ready. If a ticked episode has unfinished panels, the dialog lists them, and **Export anyway** leaves them out. If no ticked episode has a finished panel, there is nothing to export.

**Combine into one file** appears for **PDF for reading**, **PDF for print** and **CBZ** when you tick two or more episodes. Without it, each episode gets its own file.

When you press **Export**, a save dialog asks where to put the result. It starts in the `Exports` folder next to the projects folder. You pick a file when the export is a single file and a folder when it is several, such as slices or one file per episode. If an output already exists, it is replaced only after the export succeeds, and the old one goes to the operating system's trash. **Cancel** stops the export and removes any partial files. When it finishes, **Show in folder** opens the result.

## Environment overrides

| Variable | Effect |
| --- | --- |
| `WEBTOON_USER_DATA` | Electron user-data folder: `models.json`, `secrets.json` and Electron's own state. |
| `WEBTOON_PROJECTS_ROOT` | Folder that holds the project folders. |
| `WEBTOON_MOCK_SCRIPT` | Path to a mock script (see [First run](#first-run-on-the-mock-models)); only the mock model reads it. |
| `WEBTOON_EXPORT_TARGET` | Test hook: a folder that replaces the export save dialog. Exports go straight into it. |
| `WEBTOON_LIVE_LOCAL` | Set to `1` to run the live tests against the local stack (gemma4 on Ollama and the SDXL bridge). Start both first. |
| `WEBTOON_LIVE_BRIDGE` | Set to `1` to run the live item flow on the ChatGPT bridge. It uses the ChatGPT account behind the bridge and takes about 15 minutes. |
| `WEBTOON_LIVE_CLAUDE` | Set to `1` to run the live test of Claude Code as the agent. It spends a little of the signed-in account's usage. |
| `WEBTOON_MCP_TOKEN` | Read by the [Claude Code plugin](integrations/claude-code-plugin/README.md), not the app: the link's token, from the copied command. |
| `WEBTOON_MCP_PORT` | Read by the [Claude Code plugin](integrations/claude-code-plugin/README.md), not the app: the link's port, if you changed it from `7880`. |

The end-to-end tests point `WEBTOON_USER_DATA` and `WEBTOON_PROJECTS_ROOT` at throwaway folders, and set `WEBTOON_MOCK_SCRIPT` (a file, not a folder) to a temporary script only in the tests that script the mock; without one, the mock model answers each message with `(mock) <your text>`.

## Tests

```bash
npm run typecheck   # both TypeScript projects (main/preload/shared/tests and the renderer)
npm test            # Vitest: main process and renderer unit tests
npm run test:e2e    # builds the app, then runs the Playwright end-to-end tests against it
```

The end-to-end tests launch the real Electron app on the offline mock models with temporary user-data and projects folders, so they need no keys and no network. They open real windows. To run one spec, build first and then run Playwright directly:

```bash
npm run build
npx playwright test tests/e2e/full-flow.spec.ts
```

`tests/e2e/full-flow.spec.ts` is the full-product check: story bible, characters, variations, panels, a side-chat edit, AI-led continuation, and a relaunch that finds everything again. For a single unit test file, use `npx vitest run <path>`.
