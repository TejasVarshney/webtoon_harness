# Webtoon AI Harness

A desktop app (Electron + React + TypeScript) where an AI agent co-creates a vertical-scroll webtoon with you. You chat with the agent in the middle pane; it develops the story, builds characters with reference images, and draws panels one beat at a time. The right pane shows the result as a webtoon strip, the character studio, and the story bible. Select any panel to edit it in a side chat that keeps every image version.

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

The script has one cursor for the whole app: every run, main chat or panel side chat, takes the next unused turn, and once the script is exhausted the mock goes back to `(mock) <your text>`. Tool inputs can use placeholders instead of real ids: `{"$character": "Mina"}`, `{"$variation": ["Mina", "Base"]}` and `{"$episode": "current"}`. They are resolved from the project state that was sent with the user's message, so a character has to be created in an earlier message than the one whose panels cast it. `tests/e2e/full-flow.spec.ts` is a complete worked example.

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
| `panelChat` | text | uses `agent` | The side chat on a selected panel. A cheaper, faster model is fine. |
| `vision` | vision | none: no consistency check | The consistency check (below). |
| `image` | image-gen | none: image calls fail with a clear message and a Retry | Character and panel images. |
| `imageEdit` | image-edit | uses `image` | Editing a panel's current image from the side chat. |

**Edit endpoint** changes an endpoint's name and base URL. Moving the base URL to another host clears the endpoint's stored key, so a key is never sent to a server it was not entered for; the Settings screen says "Key cleared because the host changed", and you set the key again. Removing an endpoint or model that is assigned to a role clears that role and tells you which. The model form also takes a JSON `params` object; for Anthropic text models `{"effort": "high"}` is the default and `low`, `medium`, `high`, `xhigh` and `max` are accepted. `maxReferenceImages` caps how many reference images are sent with one image request.

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

### OpenAI-compatible local servers

Any server that speaks the OpenAI API can be added as an endpoint of kind `openai`. The Ollama (`http://localhost:11434/v1`) and LM Studio (`http://localhost:1234/v1`) presets fill in the base URL for you. Local servers need no real API key; leave the key empty. Add each model yourself with the capabilities it really has. The `agent` and `panelChat` roles need a model that supports tool calling, and `vision` needs one that accepts images. An OpenAI-compatible image server can serve `image` and `imageEdit` the same way.

## Project folder layout

Projects live under the projects folder, by default `Documents/Webtoon AI Harness/projects` (change it with `WEBTOON_PROJECTS_ROOT`). Each project is one folder named after its id. All paths stored inside the files are relative to the project folder.

```text
prj_0123456789/
  project.json            title, style preset, story mode, default aspect, autopilotPanels, consistencyRetries
  agent/                  this project's copy of the workflow docs (editable)
    AGENTS.md
    workflows/            character-creation, panel-generation, panel-editing, story-direction
    reference/            consistency-checklist, prompt-templates, webtoon-style-guide
  story/
    bible.md              the story bible (markdown, one ## section per topic)
    outline.json          the beat outline
  characters/
    chr_xxxxxxxxxx.json   one character: appearance lock, variations
    chr_xxxxxxxxxx/       its reference images, one per variation attempt
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

## Workflow docs

The agent's behavior is governed by markdown files, not hard-coded prompts. The shipped defaults live in `resources/agent-docs`, and each project gets its own copy in its `agent/` folder. `agent/AGENTS.md` is the agent's system prompt, and the files under `workflows/` and `reference/` are read on demand through the `read_workflow_doc` tool.

To change how the agent works in one project, edit the files in that project's `agent/` folder. **Settings → Workflow docs** lists them and opens a file in your editor; the agent follows your version from its next message. **Reset all to defaults** (after a confirmation) overwrites the project's copies with the shipped ones. Files a project is missing are copied in when it is opened; existing files are never replaced except by a reset.

Two files are more than prose. `reference/consistency-checklist.md` is the consistency checker's system prompt, and it must keep ending with its JSON output contract (`{"passed": true|false, "issues": [...]}`). `reference/prompt-templates.md` mirrors the prompts the app builds. When you change the shipped docs in `resources/agent-docs`, the lint tests in `src/main/agent/workflow-docs.lint.test.ts` check every example tool call against the real tool schemas and compare the prompt templates with the code.

## Story modes

The chat header has a story-mode switch. In **User-led** mode the agent follows your story. In **AI-led** mode it decides what happens next, and a **Continue story** button appears: it asks the agent to plan the next beats and draw the project's `autopilotPanels` panels (default `4`, set in `project.json`).

## Environment overrides

| Variable | Effect |
| --- | --- |
| `WEBTOON_USER_DATA` | Electron user-data folder: `models.json`, `secrets.json` and Electron's own state. |
| `WEBTOON_PROJECTS_ROOT` | Folder that holds the project folders. |
| `WEBTOON_MOCK_SCRIPT` | Path to a mock script (see [First run](#first-run-on-the-mock-models)); only the mock model reads it. |

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
