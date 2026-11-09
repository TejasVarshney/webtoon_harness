# Style Library Design

Date: 2026-11-09

## Goal

Let the user choose, add and edit art styles for webtoon generation, and let the in-app LLM set one up when a project needs it.

## What the user asked for

- Several ready-made styles.
- The LLM can set a style up when needed.
- The user can add or select styles.
- The user can edit styles.

Agreed with the user: the LLM may set a project's style only until the project has art. After that, only the user can switch.

Assumptions in this spec, for the user to correct on review:

- "Edit styles" covers the built-in styles as well as the user's own.
- The LLM can edit styles the user or the LLM added, but not the built-ins.

## How it works today

`ProjectMeta.stylePreset` is a free-text string that defaults to the Korean webtoon text. Every sheet and panel prompt starts with it (`src/main/domain/prompts.ts`), and `<project_state>` shows it to the agent as `style:`. No UI sets it, and `NewProjectDialog` offers no choice, although `projects:create` accepts one. `AGENTS.md` tells the agent it cannot change the style.

## Approach

The project keeps its own copy of the style text. The library is a catalog that the picker and the agent copy text from.

- No prompt, template or schema change. `stylePreset` stays a string.
- Editing or deleting a library style never changes a project.
- Rejected: a project pointing at a library id, because one edit would silently restyle every project using it. Rejected: per-project styles, because the user would re-add them in every project.

## Library

A style is `{ id, name, text, builtin, edited }`.

### Built-in styles

These are constants in `src/main/domain/style-presets.ts`, with stable slug ids. They describe line, shading, palette and rendering, and never name an artist or a franchise. `korean-webtoon` must equal the schema's default text character for character, enforced by a test that imports both.

| id | Name | Text |
|---|---|---|
| `korean-webtoon` | Korean webtoon | Clean full-color Korean webtoon style, crisp line art, soft cel shading, expressive faces |
| `soft-romance` | Soft romance | Soft romance webtoon style, delicate thin line art, airbrushed pastel shading, glowing highlights, gentle warm blush tones |
| `action-manhwa` | Action manhwa | Bold action manhwa style, heavy confident inks, high-contrast cel shading, saturated colors, sharp dynamic linework |
| `dark-fantasy` | Painterly dark fantasy | Painterly dark fantasy style, textured digital brushwork, muted earthy palette, dramatic chiaroscuro lighting |
| `ink-noir` | Ink noir | Black-and-white ink noir style, high-contrast brush inks, solid black shadows, no color |
| `screentone-manga` | Screentone manga | Black-and-white manga style, fine pen linework, halftone screentone shading, clean white highlights, no color |
| `watercolor` | Watercolor | Soft watercolor illustration style, loose pencil outlines, translucent color washes, visible paper grain, warm natural colors |
| `flat-slice-of-life` | Flat slice-of-life | Flat-color slice-of-life style, simple clean outlines, minimal shading, bright friendly pastel palette |
| `retro-comic` | Retro print comic | Retro print comic style, bold black outlines, flat primary colors, visible halftone dots, slightly off-register inks |
| `semi-realistic` | Semi-realistic painting | Semi-realistic digital painting style, refined anatomy, subtly rendered skin, cinematic natural lighting |

### Stored styles

`<userData>/styles.json`, written with `writeJsonAtomic`:

```json
{ "custom": [{ "id": "sty_0123456789", "name": "...", "text": "..." }], "overrides": { "watercolor": { "name": "...", "text": "..." } } }
```

- `overrides` holds the user's edits to built-ins. The listed style uses the override and has `edited: true`. Reset to default removes the override.
- Built-ins cannot be deleted. Custom styles can.
- A missing file means no custom styles and no overrides.
- A corrupt file is reported, never overwritten, and leaves the unedited built-ins usable. Writes fail with a plain message until it is repaired, following `PluginManager`.
- `StyleLibrary` serializes its writes, as `PluginManager` does.

### Text rules

One function, used by every path that saves style text:

- Collapse whitespace to one line, because prompts are line-structured.
- Strip trailing periods, because the prompts write `${stylePreset}.`.
- Text must be 3 to 400 characters after that.
- Reject text matching `speech bubble`, `lettering`, `caption`, `watermark` or `signature` (case-insensitive), because every prompt says no text.

Names are 1 to 40 characters and unique, ignoring case, across the whole library.

## The lock

`StyleService.usage(ctx)` returns `{ sheets, panels }`. `sheets` counts character variations, item usages and location states with status `ready` or `pending`. `panels` counts panels with a version of status `ready` or `pending`, across all episodes. Archived entities count. Failed images do not, since nothing was drawn.

