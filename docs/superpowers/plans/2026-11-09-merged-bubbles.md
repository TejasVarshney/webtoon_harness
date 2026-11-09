# Merged Bubbles, Padding and New Shapes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Overlapping bubbles of the same look fuse into one outline, each bubble has a padding control, and the Shape picker gains Fringe, Dark burst and Curly.

**Architecture:** A measured SVG layer behind `.dialogue-placed` paints each group's outlines and then its fills, and members turn their own body transparent without changing size. Grouping is a pure function. Padding is one optional style key drawn through a CSS variable. The new shapes extend the existing shape enum and body art.

**Tech Stack:** Electron, React, TypeScript, Zod, Vitest, Testing Library, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-09-merged-bubbles-design.md`

## Global Constraints

- Work on `feat/merged-bubbles`, based on `origin/main`. The spec is not committed yet: Task 1's commit includes it and this plan.
- No new dependencies.
- Merge key: shape, fill, outline colour, outline width, resolved through `bubbleDefaults`. Mergeable shapes: `speech`, `whisper`, `shout`, `thought`.
- `padding`: multiplier, 0.3 to 2, default 1. Slider 30 to 200, step 5, label `Padding`, output like `100%`.
- Shape ids and labels, verbatim: `fringe` / `Fringe`, `burst` / `Dark burst`, `curly` / `Curly`.
- User-visible text is asserted verbatim in tests. Change the test with the text (AGENTS.md).
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- `npm run check` must pass at the end of every task.

## Review Focus

- The stage is zoomed (the overlay has a CSS scale): the merged body must still sit exactly under its bubble. Test in Task 3.
- A merged bubble's text is open for typing: it stays merged and the editor renders. Test in Task 3.
- Outline width 0, or a box smaller than twice the outline: no negative radius reaches the SVG. Test in Task 3.
- The strip and export render the overlay with no `editing` prop: merging must not depend on it. Test in Task 3.
- A Curly bubble before measuring or at a tiny size: it draws nothing rather than an invalid path. Test in Task 5.

---

### Task 1: Padding

**Files:**
- Modify: `src/shared/schemas.ts:243-259`, `src/renderer/src/components/visualizer/bubble-style.ts`, `src/renderer/src/styles.css` (shape `padding` rules), `src/renderer/src/components/panel-editor/BubbleStyleBlock.tsx`
- Modify: `src/main/agent/tools/panel-tools.ts:167,195`, `src/main/agent/tools/panel-chat-tools.ts:214`, `resources/agent-docs/workflows/panel-editing.md:155`
- Test: `src/shared/schemas.test.ts`, `src/renderer/src/components/visualizer/bubble-style.test.ts`, `src/renderer/src/components/panel-editor/BubbleStyleBlock.test.tsx`

**Interfaces:**
- Produces: `BubbleStyle.padding?: number`, `bubbleDefaults(shape).padding === 1`, CSS variable `--bubble-padding`.

- [ ] **Step 1: Write the failing tests**

```ts
// schemas.test.ts
it('takes a padding between 0.3 and 2, and adds none to a style without one', () => {
  expect(BubbleStyleSchema.parse({ padding: 0.3 }).padding).toBe(0.3)
  expect(BubbleStyleSchema.parse({ padding: 2 }).padding).toBe(2)
  expect(() => BubbleStyleSchema.parse({ padding: 0.2 })).toThrow()
  expect(() => BubbleStyleSchema.parse({ padding: 2.1 })).toThrow()
  expect(BubbleStyleSchema.parse({ fill: '#ffffff' })).not.toHaveProperty('padding')
})

// bubble-style.test.ts
it('draws a padding as a variable and drops it at the default', () => {
  expect(bubbleStyleProps({ padding: 1.5 })).toEqual({ '--bubble-padding': '1.5' })
  expect(withStyleChange({ padding: 1.5 }, { padding: 1 }, bubbleDefaults('speech'))).toBeNull()
})

// BubbleStyleBlock.test.tsx
it('sets the padding, and has no padding for a sound effect', () => {
  const first = mount()
  expect(screen.getByLabelText('Padding')).toHaveValue('100')
  fireEvent.change(screen.getByLabelText('Padding'), { target: { value: '150' } })
  expect(first.onStyle).toHaveBeenCalledWith({ padding: 1.5 })
  first.view.unmount()
  mount({ autoShape: 'sfx' })
  expect(screen.queryByLabelText('Padding')).toBeNull()
})
```

Existing tests to change: add `padding: 1` to the `toEqual` in "knows each shape's default look", and in "shows the look the bubble has" replace `getByText('100%')` with `expect(screen.getAllByText('100%')).toHaveLength(2)`, since Size and Padding now both read 100%.

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run src/shared/schemas.test.ts src/renderer/src/components/visualizer/bubble-style.test.ts src/renderer/src/components/panel-editor/BubbleStyleBlock.test.tsx`
Expected: FAIL on the new cases.

