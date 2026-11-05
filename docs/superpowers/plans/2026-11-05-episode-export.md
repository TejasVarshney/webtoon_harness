# Episode Export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Export one or more episodes as webtoon JPEG/PNG slices, a long image, a reading PDF, a print PDF or a CBZ. Each output looks exactly like the strip: lettered, with panel shapes, rows, gaps and gutters, and without its editing chrome.

**Architecture:** A second renderer entry (`export.html`) draws the strip in `export` mode. Main loads it in one offscreen `BrowserWindow` per job, with no preload. It pushes in a snapshot with `executeJavaScript` and gets the layout back. Main then captures slices over the DevTools protocol, one viewport-sized slice at a time. Pure writers (slice plan, ZIP, PDF, ComicInfo, file names, bitmap stitch) turn those slices into files. `ExportService` runs the job against a `StripCapturer` interface, so everything except the capturer is tested without Electron.

**Tech Stack:** Electron 45 (offscreen rendering, `webContents.debugger`), React 19, zustand, zod 4, vitest, testing-library, Playwright. Node `zlib.crc32` (Node 22+). No new dependencies.

**Spec:** `docs/superpowers/specs/2026-11-05-episode-export-design.md`

## Global Constraints

- No new npm dependencies. ZIP and PDF are written in-house.
- The export view is always 800 CSS px wide. Scale is 1 for `standard` and 2 for `high`. `pdf-print` is always scale 2.
- Page and slice heights in CSS px: `webtoon` 1280, `pdf-reading` 1280, `cbz` 1280, `pdf-print` A4 1177 / Letter 1067, and `long-image` parts at most `floor(65000 / scale)`.
- JPEG quality is 90. PNG is offered for `webtoon` and `long-image` only. No WebP.
- `pdf-reading` page = slice size × 0.75 pt per CSS px, with no margin. `pdf-print` uses A4 595.28×841.89 pt or Letter 612×792 pt, with 36 pt margins and the image top-aligned at the printable width.
- A panel is *finished* when the version `currentVersionId` names has `status: 'ready'`.
- The export window: `offscreen: true`, `sandbox: true`, `contextIsolation: true`, `backgroundThrottling: false`, **no preload**, plus the main window's `will-navigate` and window-open guards.
- Capture uses only `Emulation.setScrollbarsHidden`, `Emulation.setDeviceMetricsOverride`, `scrollTo` and `Page.captureScreenshot`. Never `captureBeyondViewport` (it kills the renderer), and never `capturePage()`.
- Outputs are written to `.part` names and renamed on success. A replaced existing output goes to the OS trash (`services` `trash`), never `fs.rm`.
- File names follow `<Project> - 03 - The Rooftop`, and combined outputs `<Project> - Episodes 1-3`. Episode numbers are padded to 2 digits and slice numbers to 3 (`001.jpg`).
- Commit messages: conventional prefix (`feat:`, `fix:`, `test:`, `docs:`), present tense, ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

**One clarification of the spec (§6.1):** when the outputs are several files, the save dialog picks a **folder**, not a file. That is the case for `webtoon`, for `long-image`, and for any preset with two or more episodes and `combine: false`. A single output picks a file.

## Review Focus

1. **An episode where every panel is unfinished, alongside others that are fine.** The export skips that episode, adds no empty PDF page or CBZ, and the result still lists the others. Pinned in Task 6 (`skips an episode with no finished panel`).
2. **Lettering text with `</script>`, U+2028, quotes or emoji, pushed through `executeJavaScript`.** It must render as text, not break the call. Pinned in Task 9 (`serializes the snapshot safely`) with the `snapshotScript` helper.
3. **Very long episodes (40+ panels, 1:3 aspects) at High.** No slice may exceed 1280×scale, long-image parts are split at 65,000 px, and the stitch never holds more than one part. Pinned in Task 2 (`splits a long image into parts`) and Task 5 (`refuses a stitch over the part limit`).
4. **The same file name for two episodes** (same title, or titles differing only in illegal characters). The outputs must not overwrite each other. Pinned in Task 2 (`outputNames are unique`).
5. **Cancel pressed during the last write, or the app quit mid-capture.** No `.part` file or folder is left behind, and the window is closed. Pinned in Task 6 (`cancel during writing removes parts`) and Task 9's `close()` in `finally`.

---

### Task 1: Shared strip layout and finished-panel rules

