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
| `-Scale 0.75` / `-Steps 20` | Image size multiplier and sampler steps (defaults keep one image under the app's 180 s limit). |

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
- **Panels trade some likeness for their setting.** At the config's IP-Adapter scale (0.6), a full-body sheet's gray
  backdrop was copied into every panel, whatever the prompt's setting. For panels the bridge now paints a sheet's flat
  backdrop white and uses scale 0.4 (`image_server.py --panel-ip-scale` / `--panel-ref-mode`). Character sheets and
  edits keep 0.6 and the reference as is. Across the seeds tried, hair, jacket and outfit held; small details such as
  eye color drift more than at 0.6.
- **"No text" means nothing to SDXL.** The bridge drops the harness's "No text, no speech bubbles, no captions, no
  watermark." clauses from the positive prompt (with them, SDXL sometimes drew an empty speech bubble) and relies on
  the negative prompt instead.
- **Edits are img2img.** "Make her smile" re-draws the panel at strength 0.6 with the references; small,
  local edits are not as precise as a hosted edit model.
- A small local model is less reliable than Claude at following the workflow docs; expect to nudge it.