- [ ] **Step 3: Implement**

- Schema: `padding: z.number().min(0.3).max(2).optional()`, with a doc comment saying it multiplies the shape's own padding.
- `bubbleDefaults` base gains `padding: 1`. `bubbleStyleProps` sets `--bubble-padding` to `String(style.padding)`.
- `styles.css`: each rule becomes `padding: calc(Aem * var(--bubble-padding, 1)) calc(Bem * var(--bubble-padding, 1))` with speech and whisper (1, 1.35), shout (1.7, 1.9), thought (1.9, 2.4), caption (0.5, 0.75).
- `BubbleStyleBlock`: a `Padding` field right after `Size`, same markup as Size, `min={30} max={200} step={5}`, reporting `change({ padding: Number(e.target.value) / 100 })`. Only when `shape !== 'sfx'`.
- The three tool descriptions: insert `padding` after `size` in the key list.
- `panel-editing.md:155`: add `` `padding` (0.3 to 2, a multiplier of the room between the text and the outline) `` after `size`.

- [ ] **Step 4: Run the tests, then the whole check**

Run: `npm run check`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add docs/superpowers/specs/2026-11-09-merged-bubbles-design.md docs/superpowers/plans/2026-11-09-merged-bubbles.md src resources
git commit -m "feat: a padding control for each bubble"
```

---

### Task 2: Grouping overlapping bubbles

**Files:**
- Create: `src/renderer/src/components/visualizer/bubble-merge.ts`
- Test: `src/renderer/src/components/visualizer/bubble-merge.test.ts`

**Interfaces:**
- Consumes: `bubbleDefaults` from `bubble-style.ts`.
- Produces:

```ts
export interface MergeBox { index: number; key: string | null; left: number; top: number; width: number; height: number }
export function mergeKey(shape: BubbleShape, style: BubbleStyle | null): string | null
/** Groups of two or more overlapping boxes with equal non-null keys, as MergeBox `index` values, ascending; groups ordered by first index. */
export function mergeGroups(boxes: MergeBox[]): number[][]
```

- [ ] **Step 1: Write the failing tests**

```ts
const box = (index: number, left: number, top = 0, key: string | null = 'a', width = 10, height = 10): MergeBox => ({ index, key, left, top, width, height })

it('groups overlapping boxes with the same key', () => expect(mergeGroups([box(0, 0), box(1, 5)])).toEqual([[0, 1]]))
it('does not count touching edges', () => expect(mergeGroups([box(0, 0), box(1, 10)])).toEqual([]))
it('chains through a shared neighbour', () => expect(mergeGroups([box(2, 16), box(0, 0), box(1, 8)])).toEqual([[0, 1, 2]]))
it('keeps different keys apart', () => expect(mergeGroups([box(0, 0, 0, 'a'), box(1, 5, 0, 'b')])).toEqual([]))
it('leaves out a box with no key', () => expect(mergeGroups([box(0, 0, 0, null), box(1, 5, 0, null)])).toEqual([]))
it('ignores empty boxes, as jsdom gives', () => expect(mergeGroups([box(0, 0, 0, 'a', 0, 0), box(1, 0, 0, 'a', 0, 0)])).toEqual([]))