**Files:**
- Move: `src/renderer/src/components/visualizer/strip-layout.ts` → `src/shared/strip-layout.ts` (contents unchanged)
- Modify imports in `WebtoonStrip.tsx`, `PanelCard.tsx`, `panel-editor/PanelWorkspace.tsx` and `visualizer/strip-layout.test.ts` to `@shared/strip-layout`
- Create: `src/shared/export-status.ts`, `src/shared/export-status.test.ts`
- Test: `src/renderer/src/components/visualizer/strip-layout.test.ts` (keeps its renderer fixtures, adds `exportRows` cases)

**Interfaces:**
- Produces:
  - `exportRows(panels: Panel[]): StripRow[]`, in `@shared/strip-layout`.
  - `isFinished(panel: Panel): boolean`.
  - `unfinishedReason(panel: Panel): 'none' | 'generating' | 'failed' | null`. It returns `null` when finished, `generating` when the newest version is pending, `failed` when it failed, and `none` when there are no versions.

- [ ] **Step 1: Move the file and fix the four imports.** Run `npm test -- strip-layout`. Expected: the existing layout tests PASS.
- [ ] **Step 2: Write failing tests**
  - In `export-status.test.ts`:
    - `isFinished is true for a ready current version even when the newest attempt failed` (versions `[ready v1, failed v2]`, current `v1`).
    - `isFinished is false with no current version`.
    - `unfinishedReason names pending as generating, a failed newest with no current as failed, and no versions as none`.
  - In `strip-layout.test.ts`, use `finished = (id, o) => p(id, { versions: [panelVersion({ id: 'v_'+id, status: 'ready' })], currentVersionId: 'v_'+id, ...o })` and `exportRows`:
    - `keeps a beside panel in its own row when its row-starter is unfinished`: `[a, b(unfinished), c(beside), d]` gives `[['a'], ['c'], ['d']]`.
    - `drops a row left empty`.
    - `takes gapAfter and gutter from the row's new last panel`: in row `[a, b(beside, unfinished, gutter black)]`, `a` has `gutter: 'white'`, so the row's gutter is `white`.
    - `keeps the slant the full layout gave`: two slanted panels with the first unfinished, so the second keeps `'right'`.
- [ ] **Step 3: Run.** `npm test -- strip-layout export-status`. Expected: FAIL, with `exportRows`/`isFinished` not exported.
- [ ] **Step 4: Implement** `exportRows`, which runs `layoutStrip(panels)`, then filters each row's panels by `isFinished`, drops empty rows, and resets `gapAfter`/`gutter` from the new last panel while keeping `slants`. Then implement `isFinished` and `unfinishedReason`.
- [ ] **Step 5: Run.** `npm test` and `npm run typecheck`. Expected: PASS.
- [ ] **Step 6: Commit** `feat: share the strip layout and add the rows an export draws`

---

### Task 2: Slice plan, file names, ComicInfo

**Files:**
- Create: `src/main/export/slice-plan.ts`, `src/main/export/file-names.ts`, `src/main/export/comic-info.ts`, and a `.test.ts` beside each.

**Interfaces:**
- Produces:
  - `interface Slice { top: number; height: number }` (CSS px).
  - `planSlices(input: { totalHeight: number; rows: { top: number; bottom: number }[]; pageHeight: number; breaks: 'anywhere' | 'rows' }): Slice[]`
  - `PAGE_HEIGHT: Record<'webtoon' | 'pdf-reading' | 'cbz', 1280>` and `PRINT_PAGE_HEIGHT = { a4: 1177, letter: 1067 }`
  - `longImagePartHeight(scale: 1 | 2): number` (= `Math.floor(65000 / scale)`)
  - `safeFileName(text: string): string`
  - `outputNames(projectTitle: string, episodes: { number: number; title: string }[], combined: boolean): string[]`. It returns base names without extensions, one per episode, or one when combined.
  - `comicInfoXml(meta: { series: string; title: string; number?: number; summary?: string; pageCount: number }): string`

