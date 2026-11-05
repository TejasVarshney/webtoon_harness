# Agent readiness: findings and decisions

Goal: make this repo cheaper and safer for coding agents to work in. This records what the research says, what this repo measured on 2026-11-05, and what follows from both. Numbers below were measured on `feat/panel-sketch` at `c6745d3`, or on a trial merge of it with `origin/main` where noted.

## What the research says

- **Write down only what an agent can't find.** Anthropic's docs ask two questions of every line: could it find this by reading the code, and would it actually go and look? If both are yes, leave it out. Target under 200 lines. What belongs: exact commands, places where the code misleads, decisions not in the repo, anything corrected twice.
- **Overviews don't pay.** Gloaguen et al. (ICLR 2026) found context files did not generally improve task success and raised inference cost by over 20%. Repository overviews did not help agents reach the right files sooner. The files were useful for non-standard practices, and the authors say any change meant to improve performance should be evaluated before deployment.
- **Enforce what must hold.** Anthropic separates what the model decides (prompts, `CLAUDE.md`) from what the harness guarantees (hooks, tests, CI), and says the most useful line in `CLAUDE.md` is the command that returns pass or fail. OpenAI's harness engineering post keeps a roughly 100-line `AGENTS.md` as a map and relies on mechanical checks. Its page refused direct fetching, so that comes from search excerpts of the post; its detail on linter messages comes from secondary summaries.
- **Two tool facts decide the file layout.** Claude Code skips a root `AGENTS.md` when a `CLAUDE.md` exists in the working directory or above it, and `E:\claude\CLAUDE.md` does. So this repo needs a `CLAUDE.md` that imports `AGENTS.md`. Tools following the agents.md convention use the nearest `AGENTS.md`, so they can take `resources/agent-docs/AGENTS.md`, the in-app agent's prompt, as coding instructions.

## What this repo measured

| Measure | Result | What it means |
| --- | --- | --- |
| Unit tests | 1829 pass in about 22 s, 18 lines of output | Already fast and quiet. |
| Typecheck | About 2 s | Fine for a hook. |
| Vitest pool options | 14 s for the renderer project with all three | No gain available. |
| Exact duplication (jscpd) | 2 clones, 0.18% | No clone problem. |
| Runtime import cycles | 0 (the 13 madge reports are type-only) | Clean, but nothing keeps it clean. |
| Layer boundaries | Renderer and shared import only shared | Clean, but nothing keeps it clean. |
| Unused exports and types (knip) | 49 | Real, small cleanup. |
| Plan-era labels in code (`Ruling T18f`, `Review Focus 2`, `spec §9`, `Task 25`) | About 185 lines, plus 12 bare labels like `(I4)` | Dead pointers into the specs and a rulings file that past sessions read only 5 times. |
| Character and item services | 376 of 459 and 472 lines identical once names are normalised | Real twins. Every sheet change is made twice. |
| Linter or CI | None | No single pass-or-fail command. |

**Read volume in past sessions.** 247 transcripts of this project returned 28.4M characters of file content:

| Where | Share |
| --- | --- |
| `.superpowers` (subagent run files: `context.md` read 87 times, review diffs) | 49% |
| `src`, non-test | 28% |
| Tests | 9% |
| Other | 5% |
| `docs/` | 4% |
| `resources/` | 4% |
| `styles.css` | 1% |

Hottest code files, with characters returned and read count: `panel-service.ts` 618k in 102 reads, `character-service.ts` 459k in 45, `schemas.ts` 378k in 168, `styles.css` 272k in 154 (1.8k per read), `panel-service.test.ts` 124k in 36 (3.4k per read).

**Branch state.** PR #11 merged into `feat/episode-export`, and PR #10 merged into `feat/panel-shapes`, which had already reached `main` through PRs #8, #7 and #6. Both show MERGED, yet export and sketch are not on `main`. `feat/panel-sketch` is 60 commits ahead of `origin/main` and 26 behind it, because `main` has sheet-check (PR #9). Local `main` is stuck at 2026-10-25, which makes a diff against it read as 126 ahead and 0 behind.