it('resolves the key through the defaults', () => expect(mergeKey('speech', null)).toBe(mergeKey('speech', { fill: '#ffffff', stroke: '#111111', strokeWidth: 2 })))
it('separates shapes and colours', () => {
  expect(mergeKey('speech', null)).not.toBe(mergeKey('whisper', null))
  expect(mergeKey('speech', null)).not.toBe(mergeKey('speech', { fill: '#ff0000' }))
})
it('has no key for a shape that does not merge', () => {
  expect(mergeKey('caption', null)).toBeNull()
  expect(mergeKey('sfx', null)).toBeNull()
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/renderer/src/components/visualizer/bubble-merge.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement `mergeKey` and `mergeGroups` in `bubble-merge.ts`**

Overlap is strict on both axes. Connected components with union-find or a flood over the pairs.

- [ ] **Step 4: Run to verify it passes**

Same command. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/visualizer/bubble-merge.ts src/renderer/src/components/visualizer/bubble-merge.test.ts
git commit -m "feat: group overlapping bubbles of the same look"
```

---

### Task 3: The merged layer in the overlay

**Files:**
- Create: `src/renderer/src/components/visualizer/use-bubble-box.ts` (moved from `BubbleTailArt.tsx`)
- Create: `src/renderer/src/components/visualizer/use-merged-bubbles.ts`
- Create: `src/renderer/src/components/visualizer/MergedBubbles.tsx`
- Modify: `src/renderer/src/components/visualizer/BubbleBody.tsx`, `BubbleTailArt.tsx`, `DialogueOverlay.tsx`, `src/renderer/src/styles.css`
- Test: `src/renderer/src/components/visualizer/DialogueOverlay.test.tsx`

**Interfaces:**
- Consumes: `mergeKey`, `mergeGroups`, `MergeBox` from Task 2.
- Produces:

```ts
// use-bubble-box.ts: useBubbleBox and BubbleBox as they were, plus
/** Screen px for each px at the overlay's own scale. */
export function overlayScale(overlay: HTMLElement): number

// BubbleBody.tsx
export type BodyPass = 'outline' | 'fill'
export const BODY_VIEW_BOX: Record<'shout' | 'thought', string>
export function BodyArt(props: { shape: 'shout' | 'thought'; pass: BodyPass }): ReactNode

// use-merged-bubbles.ts
export interface MergedMember { index: number; left: number; top: number; width: number; height: number }
export type MergedGroup = MergedMember[]
export function useMergedBubbles(overlay: RefObject<HTMLElement | null>): MergedGroup[]

// MergedBubbles.tsx
export function MergedBubbles(props: { groups: MergedGroup[]; lookOf(index: number): { shape: MergeableShape; fill: string; stroke: string; strokeWidth: number } }): ReactNode
```

- [ ] **Step 1: Write the failing tests in `DialogueOverlay.test.tsx`**

Mock `Element.prototype.getBoundingClientRect` as `BubbleTailArt.test.tsx` does, returning a rect per bubble from its text. Lines placed with `placement: at(...)`. The overlay's rect is 400 x 600.

```ts
it('merges two overlapping placed bubbles of the same look', () => {
  // rects: A 0,0,100,50; B 60,0,100,50
  const { container } = render(<DialogueOverlay dialogue={[placed('A'), placed('B')]} />) // no `editing`: the strip and export
  expect(container.querySelectorAll('.dialogue-merge ellipse')).toHaveLength(4)
  expect(container.querySelectorAll('.bubble-merged')).toHaveLength(2)
  expect(container.querySelector('.dialogue-merge')!.nextElementSibling).toHaveClass('dialogue-placed')
})
it('draws no layer when nothing overlaps', () => { /* B at 200,0: no .dialogue-merge, no .bubble-merged */ })
it('leaves bubbles of different looks alone', () => { /* B style { fill: '#ff0000' }, overlapping: no .bubble-merged */ })
it('leaves a bubble in the automatic layout alone', () => { /* B with placement null, overlapping: no .bubble-merged */ })
it('draws in the overlay own scale when the stage is zoomed', () => {
  // getComputedStyle(overlay).width = '200px', overlay rect width 400, so scale 2. A rect 0,0,100,50 -> rx of its outline ellipse is 25.
})
it('keeps a merged bubble merged while its text is open', () => {
  // editing({ textEditing: 0, textEditor: <textarea aria-label="t" /> }): the textarea renders inside a .bubble-merged
})
it('never gives an ellipse a negative radius', () => {
  // A and B rects 4 x 4, style { strokeWidth: 6 }: every ellipse's rx and ry is >= 0
})
it('draws a merged whisper dashed, and a shout at three times the outline', () => { /* stroke-dasharray '4 3'; shout outline svg stroke-width 6 with strokeWidth 2 */ })
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/renderer/src/components/visualizer/DialogueOverlay.test.tsx`
Expected: the new cases FAIL.

- [ ] **Step 3: Move `useBubbleBox`**

Move it and `BubbleBox`/`same` to `use-bubble-box.ts`, extracting `overlayScale` from its measure function. `BubbleTailArt.test.tsx` passes unchanged.

- [ ] **Step 4: Split `BubbleBody` by pass**

`BodyArt` returns the shout's polygon for either pass, and the thought's circles for the given pass. `BubbleBody`'s rendered DOM for shout and thought must stay identical.

- [ ] **Step 5: Implement `useMergedBubbles`**

Runs in a layout effect with no dependency list, like `useBubbleBox`. Queries `.dialogue-placed > .bubble[data-merge-key]` under the overlay, builds `MergeBox`es from `getBoundingClientRect` relative to the overlay and divided by `overlayScale`, runs `mergeGroups`, and sets state only when the result differs. A `ResizeObserver` on the overlay and each queried bubble re-measures. Returns `[]` when the ref is null.

- [ ] **Step 6: Implement `MergedBubbles`**

Renders `<svg className="dialogue-merge" aria-hidden="true">`. For each group, a `<g>` with every member's outline pass and then every member's fill pass. With `w`, `h`, `s` = the member's width, height, outline width, and `max0` clamping at 0:

| Shape | Outline pass | Fill pass |
|---|---|---|
| speech | ellipse `rx=w/2 ry=h/2`, fill = outline colour | ellipse `rx=max0(w/2-s) ry=max0(h/2-s)`, fill = fill colour |
| whisper | ellipse `rx=max0(w/2-s/2) ry=max0(h/2-s/2)`, fill = fill colour, stroke = outline colour, width `s`, dasharray `4 3` | same as speech |
| thought | nested `<svg>` with `BodyArt` outline pass, fill and stroke = outline colour, stroke width `2.5s` | nested `<svg>` with `BodyArt` fill pass, fill = fill colour, no stroke |
| shout | nested `<svg>` with `BodyArt`, stroke = outline colour, stroke width `3s`, stroke-linejoin round | nested `<svg>` with `BodyArt`, fill = fill colour, no stroke |

Nested SVGs use `x`, `y`, `width`, `height` of the member, `BODY_VIEW_BOX[shape]`, `preserveAspectRatio="none"`, `overflow="visible"`.

- [ ] **Step 7: Wire `DialogueOverlay`**

- A ref on `.dialogue-overlay`, and `useMergedBubbles(ref)` called before the early return.
- Each bubble in the placed layer with a non-null `mergeKey(b.shape, line.style)` gets `data-merge-key={key}` and `data-merge-index={i}`, which the hook reads as `MergeBox.key` and `.index`. `bubble-merged` goes on any bubble whose index is in a group.
- `<MergedBubbles>` renders just before `.dialogue-placed`, only when a group exists. `lookOf(i)` resolves `{ ...bubbleDefaults(shape), ...line.style }`.

- [ ] **Step 8: Add the stylesheet rules**

```css
.dialogue-merge { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; pointer-events: none; }
.bubble.bubble-merged { background: transparent; border-color: transparent; }
.bubble-merged > .bubble-body { visibility: hidden; }
```

- [ ] **Step 9: Run the tests, then the whole check**

Run: `npm run check`
Expected: PASS, including all existing `PanelStage` and `DialogueOverlay` tests unchanged.

- [ ] **Step 10: Commit**

```bash
git add src
git commit -m "feat: overlapping bubbles of the same look share one outline"
```

---

### Task 4: Fringe and Dark burst

**Files:**
- Create: `src/renderer/src/components/visualizer/bubble-art.ts`
- Modify: `src/shared/schemas.ts:237`, `bubble-style.ts`, `bubble-layout.ts`, `BubbleBody.tsx`, `BubbleStyleBlock.tsx`, `styles.css`, `resources/agent-docs/workflows/panel-editing.md:155`
- Test: `bubble-art.test.ts` (new), `bubble-style.test.ts`, `bubble-layout.test.ts`, `BubbleStyleBlock.test.tsx`, `src/shared/schemas.test.ts`, `src/renderer/src/components/visualizer/bubble-merge.test.ts`

**Interfaces:**
- Consumes: `hasTail` from `bubble-tail.ts`.
- Produces: `BubbleShape` gains `'fringe' | 'burst' | 'curly'`. `curly` is in the enum from here, and Task 5 draws it.

```ts
/** A closed spiky ring as SVG polygon points, centred in a 100 x 100 box. Deterministic. */
export function spikyRing(spikes: number, inner: number, outerMin: number, outerMax: number): string
```

- [ ] **Step 1: Write the failing tests**

```ts
// bubble-art.test.ts
it('gives two points a spike, inside the box, the same every time', () => {
  const ring = spikyRing(72, 38, 44, 50)
  expect(ring.split(' ')).toHaveLength(144)
  for (const value of ring.split(/[ ,]/).map(Number)) { expect(value).toBeGreaterThanOrEqual(0); expect(value).toBeLessThanOrEqual(100) }
  expect(spikyRing(72, 38, 44, 50)).toBe(ring)
})

// bubble-style.test.ts
it('draws a burst dark with white lettering', () => expect(bubbleDefaults('burst')).toMatchObject({ fill: '#111111', color: '#ffffff' }))

// bubble-layout.test.ts: keep the speaker's side, no tail, even with a stored one
it('gives the shapes with no tail none', () => {
  for (const shape of ['fringe', 'burst', 'curly'] as const) {
    const [b] = layoutBubbles([{ ...line('speech', 'Hi', 'c1'), style: { shape }, tail: { x: 0.5, y: 0.9 } }], [cast('c1', 'left')])
    expect(b).toMatchObject({ shape, side: 'left', tail: 'none' })
  }
})

// bubble-merge.test.ts
it('has no key for the new shapes', () => { for (const s of ['fringe', 'burst', 'curly'] as const) expect(mergeKey(s, null)).toBeNull() })

// BubbleStyleBlock.test.tsx
it('offers the new shapes, with no tail controls', () => {
  const first = mount()
  fireEvent.click(within(group('Shape')).getByRole('button', { name: 'Dark burst' }))
  expect(first.onStyle).toHaveBeenCalledWith({ shape: 'burst' })
  first.view.unmount()
  mount({ style: { shape: 'fringe' } })
  expect(screen.queryByRole('group', { name: 'Tail' })).toBeNull()
  expect(screen.queryByLabelText('Outline width')).toBeNull()
})

// schemas.test.ts: each of the three ids parses as a shape.
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/renderer/src/components/visualizer src/renderer/src/components/panel-editor/BubbleStyleBlock.test.tsx src/shared/schemas.test.ts`
Expected: the new cases FAIL.

- [ ] **Step 3: Implement**

- Enum: add the three ids. `bubbleDefaults`: `case 'burst': return { ...base, color: '#ffffff', fill: '#111111' }`.
- `layoutBubbles`: `stored` becomes `'none'` when `!hasTail(shape)`, which covers both return paths.
- `spikyRing`: alternate inner and outer points around a circle centred at 50,50. Each outer radius comes from `outerMin + (outerMax - outerMin) * frac(sin(i * 12.9898) * 43758.5453)`. Round to one decimal.
- `BubbleBody`, each `viewBox="0 0 100 100"`, `preserveAspectRatio="none"`:
  - `fringe`: `<polygon points={spikyRing(96, 40, 44, 50)} />`, then `<ellipse className="bubble-body-fill" cx="50" cy="50" rx="39" ry="39" />`
  - `burst`: `<polygon points={spikyRing(72, 38, 44, 50)} vectorEffect="non-scaling-stroke" />`
  - Module-level constants so each is computed once.
- `styles.css`:
  - `.bubble-fringe` padding (1.9em, 2.2em), `.bubble-burst` padding (1.7em, 1.9em), both multiplied by `--bubble-padding`.
  - `.bubble-burst { color: var(--bubble-color, #fff); }`, `.bubble-burst .bubble-body { fill: var(--bubble-fill, #111); }`, `.bubble-burst .bubble-body polygon { stroke-width: var(--bubble-stroke-width, 2px); stroke-linejoin: round; }`
  - `.bubble-fringe .bubble-body polygon { fill: var(--bubble-stroke, #111); stroke: none; }`, `.bubble-fringe .bubble-body-fill { stroke: none; }`
- `BubbleStyleBlock`: three `SHAPES` entries with the labels above and small 24 x 16 glyphs. Outline width shows only when `shape !== 'sfx' && shape !== 'fringe'`.
- `panel-editing.md:155`: add `fringe`, `burst`, `curly` to the shape list.

- [ ] **Step 4: Run the whole check**

Run: `npm run check`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src resources
git commit -m "feat: fringe and dark burst bubble shapes"
```

---

### Task 5: Curly frame

**Files:**
- Create: `src/renderer/src/components/visualizer/curly-frame.ts`
- Modify: `BubbleBody.tsx`, `styles.css`
- Test: `src/renderer/src/components/visualizer/curly-frame.test.ts`, `DialogueOverlay.test.tsx`

**Interfaces:**
- Consumes: `useBubbleBox` from Task 3.
- Produces: `export function curlyFramePath(width: number, height: number, loop: number): string`

- [ ] **Step 1: Write the failing tests**

```ts
const curves = (d: string) => d.match(/C/g)?.length ?? 0

it('fits whole loops along each side', () => expect(curves(curlyFramePath(200, 100, 10))).toBe(52)) // inner 178 x 78: 18 and 8 a side
it('is one closed path', () => { const d = curlyFramePath(200, 100, 10); expect(d.startsWith('M')).toBe(true); expect(d.endsWith('Z')).toBe(true); expect(d).not.toContain('NaN') })
it('keeps loops round on a wide box', () => expect(curves(curlyFramePath(400, 100, 10))).toBe(2 * (38 + 8)))
it('draws nothing for a box too small to hold a loop', () => {
  expect(curlyFramePath(0, 0, 10)).toBe('')
  expect(curlyFramePath(20, 200, 10)).toBe('')
})

// DialogueOverlay.test.tsx
it('draws a curly bubble with no path until it is measured', () => {
  // no rect mock, style { shape: 'curly' }: .bubble-body exists and its path has no d, or there is no path
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/renderer/src/components/visualizer/curly-frame.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement `curlyFramePath`**

`inset = loop * 1.1`. The inner rectangle is `width - 2 * inset` by `height - 2 * inset`; return `''` if either is not positive. Each side gets `n = max(1, round(length / loop))` segments, walked clockwise from the top-left. For a segment from `P` to `Q`, length `L`, unit direction `T` and outward normal `N`:

```
C  Q + N * 1.4L + T * 0.2L,  P + N * 1.4L - T * 0.2L,  Q
```

Control points ahead of `Q` and behind `P` make the curve cross itself, which is the loop. Round to two decimals and end with `Z`.

- [ ] **Step 4: Draw it**

`BubbleBody` renders a `CurlyBody` for `curly`: an `<svg className="bubble-body" aria-hidden="true">` with a ref, no viewBox, and a `<path>` only when `useBubbleBox(ref)` has measured and the path is non-empty. It calls `curlyFramePath(box.width, box.height, 0.55 * em)`.

`styles.css`: `.bubble-curly` padding (1.3em, 1.6em) multiplied by `--bubble-padding`, and `.bubble-curly .bubble-body path { stroke-width: var(--bubble-stroke-width, 2px); stroke-linejoin: round; }`.

- [ ] **Step 5: Run the whole check**

Run: `npm run check`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src
git commit -m "feat: a curly frame bubble shape"
```

---

### Task 6: Prove it in the built app

**Files:**
- Test: `tests/e2e/panel-editing.spec.ts`, `tests/e2e/export.spec.ts`

**Interfaces:**
- Consumes: `openPanelWith`, `dragBubble` and `boxOf` in `panel-editing.spec.ts`.

- [ ] **Step 1: Add the end-to-end tests**

In `panel-editing.spec.ts`, `'overlapping bubbles share one outline, and part when dragged apart'`:

- Open a panel with two placed speech lines apart. Assert `.dialogue-merge` has count 0.
- `dragBubble` one onto the other. Assert `.bubble-merged` has count 2 and `.dialogue-merge` is visible.
- Drag it clear. Assert `.bubble-merged` has count 0.

In `export.spec.ts`, extend the export fixture or add a test with two overlapping placed bubbles. Assert that the exported image differs from one exported with `Without lettering`, and read the pixel at the middle of the overlap, on what would be the first bubble's outline: it is the fill colour, not the outline colour.

- [ ] **Step 2: Run them**

Run: `npm run build`, then `npx playwright test tests/e2e/panel-editing.spec.ts tests/e2e/export.spec.ts`
Expected: PASS. `"a selected bubble under another takes the press"` is the existing test most likely to notice merging. A lone failure in a drag may be the known rare flake: rerun before calling it a regression.

- [ ] **Step 3: Look at it**

Using the built app, screenshot and inspect:

- Overlapping pairs of `speech`, `whisper`, `shout` and `thought`.
- Each new shape at a narrow and a wide width.
- Padding at 30% and 200%.
- One bubble overlapping nothing, compared with the same panel on `origin/main` for a pixel match.

Expected: one outline per pair, round curly loops, and no change to the lone bubble.

- [ ] **Step 4: Run everything**

Run: `npm run check`, then `npm run test:e2e`
Expected: PASS. Live specs skip.

- [ ] **Step 5: Commit**

```bash
git add tests
git commit -m "test: merged bubbles in the editor and in an export"
```