- [ ] **Step 1: Write failing tests**
  - `planSlices`:
    - `cuts anywhere into page-height slices with a short last one`: total 2985, page 1280 gives `[{0,1280},{1280,1280},{2560,425}]`.
    - `breaks between rows, packing rows that fit`: rows `[0,500],[500,1100],[1100,1900]`, page 1280 gives `[{0,1100},{1100,800}]`.
    - `cuts a row taller than the page anywhere inside it`: row `[0,3000]`, page 1280 gives `[1280, 1280, 440]`.
    - `returns no slices for an empty strip`.
    - `splits a long image into parts`: total 70000 at scale 2, with `pageHeight: longImagePartHeight(2)` (32500), gives 3 slices, none over 32500.
  - `safeFileName`:
    - `strips <>:"/\|?* and control characters`.
    - `trims trailing dots and spaces`.
    - `prefixes reserved names (CON, nul, COM1, LPT9)` → `_CON`.
    - `caps at 120 characters`.
    - `falls back to Untitled when nothing is left`.
  - `outputNames`:
    - `names an episode <Project> - 03 - Title`.
    - `names a combined volume <Project> - Episodes 1-3` (numbers min to max).
    - `outputNames are unique`: two episodes whose safe titles collide get ` (2)`.
  - `comicInfoXml`:
    - `escapes & < > " '`.
    - `omits Number and Summary when not given`.
    - `writes PageCount`.
- [ ] **Step 2: Run.** `npm test -- src/main/export`. Expected: FAIL (modules missing).
- [ ] **Step 3: Implement.** In `planSlices`, `breaks: 'rows'` closes a slice at the last row bottom that fits within `top + pageHeight`. When no row bottom fits, it cuts at `top + pageHeight`. The last slice always ends at `totalHeight`. `comicInfoXml` writes `<?xml version="1.0" encoding="utf-8"?><ComicInfo>` with `Series`, `Title`, `Number`, `Summary`, `PageCount` and `Manga` = `No`.
- [ ] **Step 4: Run.** `npm test -- src/main/export`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: plan export slices and name export files`

---

### Task 3: Store-only ZIP writer (CBZ)

**Files:**
- Create: `src/main/export/zip-writer.ts`, `src/main/export/zip-writer.test.ts`, and `src/main/test/read-zip.ts` (test helper, shared with Task 6).

**Interfaces:**
- Produces:
  - `class ZipWriter { static open(path: string): Promise<ZipWriter>; add(name: string, data: Buffer): Promise<void>; close(): Promise<void>; abort(): Promise<void> }`. `abort` closes the handle and deletes the file.
  - `readZip(buf: Buffer): { name: string; data: Buffer; crc: number; flags: number }[]` in `src/main/test/read-zip.ts`. It walks the end-of-central-directory record and the central directory, then reads each local entry's stored bytes.

- [ ] **Step 1: Write failing tests** with `readZip`:
  - `round-trips entries in order with their bytes`.
  - `writes the CRC zlib.crc32 computes`.
  - `marks names UTF-8 (flag bit 11) and keeps a non-ASCII name`.
  - `abort deletes the file`.
- [ ] **Step 2: Run.** `npm test -- zip-writer`. Expected: FAIL.
- [ ] **Step 3: Implement.** Method 0 (store), version 20, flag `0x0800`, and a fixed DOS time and date of 1980-01-01, so output is reproducible. It writes each local header and its data through a `fs.promises.FileHandle`, tracking offsets. `close()` writes the central directory and the EOCD. No ZIP64: reject with `Error('CBZ is over 4 GB')` when an offset passes `0xFFFFFFFF`.
- [ ] **Step 4: Run.** `npm test -- zip-writer`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: write CBZ archives without a dependency`

---

### Task 4: PDF writer

**Files:**
- Create: `src/main/export/pdf-writer.ts`, `src/main/export/pdf-writer.test.ts`

**Interfaces:**
- Produces:
  - `type PdfPage = { jpeg: Buffer; pixelWidth: number; pixelHeight: number; page: { width: number; height: number }; draw: { x: number; y: number; width: number; height: number } }`. All values are in pt, with `y` measured from the page top.
  - `class PdfWriter { static open(path: string): Promise<PdfWriter>; addPage(p: PdfPage): Promise<void>; close(): Promise<void>; abort(): Promise<void> }`
  - `readingPage(slice: { cssHeight: number }, jpeg, px: { w: number; h: number }): PdfPage`. The page is 600 × `cssHeight * 0.75` pt, and the drawing fills it.
  - `printPage(paper: 'a4' | 'letter', slice: { cssHeight: number }, jpeg, px): PdfPage`. The drawing is at x = 36, top = 36, with width = page width − 72 and height = `cssHeight * width / 800`.

- [ ] **Step 1: Write failing tests**
  - `writes one page per addPage with its MediaBox`.
  - `embeds the JPEG bytes verbatim as a DCTDecode XObject with Width/Height`.
  - `points every xref entry at its "n 0 obj"`: parse `startxref`, then check each 20-byte entry's offset.
  - `printPage fits 800 CSS px to the A4 printable width and top-aligns it`: width 523.28, y 36.
  - `readingPage sizes a 1280 CSS px slice to 600×960 pt`.
  - `abort deletes the file`.
