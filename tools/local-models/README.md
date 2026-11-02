# Local models: gemma4 + SDXL webtoon

Run the harness fully offline on your own GPU:

- **Agent / panel chat:** `gemma4` on Ollama, through the app's normal `openai` endpoint kind (Ollama's `/v1`).
- **Images:** the InfiniteWebtoons pipeline (Animagine XL 4.0 + IP-Adapter plus + the `wbtn_style` LoRA) behind
  `image_server.py`, a small bridge that speaks the OpenAI Images API, so the app's `openai` image adapter uses it
  unchanged.

Everything runs in a sandbox (`.local-env/`, git-ignored): your normal app data and projects are never touched.

## Prerequisites

- Ollama running, with `gemma4:e4b` pulled.
- `E:\claude\InfiniteWebtoons` set up (`uv sync`, weights in `HF_HOME`; its `.env` is loaded automatically).
- `npm install` done in this repo.

## Start

```bash
npm run local:start
```

This creates the `gemma4-webtoon` model tag if missing (`gemma4:e4b` with a 16k context — Ollama's `/v1` cannot set
`num_ctx` per request), starts the image bridge in its own window, waits until it is ready, seeds
`.local-env/user-data/models.json` once, and runs `npm run dev` against the sandbox.

Options (pass after `--`, e.g. `npm run local:start -- -Reseed`):

| Option | Effect |
|---|---|
| `-Vision` | Marks gemma4 vision-capable and makes it the consistency checker. Off by default (see below). |
| `-Reseed` | Rewrites `models.json` (close the app first). |
| `-NoImageServer` | Don't start the bridge. (A bridge that is already running is detected and reused anyway.) |
| `-BridgeOnly` | Start the bridge and stop there, without the app — e.g. before `npm run local:smoke -- --images`. |
| `-Offload model\|sequential` | `sequential` (default) needs ~1 GB VRAM; `model` is faster but needs ~6 GB free. |
| `-Scale 0.75` / `-Steps 20` | Image size multiplier and sampler steps (defaults keep one image under the app's default 180 s limit, which an endpoint's `timeoutSeconds` can raise). |

## Check the stack

```bash
npm run local:smoke
```

```bash
npm run local:smoke -- --images
```

The second form also generates and edits one image through the bridge (about 4 minutes). Opt-in tests that go
through the app's own code:

```bash
WEBTOON_LIVE_LOCAL=1 npx vitest run src/main/models/local-models.live.test.ts
```

```bash
npm run build && WEBTOON_LIVE_LOCAL=1 npx playwright test tests/e2e/local-live.spec.ts
```

(In PowerShell set the variable with `$env:WEBTOON_LIVE_LOCAL=1` first.)

## ChatGPT bridge (item flow with real images)

An opt-in end-to-end test draws the item flow through the ChatGPT bridge (`E:\claude\chatgpt-bridge`, an OpenAI-compatible
server on `http://127.0.0.1:7870/v1`; set `BRIDGE_URL` to move it): Mina, a Kestrel blaster at rest, the blaster being fired
(gray hands) and a panel of Mina firing it, with the vision role checking the panel. It uses your ChatGPT account and takes about
15 minutes (one image takes 1-3 minutes, drawn one at a time), so it is skipped unless `WEBTOON_LIVE_BRIDGE=1`.

```bash
npm run build && WEBTOON_LIVE_BRIDGE=1 npx playwright test tests/e2e/bridge-live.spec.ts
```

(In PowerShell set the variable with `$env:WEBTOON_LIVE_BRIDGE=1` first.) Start the bridge with its browser extension connected (a ChatGPT tab opens on the first request): the test checks `GET /health` and stops at once if nothing answers. The test seeds a sandbox
`models.json` with `node tools/local-models/seed-bridge-models.mjs --user-data <dir>` (agent on the mock, images on
`chatgpt-image`, vision on `chatgpt`; no API key). The four images are copied into the test's output folder
(`test-results/`) and attached to the Playwright report, so you can judge them; the consistency verdict is logged, not asserted.

## What to expect on an 8 GB laptop GPU (RTX 5050)

Measured on this machine, with desktop apps already holding ~4 GB of VRAM:

- **Images:** ~105 s each at 640×896, 20 steps, sequential offload, peak 0.7 GB VRAM. Model offload at full
  size did not fit next to the desktop apps and spilled into shared memory (no image after 20 minutes).
- **Agent turns:** 20–70 s with gemma4:e4b (3.2 GB VRAM). The bridge unloads Ollama models before each image so
  the two never fight over VRAM; gemma reloads on the next turn (~10 s).
- **RAM:** the bridge keeps SDXL in system memory (~11.5 GB). With 24 GB total, close other heavy apps.
- **Full flow:** "create Mina and her reference image" took 2.6 minutes end to end.

## Known limits

- **Vision is off.** Under Ollama 0.32.14 gemma4's vision encoder turns every image into "a solid black image" on
  this GPU (the image is decoded, but the model sees black), so the sandbox marks gemma4 text-only: images are
  not sent to it (attachments become `[image omitted: model has no vision capability]`) and the consistency
  check is skipped. An Ollama
  update (0.40.8 is already downloaded) may fix it — run `npm run local:smoke` and if the vision check passes,
  restart with `-Vision -Reseed`.
- **References are blended.** IP-Adapter mixes all references into one embedding, so the seeded image model
  uses `maxReferenceImages: 2`. Two characters in one panel will look less distinct than with a hosted model.
- **Edits are img2img.** "Make her smile" re-draws the panel at strength 0.6 with the references; small,
  local edits are not as precise as a hosted edit model.
- A small local model is less reliable than Claude at following the workflow docs; expect to nudge it.