The project is locked when `sheets + panels > 0`. The lock applies only to the agent. Two simultaneous actions are not guarded against: the check and the save are not atomic with a generation the user starts in that instant.

## Which style a project shows

The header shows the name of the library style whose current text equals the project's text, or "Custom" when none does. If the user edits the style a project was using, that project keeps its old text and shows "Custom" until the user selects the style again.

## User interface

- **Style button** in `ChatHeader`, next to `StoryModeToggle`, showing the current style's name.
- **Style dialog** lists every style with its text and marks the current one. It offers: select, Add style, Edit, Delete (custom only) and Reset to default (edited built-ins only). The list loads each time the dialog opens, so styles the agent added appear.
- **Style form** has Name and Description fields and shows the text-rule errors inline.
- **New Project dialog** gets a style dropdown, preselecting Korean webtoon, and passes that style's current text. `createProject` takes the text as a second argument.
- **Switching with art** (`usage` above zero) asks first: "{sheets} sheets and {panels} panels were drawn in the current style. New images will use the new style, and references drawn in the old one may not match. Nothing is redrawn automatically." Buttons: Switch style, Cancel.

## IPC

New channels in `IpcContract` and `channelSet`, handlers in `src/main/ipc/handlers/styles.ts`, input checked with `parseInput`:

| Channel | Purpose |
|---|---|
| `styles:list` | The library, plus `loadError` |
| `styles:create` | Add a custom style |
| `styles:update` | Edit a custom style, or override a built-in |
| `styles:reset` | Remove a built-in's override |
| `styles:delete` | Delete a custom style |
| `styles:usage` | `{ sheets, panels }` for a project |
| `styles:apply` | Set a project's style from a library id. Returns the meta. Not locked |

`styles:apply` saves through `ProjectStore.updateMeta`, which emits `project.changed`, so the header also follows agent changes. `projects:create` runs its style through the text rules.

## Agent tools

`src/main/agent/tools/style-tools.ts`, added to `buildAgentTools`. The Claude Code MCP adapter receives them from there. They are not added to the panel side chat.

- `list_styles`: every style's id, name, text and built-in flag, the current style, and `canChange` with the reason when locked.
- `set_style`: exactly one of `styleId` or `text`. When locked, it fails with the counts and tells the agent to send the user to the Style button in the chat header.
- `create_style`: `name`, `text`. Adds to the library and does not apply the style.
- `update_style`: `styleId`, optional `name` and `text`. Refuses built-ins. Does not change any project.

There is no delete tool, in keeping with the agent's existing rule.

## Agent docs

Existing projects keep their copied `AGENTS.md` until the user resets the docs, and the system prompt is built from that copy. So:

- Each tool description states its own rules, and says it applies even where older project docs call the style unchangeable.
- A new `resources/agent-docs/workflows/style-setup.md` reaches existing projects, since missing files are copied in on open. Sections: Purpose, Choosing a Style, Writing a Style, When the Style Is Locked, Examples. Add it to `REQUIRED` in `workflow-docs.lint.test.ts`.
- When to set a style, in that doc:
  - Set it before the first sheet.
  - User-led mode: offer 2 or 3 options and ask, unless the user already named a look.
  - AI-led mode: pick one and say which.
  - If `style` is no longer the default, someone chose it: change it only when the user asks.
- A written style describes line, shading, palette and rendering. It names no living artist and no franchise.
- `AGENTS.md`: rewrite the `style` line and the "no tools to" limit, add the four tools to the catalog, add a row to the docs index.
- `reference/prompt-templates.md` is unchanged, because the prompts are unchanged.
- `README.md` gets a short section on styles and `styles.json`.

## Testing

- Unit: text rules; built-in default equals the schema default; library create, edit, reset, delete, name clash, corrupt file; `usage` counting each kind and ignoring failed images.
- Tools: `set_style` by id and by text, refused when locked with pending or ready art; `update_style` refuses built-ins; `create_style` applies nothing.
- IPC: each channel, including invalid input.
- Renderer: Style dialog, form errors, the switch warning, "Custom", the New Project dropdown. User-visible text is asserted verbatim.
- `npm run check`, then an offline end-to-end run with the mock model: pick a style, draw a sheet, confirm the prompt carries the text.
- `tests/e2e/docs.spec.ts` expects 10 docs and is already red on `main` with 11. The new doc makes 12, so its count is corrected to 12.

## Out of scope

- Sample preview images for each style, which cost image calls and need a working image model.
- Redrawing existing art after a switch.
- Style by episode or by panel.
- Sharing or importing style files.