- [ ] **Step 2: Run.** `npm test -- pdf-writer`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - PDF 1.4, with a binary comment line after the header.
  - Objects: 1 Catalog, 2 Pages (its `Kids` and `Count` are written at `close`, so its object is written last and referenced by number). Per page: Page, Contents (`q w 0 0 h x (H−y−h) cm /Im Do Q`) and an XObject Image (`/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode`).
  - Streams written as they arrive. Offsets are tracked for the xref.
- [ ] **Step 4: Run.** `npm test -- pdf-writer`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: write image PDFs for reading and print`

---

### Task 5: Bitmap stitching for the long image

**Files:**
- Create: `src/main/export/long-image.ts`, `src/main/export/long-image.test.ts`

**Interfaces:**
- Produces:
  - `type Bitmap = { width: number; height: number; data: Buffer }` (BGRA, `width*4` bytes per row).
  - `stitchBitmaps(parts: Bitmap[]): Bitmap`
  - `MAX_LONG_IMAGE_PX = 65000`

- [ ] **Step 1: Write failing tests**
  - `stacks bitmaps top to bottom`: a 2×1 red bitmap and a 2×2 blue one give 2×3, with byte rows in order.
  - `rejects bitmaps of different widths`.
  - `refuses a stitch over the part limit`: a total height over 65000 throws `Error('Long image part is over 65000 px')`.
- [ ] **Step 2: Run.** `npm test -- long-image`. Expected: FAIL.
- [ ] **Step 3: Implement.** `Buffer.concat` of the data in order, after checking widths and the total height.
- [ ] **Step 4: Run.** `npm test -- long-image`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: stitch slices into a long image`

---

### Task 6: Export types and ExportService

**Files:**
- Modify: `src/shared/schemas.ts`. Add `ExportPresetSchema`, `ExportRequestSchema` and `ExportInspectRequestSchema`.
- Modify: `src/shared/types.ts`. Add `ExportPreset`, `ExportRequest`, `ExportProgress`, `ExportInspection`, `ExportSnapshot`, `ViewLayout`, and the `AppEvent` variant.
- Create: `src/main/export/export-service.ts`, `src/main/export/export-service.test.ts`, `src/main/export/types.ts` (the `StripCapturer` and `ImageCodec` interfaces).

**Interfaces:**
- Produces (shared):
  - `ExportPresetSchema = z.enum(['webtoon', 'long-image', 'pdf-reading', 'pdf-print', 'cbz'])`
  - `ExportRequestSchema = z.object({ projectId: Id, episodeIds: z.array(Id).min(1), preset: ExportPresetSchema, imageType: z.enum(['jpeg','png']).default('jpeg'), paper: z.enum(['a4','letter']).default('a4'), resolution: z.enum(['standard','high']).default('standard'), combine: z.boolean().default(false), lettering: z.boolean().default(true) })`. Unfinished panels are always left out; the dialog's "Export anyway" is only a confirmation.
  - `ExportInspection = { episodes: { episodeId: string; number: number; title: string; panelCount: number; finishedCount: number; unfinished: { panelId: string; position: number; reason: 'none' | 'generating' | 'failed' }[] }[] }`
  - `ExportSnapshot = { projectId: string; episode: Episode; panels: Panel[]; characters: Character[]; lettering: boolean }`. `panels` is the full list, in strip order.
  - `ViewLayout = { totalHeight: number; rows: { top: number; bottom: number }[] }`
  - `ExportProgress = { jobId: string; stage: 'rendering' | 'capturing' | 'writing' | 'done' | 'failed' | 'cancelled'; episodeIndex: number; episodeCount: number; slice: number; sliceCount: number; message: string | null; outputs: string[] }`
  - `AppEvent` gains `{ type: 'export.progress'; projectId: string; progress: ExportProgress }`.
- Produces (main, `types.ts`):
  - `interface StripCapturer { open(): Promise<void>; render(snapshot: ExportSnapshot, timeoutMs: number): Promise<ViewLayout>; capture(slice: Slice, scale: 1 | 2, format: 'jpeg' | 'png'): Promise<Buffer>; close(): Promise<void> }`
  - `interface ImageCodec { toBitmap(png: Buffer): Bitmap; encode(b: Bitmap, format: 'jpeg' | 'png'): Buffer; size(img: Buffer): { width: number; height: number } }`