**Trial merge of `origin/main`.** 2 conflicts (`schemas.ts`, `panel-service.test.ts`) and 5 test call sites missing `strictSheets`. After that, 1914 unit tests pass. End-to-end tests were not run. `tests/e2e/sheet-check.spec.ts` drives the old create-panel dialog, which this branch removed, so it must be rewritten for the new editor. From reading the code, the failed-sheet warning should still reach `.inspector-warnings`; the rewritten spec is what will prove it.

**Search.** Glob honours no ignore file: `**/panel-service.ts` returns 3 stale copies from `.claude/worktrees/`, and Glob also reaches `node_modules/`, `out/` and `.local-env/`. Grep skips them.

## Decisions

| Do | Why |
| --- | --- |
| Integrate `origin/main` first, in its own PR | Every other change touches files that differ between the two lines. |
| `npm run check` | One pass-or-fail command, which Anthropic's docs rate above any other line. |
| Five stricter compiler flags | They cost 2 fixes. |
| knip with a config | It reports the 49 real unused items and none of the false positives seen without one. |
| Share the small repeated helpers | `failureMessage`, `now`, `INTERRUPTED`, `NO_IMAGE_YET` and `UPLOAD_EXTS` are byte-identical across services. The OpenAI `mapError` is too, and `isAbort` differs only in how it spells one check. |
| Replace plan labels with the reasons | A reader shouldn't need a 20 KB rulings file. |
| Split `panel-service.ts` below 500 lines | It is the hottest file, and its test suite stays untouched as the safety net. |
| One structure test | Holds layers, cycles, size and labels where they are, with messages that say how to fix a failure. |
| `AGENTS.md` under 80 lines, with `CLAUDE.md` importing it | Only what the code won't show: no overview. |
| CI, and a Stop hook running typecheck if the user opts in | Enforced, not requested. The repo is public, so CI should cost nothing. The hook is persistent config, and it can't tell whose type error it is, so it is the user's call. |
| Remove the stale worktrees and merged local branches, with the user's yes | Glob returns stale source from them. Everything in them is committed elsewhere. |

| Not doing | Evidence |
| --- | --- |
| Biome or another linter | The recommended rules report 378 findings. The narrow hook rules report 11, of which 8 say "more dependencies than necessary", and those extras look like deliberate re-triggers. Enforcing that pushes agents to delete them and change behaviour. `typescript-eslint` requires TypeScript below 6.1 and this repo is on 7. |
| A formatter | It would rewrite 269 of 361 files. |
| `noUncheckedIndexedAccess` | 907 errors. |
| Splitting `styles.css` | 1% of read volume at 1.8k per read. Agents already read it in pieces. |
| Splitting `panel-service.test.ts` | Agents read it at 3.4k per read, and `vi.hoisted` mocks can't be shared across files. |
| A generic character/item base class | A large abstraction over working code. A line in `AGENTS.md` plus shared helpers gets most of the benefit. Worth revisiting if the twins drift. |
| Directory `README`s or an architecture overview | The study found overviews don't help, and agents read code well. |
| Changing the test pool | No gain measured. |
| Hiding plans with `.ignore` | Grep and shell search are a small share of output, and it would hide the active plan from Grep. |

## Limits

Code cleanup reaches the roughly 38% of read volume spent on `src` and tests. About half went to subagent run files, which this work does not touch. Two consequences: prefer inline execution for mechanical plans, and stop restating project facts in per-run context once `AGENTS.md` holds them.

None of this has been measured for effect yet, and the study's advice is to evaluate. A fair test is one fixed task run in fresh sessions on the commits before and after, comparing tokens and whether it passed. It costs real usage, so it isn't part of this work.

## Done means

- `main` holds export, sketch and sheet-check together.
- `npm run check` passes locally and in CI, and the unit test count has only grown.
- The structure test fails with a fix-it message on a layer breach, a runtime cycle, a file over 500 lines, a plan label, a dead path in `AGENTS.md`, or an undocumented `WEBTOON_*` variable.
- No user-visible behaviour changed, apart from export and sketch reaching `main` alongside sheet-check.

## Sources

- [Best practices for Claude Code](https://code.claude.com/docs/en/best-practices)
- [How Claude remembers your project](https://code.claude.com/docs/en/memory)
- [Evaluating AGENTS.md (Gloaguen et al., arXiv 2602.11988)](https://arxiv.org/abs/2602.11988)
- [Harness engineering, OpenAI](https://openai.com/index/harness-engineering/)
- [AGENTS.md format](https://agents.md/)
