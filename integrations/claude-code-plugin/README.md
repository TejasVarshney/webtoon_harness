# Webtoon AI Harness plugin for Claude Code

Lets Claude Code drive the project that is open in the Webtoon AI Harness window. It adds:

- the `webtoon` MCP server, which connects to the harness's MCP link on `127.0.0.1`;
- the `webtoon-agent` skill, a short summary of the harness's agent rules (the project's own workflow docs stay the source, read through `read_workflow_doc`);
- three commands: `continue-story`, `draw-panel` and `new-character`.

Nothing is written into the plugin that grants access: the token comes from your environment.

## 1. Turn the link on in the app

In the harness, open **Settings → Plugins**, switch **Claude Code** on and note the port (default 7880). Click **Copy command**: the copied `claude mcp add ...` line contains the token after `Bearer `.

## 2. Install the plugin

In a Claude Code terminal:

```
/plugin marketplace add "<path to this repo>/integrations"
/plugin install webtoon-harness@webtoon-harness-local
```

## 3. Give Claude Code the token

Set these in the environment that starts `claude` (PowerShell example):

```
$env:WEBTOON_MCP_TOKEN = "<the token from the copied command>"
$env:WEBTOON_MCP_PORT = "7880"   # only if you changed the port
claude
```

Restart Claude Code after setting them, and check `/mcp` shows `webtoon` as connected. If you regenerate the token in Settings, set the new one and restart.

## Commands

Plugin commands are namespaced by the plugin name:

| Command | What it does |
|---|---|
| `/webtoon-harness:continue-story [N]` | AI-led autopilot: plans the next beats and draws the next N panels (default 4). Same request as the **Continue story** button. |
| `/webtoon-harness:draw-panel <what it shows>` | Draws one panel, following `workflows/panel-generation`. |
| `/webtoon-harness:new-character <who>` | Creates a character with an appearance lock and base image, following `workflows/character-creation`. |

The `webtoon-agent` skill loads by itself when you ask Claude Code to work on the webtoon.

You can watch the work live in the app: each Claude Code connection logs its tool calls into a chat session titled "Claude Code".