- Produces (main, service):
  - `class ExportService`, constructed with `{ projects: ProjectStore; episodes: EpisodeService; panels: PanelService; characters: CharacterService; bus: EventBus; trash: (p: string) => Promise<void>; createCapturer: () => StripCapturer; codec: ImageCodec }`. Methods:
    - `inspect(projectId: string, episodeIds: string[]): Promise<ExportInspection>`
    - `targetKind(req: ExportRequest): 'file' | 'folder'`
    - `suggestedName(req: ExportRequest): Promise<string>`. Returns a base name plus extension, for the save dialog.
    - `start(req: ExportRequest, target: string): Promise<{ jobId: string }>`. Rejects with `Error('An export is already running')`.
    - `cancel(jobId: string): void`
    - `outputsOf(jobId: string): string[]`
    - `shutdown(): Promise<void>`. Cancels and waits at most 5000 ms.
- Consumes: Tasks 1–5.

- [ ] **Step 1: Write failing tests.** Use `testServices()` and `tempProject()`, a `FakeCapturer`, and a fake codec. The `FakeCapturer`'s `render` returns rows of 600 CSS px per finished row. Its `capture` returns a tiny JPEG fixture (or a PNG for `png`) and records calls. The fake codec works on 1×N bitmaps.
  - `inspect lists unfinished panels with 1-based positions and reasons`.
  - `snapshots panels at start, so an edit during the job does not change the output`: update a panel after `start` and before the first capture resolves.
  - `writes webtoon slices 001.jpg… into <target>/<Project> - 01 - <Title>/`.
  - `writes one pdf per episode, or one combined pdf in episode-number order when combine is set`: page count from the writer.
  - `writes a cbz with pages and ComicInfo.xml`: read with Task 3's `readZip` from `src/main/test/read-zip.ts`.
  - `a combined cbz describes the volume`: ComicInfo `Series` is the project title, `Title` is `Episodes 1–3`, there is no `Number`, and `PageCount` covers every episode.
  - `skips an episode with no finished panel, and fails with "Nothing to export: no episode has a finished panel" when none has one`.
  - `emits rendering, capturing, writing and done progress in order, with outputs on done`.
  - `cancel during capturing stops, emits cancelled and leaves no .part`.
  - `cancel during writing removes parts`: a bus listener calls `cancel(jobId)` on the first `writing` progress event of a two-episode `pdf-reading` job. No `.pdf` or `.part` is left in the target.
  - `a capturer failure emits failed with its message, removes parts and closes the capturer`.
  - `refuses a second job while one runs`.
  - `trashes an existing output only after a successful run`.
- [ ] **Step 2: Run.** `npm test -- export-service`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - `start` validates, snapshots, sets the job, and runs it without awaiting it.
  - The run calls `capturer.open()`. For each episode it renders with a timeout of `30000 + 2000 * panels.length` ms, plans slices with Task 2's heights and breaks, captures each slice (checking the cancel flag before each one), and feeds the preset's writer. The capturer's `close()` runs in `finally`.
  - Every output path gets `.part` until the rename. Once all outputs are complete, the existing targets are trashed and the parts renamed.
  - Progress events go out on the bus as `export.progress`.
  - `long-image` captures PNG, converts each slice with `codec.toBitmap`, stitches each part with `stitchBitmaps`, and encodes it with `codec.encode`. Parts are named `-1`, `-2` only when there is more than one.
  - `targetKind` is `folder` for `webtoon` and `long-image`, and for two or more episodes without `combine`. Otherwise it is `file`.
- [ ] **Step 4: Run.** `npm test -- export-service`, then `npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: run episode export jobs`

---

### Task 7: IPC channels and services wiring

**Files:**
- Modify: `src/shared/ipc.ts`. Add these four contract entries to `channelSet`:
  - `'export:inspect': { req: { projectId: string; episodeIds: string[] }; res: ExportInspection }`
  - `'export:start': { req: ExportRequest; res: { jobId: string } | { cancelled: true } }`
  - `'export:cancel': { req: { jobId: string }; res: void }`
  - `'export:reveal': { req: { jobId: string }; res: void }`
- Create: `src/main/ipc/handlers/export.ts`, `src/main/ipc/handlers/export.test.ts`
- Modify:
  - `src/main/services.ts`: `Services.exports: ExportService`, plus `ServicesOptions.createCapturer?` and `codec?`. The defaults throw `Error('Export is not available in this build')`.
  - `src/main/ipc/register.ts`: `IpcDeps.chooseExportTarget?: (event: unknown, o: { kind: 'file' | 'folder'; defaultPath: string; extension: string | null }) => Promise<string | null>` and `IpcDeps.showItemInFolder?: (absPath: string) => void`.
  - `src/main/ipc/register.test.ts`, `src/main/ipc/validation.test.ts`.

