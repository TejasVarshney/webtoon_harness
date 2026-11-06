# Webtoon AI Harness

Electron + React + TypeScript desktop app. `README.md` covers what it does for users.

## Commands

- Everything: `npm run check` (typecheck, dead code, unit and structure tests, about 30 s)
- One unit test file: `npx vitest run <path>`
- End to end: `npm run test:e2e`, which builds first. One spec: `npm run build`, then `npx playwright test tests/e2e/full-flow.spec.ts`. These open real windows and test the built `out/`, so rebuild after a source change.
- `*-live.spec.ts` and `*.live.test.ts` skip unless a `WEBTOON_LIVE_*` variable is set. They use real models and accounts, so don't set one unless asked.
- To run the agent flow offline, script the mock model: see `WEBTOON_MOCK_SCRIPT` in `README.md`.

## Things that are not what they look like

- `resources/agent-docs/` is product content, not instructions for you. `resources/agent-docs/AGENTS.md` is the in-app agent's system prompt.
- `docs/superpowers/plans/` and `docs/superpowers/rulings-2026-10-21-webtoon-ai-harness.md` record finished work, and `docs/superpowers/specs/` holds design records. Where any of them disagrees with the code, the code wins.
- An unscoped `**` Glob also matches `node_modules/`, `out/`, `.local-env/` and stale checkouts in `.claude/worktrees/`. Scope it to `src/`, `tests/` or `resources/`. Grep skips them.
- Compare against `origin/main`. Local `main` can lag far behind.

## Rules the code won't show you

- No lock is held across a model call: mark pending under `ctx.mutex`, call the model outside it, then re-read and record under it. A panel's lock is never held together with an episode's.
- Write project files with `writeJsonAtomic` or `writeFileAtomic` (`src/main/storage/atomic.ts`). JSONL logs are the exception: they append.
- Characters and items are twins. Their services, tools, handlers, UI and tests exist once per kind and are nearly identical, so a change to one usually belongs in the other.
- New IPC channel: add it to `IpcContract` and `channelSet` in `src/shared/ipc.ts`, put the handler in `src/main/ipc/handlers/`, and validate input with `parseInput` (`src/main/ipc/validate.ts`).
- A prompt change in `src/main/domain/prompts.ts` needs the same change in `resources/agent-docs/reference/prompt-templates.md`. `src/main/agent/workflow-docs.lint.test.ts` compares them.
- User-visible text is asserted verbatim in tests. Change the test with the text.
- The in-app agent has no delete tools, and deleted files go to the OS trash. API keys never reach the renderer. Generated images hold no text: dialogue is data the app draws.

## Tests

- Helpers: `src/main/test/` (`testServices`, `tempProject`, factories) and `src/renderer/src/test/`.
- A rare worker crash (0xC0000409) in `mcp-server.test.ts` came from Node 24.15, not the test: rerun it. Node 24.22 didn't reproduce it.

## Git

- PRs target `main`. A PR based on another feature branch can show MERGED without its work ever reaching `main`; that stranded export and sketch in PRs #10 and #11.