**Interfaces:**
- Consumes: Task 6 `ExportService`, `ExportRequestSchema`.
- Produces: the four channels. The default folder is `path.join(projectsRoot, '..', 'Exports')`, created on first use.

- [ ] **Step 1: Write failing tests** in `export.test.ts`:
  - `export:start shows the folder dialog for webtoon and starts the job`.
  - `export:start returns {cancelled:true} when the dialog is dismissed and starts nothing`.
  - `export:start rejects a bad preset as one readable line`.
  - `export:reveal shows the job's first output and never takes a path`.
  
  `register.test` already fails for a contract channel without a handler.
- [ ] **Step 2: Run.** `npm test -- handlers/export register validation`. Expected: FAIL.
- [ ] **Step 3: Implement** the handlers on top of `s.exports`, and wire `ExportService` in `createServices`.
- [ ] **Step 4: Run.** `npm test` and `npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: export channels over IPC`

---

### Task 8: Export mode of the strip and the export entry

**Files:**
- Modify:
  - `WebtoonStrip.tsx`: `mode?: 'edit' | 'export'`, `lettering?: boolean`, and `rows?: StripRow[]`. Export passes `exportRows`.
  - `PanelCard.tsx`: `mode`. In export mode there is no toolbar, no click or key handlers, no `tabIndex` and no selection.
  - `PanelArt.tsx`: `mode` and `lettering`. In export mode there is no `panel-empty`, `panel-status`, Retry or error, and `lettering: false` skips `DialogueOverlay`.
- Create:
  - `src/renderer/export.html`, with the CSP meta copied from `index.html`.
  - `src/renderer/src/export-main.tsx`, with the same font imports as `main.tsx` plus `styles.css` and `export.css`.
  - `src/renderer/src/components/export/ExportView.tsx` and `ExportView.test.tsx`.
  - `src/renderer/src/export.css`.
- Modify:
  - `electron.vite.config.ts`: `renderer.build.rollupOptions.input = { index: resolve('src/renderer/index.html'), export: resolve('src/renderer/export.html') }`.
  - `src/main/renderer-csp.test.ts`: run the strict-policy assertion for both HTML files.

**Interfaces:**
- Produces: `window.webtoonExport = { render(snapshot: ExportSnapshot): Promise<ViewLayout> }`, set by `export-main.tsx`.
  - `render` sets `useAppStore` `projectId` and `useCharactersStore` `{ characters, loaded: true, projectId }`, so no hook calls `window.api` (the window has none). It renders `<ExportView snapshot>`, then resolves after commit, `document.fonts.ready`, every `img.decode()` and two `requestAnimationFrame`s.
  - It resolves with each `.strip-band`'s `offsetTop` and `offsetTop + offsetHeight`, rounded up, and `document.documentElement.scrollHeight`.
  - A failed decode rejects with `Panel <position>: the image could not be loaded`. `position` is the 1-based index in `snapshot.panels`, read from `data-position`, which export mode adds to the card.
- `export.css`. In the app, rows and gaps are capped at `min(100%, 440px)` inside a band with `padding: 0 20px` and `background: var(--raised)`. Export must undo all three, or the output is a 440px column on the theme colour:
  - `html, body { margin: 0; width: 800px; overflow: hidden; background: #fff }`.
  - `.webtoon-strip { padding: 0; width: 800px }`.
  - `.strip-band { padding: 0; background: #fff }`.
  - `.strip-band[data-gutter='black'] { background: #000 }`.
  - `.strip-row, .strip-gap { width: 100% }`.
  - The body background is set inline from the first row's gutter.
  - `ExportView.test.tsx` adds `the export stylesheet widens rows and gaps to the full strip`: it asserts these rules exist in `export.css`'s text, since jsdom does no layout.

- [ ] **Step 1: Write failing tests**
  - In `ExportView.test.tsx`, with no `window.api` installed, so any call throws:
    - `draws no add-panel, status, Retry or No image yet`.
    - `keeps strip-gap bands with their data-gap and data-gutter`.
    - `draws no bubbles when lettering is off and draws them when on`.
    - `leaves unfinished panels out (exportRows)`.
    - `never calls window.api`.
  - `WebtoonStrip.test.tsx`: `edit mode is unchanged` (the existing tests pass untouched).
  - CSP test: `export.html stays strict`.
- [ ] **Step 2: Run.** `npm test -- ExportView WebtoonStrip renderer-csp`. Expected: FAIL.
- [ ] **Step 3: Implement** as described in the Interfaces block. `render()` must be callable once per page load: main reloads the page for each episode.
- [ ] **Step 4: Run.** `npm test`, `npm run typecheck`, `npm run build`. Expected: PASS, and `out/renderer/export.html` exists.
- [ ] **Step 5: Commit** `feat: draw the strip for export without its editing chrome`

---

### Task 9: Offscreen capturer and main wiring

**Files:**
- Create:
  - `src/main/export/offscreen-capturer.ts`
  - `src/main/export/electron-codec.ts`, which implements `ImageCodec` on `nativeImage`: `createFromBuffer().toBitmap()`, `createFromBitmap(data, {width, height})`, `toJPEG(90)`/`toPNG()`.
  - `src/main/export/snapshot-script.ts` and `snapshot-script.test.ts`.
- Modify:
  - `src/main/index.ts`: pass `createCapturer` and `codec` into `createServices`, and `chooseExportTarget` (`dialog.showSaveDialog` / `showOpenDialog` with `openDirectory, createDirectory`) and `showItemInFolder` (`shell.showItemInFolder`) into `registerIpc`.
  - The quit gate's `stopPlugins`: `() => Promise.all([plugins.stopAll(), services.exports.shutdown()]).then(() => undefined)`.

**Interfaces:**
- Consumes: Task 6 `StripCapturer`, Task 8 `window.webtoonExport`.
- Produces:
  - `createOffscreenCapturer(opts: { rendererUrl: string | null; rendererDir: string }): StripCapturer`
  - `snapshotScript(snapshot: ExportSnapshot): string`. It returns `window.webtoonExport.render(JSON.parse(<JSON string literal>))`, where the literal is `JSON.stringify(JSON.stringify(snapshot))`, so no snapshot text is ever parsed as code.

- [ ] **Step 1: Write a failing test**
  - In `snapshot-script.test.ts`: `serializes the snapshot safely`. A panel's dialogue text is `</script>"' 😀`. Evaluating the script with `new Function('window', 'return ' + script)` against a stub `window.webtoonExport.render = (s) => s` returns a deep-equal snapshot.
- [ ] **Step 2: Run.** `npm test -- snapshot-script`. Expected: FAIL.
- [ ] **Step 3: Implement** `snapshotScript`, then the capturer (§3 of the spec):
  - `open()` creates the window with the Global Constraints' `webPreferences` and size 800×1280, adds the navigation guards, sets `setFrameRate(60)`, and attaches the debugger (`'1.3'`).
  - `render()`:
    1. Loads `${rendererUrl}/export.html` in dev, or `join(rendererDir, 'export.html')` otherwise.
    2. Sends `Emulation.setScrollbarsHidden`.
    3. Calls `executeJavaScript(snapshotScript(s))`, raced against the timeout and against `render-process-gone`. A crash gives `Error('The export window stopped unexpectedly')`.
  - `capture()`: `setDeviceMetricsOverride({ width: 800, height: slice.height, deviceScaleFactor: scale, mobile: false })`, then `executeJavaScript('scrollTo(0,TOP); new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))')`, then `Page.captureScreenshot({ format, quality: 90 for jpeg })`, returning `Buffer.from(data, 'base64')`.
  - `close()` detaches the debugger, destroys the window, and is safe to call twice.
- [ ] **Step 4: Run.** `npm test -- snapshot-script`, `npm run typecheck`, `npm run build`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: capture the export strip in an offscreen window`

---

### Task 10: Export dialog and the Export button

**Files:**
- Create: `src/renderer/src/components/export/ExportDialog.tsx`, `ExportDialog.test.tsx`, `src/renderer/src/components/export/export-options.ts` (pure: which options each preset shows) and `export-options.test.ts`.
- Modify: `src/renderer/src/components/visualizer/EpisodeBar.tsx` (an **Export** button, `data-testid="export-open"`, disabled with no episodes) and `src/renderer/src/styles.css`.

**Interfaces:**
- Consumes: `export:inspect`, `export:start`, `export:cancel`, `export:reveal`, and `export.progress` events through `window.api.onEvent`, filtered by `jobId`.
- Produces:
  - `visibleOptions(preset: ExportPreset, episodeCount: number): { imageType: boolean; paper: boolean; resolution: boolean; combine: boolean }`
  - Test ids: `export-dialog`, `export-episode-<id>` (checkbox), `export-preset` (select), `export-start`, `export-anyway`, `export-cancel`, `export-reveal` and `export-progress`.
- Copy:
  - Presets: "Webtoon upload (JPEG slices)", "Long image", "PDF for reading", "PDF for print", "CBZ (comic readers)".
  - Warning: `Episode 2: panels 4, 7 (failed), 9 (generating) have no finished image and will be left out.`
  - Disabled reason: `No ticked episode has a finished panel.`
  - Progress: `Episode 2 of 3, slice 14 of 31`.
  - Done: `Exported.`, plus **Show in folder**.
  - Cancelled: `Export cancelled.`

- [ ] **Step 1: Write failing tests**
  - `export-options.test.ts`: one case per preset, plus `combine only with two or more episodes on pdf and cbz`.
  - `ExportDialog.test.tsx`, with the fake API:
    - `ticks the active episode`.
    - `shows the unfinished warning and needs Export anyway before starting`.
    - `disables Export when no ticked episode has a finished panel`.
    - `sends the request with the chosen preset and options`.
    - `shows progress from export.progress events for its job only`.
    - `Cancel sends export:cancel`.
    - `Show in folder sends export:reveal`.
    - `keeps the dialog open with the error on failed`.
    - `a dismissed save dialog ({cancelled:true}) returns to the form`.
- [ ] **Step 2: Run.** `npm test -- ExportDialog export-options`. Expected: FAIL.
- [ ] **Step 3: Implement** the dialog as a modal, following the existing dialog markup and classes in `SettingsDialog.tsx`. Mount it from `EpisodeBar`.
- [ ] **Step 4: Run.** `npm test` and `npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: export episodes from the episode bar`

---

### Task 11: End-to-end export

**Files:**
- Create: `tests/e2e/export.spec.ts`
- Modify: `tests/e2e/helpers.ts`. Add `writeProjectJson(projectsRoot, relPath, data)`, mirroring `readProjectJson`.

**Interfaces:**
- Consumes: the Task 10 test ids. `WEBTOON_EXPORT_TARGET`: when it is set, `chooseExportTarget` in `index.ts` returns it instead of showing a dialog. Add this env hook in this task, next to the existing `WEBTOON_*` overrides.

- [ ] **Step 1: Write the test** `exports webtoon slices, a cbz and a reading pdf that match the strip`:
  1. With a mock script, create Mina and 4 panels: panel 2 `frame: 'slanted'`, panel 3 `beside: false`, and panel 4 `gutter: 'black'`.
  2. Export `webtoon` to temp folder A. Read every slice's size in the main process with `app.evaluate(({ nativeImage }, p) => nativeImage.createFromPath(p).getSize(), path)`. Assert each is 800 wide and at most 1280 tall, and record the summed height `hA`.
  3. Sample a pixel in panel 4's black gap band with `nativeImage.createFromPath(p).crop(...).toBitmap()`. The y comes from summing slice heights, and the band is the last 40 px of the strip, since `normal` gap ≥ 40. Assert it is black (each channel < 16).
  4. Quit, then mark panel 3 failed with `writeProjectJson`: `versions: [{…, status: 'failed', imagePath: null}]` and `currentVersionId: null`. Relaunch on the same directories.
  5. Export `webtoon` to folder B. Assert the summed height is less than `hA`, so panel 3's row is gone.
  6. Export `cbz`. Assert the entries are `001.jpg…` plus `ComicInfo.xml` containing `<Number>1</Number>`. Read them with `src/main/test/read-zip.ts`.
  7. Export `pdf-reading`. Assert the `/Type /Page` count equals folder B's slice count.
- [ ] **Step 2: Run.** `npm run test:e2e -- export`. Expected: PASS. If it fails, fix the owning task's code, not the test's assertions.
- [ ] **Step 3: Commit** `test: cover episode export end to end`

---

### Task 12: Documentation

**Files:**
- Modify: `README.md`. Add an **Export** section after the strip and editor sections, covering:
  - the five presets and their sizes, from the Global Constraints;
  - lettering, unfinished panels, combine, and resolution;
  - where files go (the `Exports` folder next to `projects`).

- [ ] **Step 1: Write the section.** Check each size and name against the Global Constraints, and each button label against Task 10's copy.
- [ ] **Step 2: Run** `npm test` and `npm run typecheck` once more for the whole branch. Expected: PASS.
- [ ] **Step 3: Commit** `docs: explain exporting episodes`
