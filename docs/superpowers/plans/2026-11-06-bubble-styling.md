# Bubble Styling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user add their own bubbles, style each one (shape, font, size, colours, outline), and drag the point of its tail to wherever it should point. The strip, the stage and the export all draw the result the same way.

**Architecture:** Two new nullable fields on a dialogue line, `style` and `tail`, travel through the existing `panels:update` and inherit by index like `placement`. `DialogueOverlay` turns them into CSS variables, inline SVG bodies and a measured SVG tail. Editing adds a dot on the stage (`useBubbleEditing`), a style block under the selected row in Lines, and an Add bubble menu.

**Tech Stack:** Electron, React 19, TypeScript, zod 4, Vitest with Testing Library (jsdom has no layout, so rects are mocked), Playwright for Electron.

**Spec:** `docs/superpowers/specs/2026-11-06-bubble-styling-design.md`

## Global Constraints

- Work on a branch `feat/bubble-styling` cut from `origin/main`, in a worktree. The PR targets `main`.
- A line with `style: null` and `tail: null` draws exactly as it does today. The existing ratio check in `tests/e2e/export.spec.ts` stays green unchanged.
- No new IPC channel. No change to `prompts.ts` or `prompt-templates.md`: style never reaches an image prompt.
- Colours are `#rrggbb`, checked by the schema. Fonts are the `BubbleFont` enum only: the policy loads nothing from the network, and every face is imported through one module used by both `main.tsx` and `export-main.tsx`.
- The tip is stored as panel fractions from 0 to 1. Pointer math stays in screen px, as in `placementFromPointer`.
- Every UI string is asserted verbatim in tests. Use the strings in the spec, section 5.
- Match the app: `styles.css` tokens, IBM Plex, 32 px controls, radius 6, no shadow at rest, the accent only on what is selected or dragged. No gradients, glows or emoji, and nothing under 11 px. Spelling in strings and code is British (`colour`, `Centre`).
- `npm run check`, which includes `knip`, passes at the end of every task: export a symbol only once something, or a test, uses it. `FONTS` stays unexported until Task 6.

## Review Focus

1. An agent rewords a styled line, sending no `style` or `tail`: the look stays, as a placement does. Tests in Tasks 1 and 8.
2. A middle bubble is deleted: every later line keeps its own look, and none takes on its neighbour's. Tests in Task 1.
3. A project saved before this work opens and looks the same: lines load with nulls and carry no inline style. Tests in Tasks 1 and 3.
4. Export draws styled lettering, new fonts and tails, and "Without lettering" draws none of them. Test in Task 4.
5. A line with a tail is switched to a caption or sound effect: the tail and the dot go, and they return when it is switched back. Test in Task 4.

---

### Task 1: The data model

**Files:**
- Modify: `src/shared/schemas.ts`, `src/shared/types.ts`, `src/main/domain/panel-service.ts:117,169,453-456`, `src/renderer/src/components/panel-editor/dialogue-edits.ts`, `src/renderer/src/components/panel-editor/LinesTab.tsx:243`, `src/renderer/src/components/panel-editor/use-bubble-editing.ts:215,236`
- Test: `src/shared/schemas.test.ts`, `src/main/domain/panel-service.test.ts`, `src/renderer/src/components/panel-editor/dialogue-edits.test.ts`, `src/renderer/src/components/panel-editor/PanelStage.test.tsx`

**Interfaces:**
- Produces: `BubbleShapeSchema`, `BubbleFontSchema`, `BubbleStyleSchema`, `BubbleTailSchema` in `@shared/schemas`. Types `BubbleShape`, `BubbleFont`, `BubbleStyle`, `BubbleTail` in `@shared/types`. `DialogueLine` gains `style: BubbleStyle | null` and `tail: BubbleTail | null`.

- [ ] **Step 0: Bring the design documents onto the branch**

They are untracked in the `main` checkout, so a worktree cut from `origin/main` does not have them. Copy these four files from that checkout into the worktree at the same paths, then commit them as the branch's first commit:

- `docs/superpowers/specs/2026-11-06-bubble-styling-design.md`
- `docs/superpowers/specs/2026-11-06-bubble-styling-prototype.html`
- `docs/superpowers/specs/2026-11-06-bubble-styling-prototype.png`
- `docs/superpowers/plans/2026-11-06-bubble-styling.md`

```bash
git add docs/superpowers
git commit -m "docs: design and plan bubble styling"
```

- [ ] **Step 1: Write the failing tests**

In `schemas.test.ts`:

```ts
const base = { id: 'dlg_0000000001', speakerId: null, kind: 'speech', text: 'A' }

it('loads a line saved before bubbles had a look', () => {
  const line = DialogueLineSchema.parse(base)
  expect(line.style).toBeNull()
  expect(line.tail).toBeNull()
})

it('accepts a bubble style and every form of tail', () => {
  const style = { shape: 'shout', font: 'impact', size: 1.5, bold: false, italic: true, caps: false, align: 'left', color: '#ff0000', fill: '#00FF00', stroke: '#000000', strokeWidth: 6 }
  expect(DialogueLineSchema.parse({ ...base, style }).style).toEqual(style)
  expect(DialogueLineSchema.parse({ ...base, tail: 'none' }).tail).toBe('none')
  expect(DialogueLineSchema.parse({ ...base, tail: { x: 0.2, y: 1 } }).tail).toEqual({ x: 0.2, y: 1 })
})

it.each([
  { style: { color: 'red' } },
  { style: { fill: 'url(x)' } },
  { style: { font: 'Arial' } },
  { style: { size: 4 } },
  { style: { strokeWidth: 7 } },
  { tail: { x: 1.2, y: 0 } },
  { tail: 'down' }
])('refuses what the app cannot draw: %j', (bad) => {
  expect(() => DialogueLineSchema.parse({ ...base, ...bad })).toThrow()
})

it('keeps "inherit" apart from "clear" in a patch', () => {
  const [bare] = PanelPatchSchema.parse({ dialogue: [{ speakerId: null, kind: 'narration', text: 'A' }] }).dialogue ?? []
  expect(bare.style).toBeUndefined()
  expect(bare.tail).toBeUndefined()
  const [cleared] = PanelPatchSchema.parse({ dialogue: [{ speakerId: null, kind: 'narration', text: 'A', style: null, tail: null }] }).dialogue ?? []
  expect(cleared.style).toBeNull()
  expect(cleared.tail).toBeNull()
})
```

In `panel-service.test.ts`, using the file's existing setup:

- `keeps a line's style and tail when an agent rewords it`: store a line with `style: { fill: '#ff0000' }, tail: { x: 0.2, y: 0.9 }`. Update with `{ dialogue: [{ speakerId: null, kind: 'speech', text: 'New' }] }`. Expect the text to be `New` and both values unchanged.
- `clears them on an explicit null`: same update with `style: null, tail: null`. Expect both null.
- `gives a created line no look`: `create` with a bare line. Expect both null.

In `dialogue-edits.test.ts`:

- `sends every line's look, null included, so none falls back to inheriting`: `toDrafts` of a styled line and an unstyled one. Expect `toHaveProperty('style', null)` and `toHaveProperty('tail', null)` on the unstyled draft, and the values on the styled draft.
- `keeps each look on its own line when a middle line is removed`: lines with looks a, b, c. `removeLine(lines, 1, identityOf(lines[1]))`. Expect drafts with looks a and c.

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run src/shared/schemas.test.ts src/main/domain/panel-service.test.ts src/renderer/src/components/panel-editor/dialogue-edits.test.ts`
Expected: FAIL. The fields don't exist, and `toDrafts` drops them.

- [ ] **Step 3: Implement**

- `schemas.ts`: add the four schemas, with `HexColor = z.string().regex(/^#[0-9a-f]{6}$/i)`. Every `BubbleStyleSchema` key is `.optional()`, with bounds from the spec, section 3. `BubbleTailSchema = z.union([z.enum(['none']), BubblePlacementSchema])`: an enum, not `z.literal`, because tool schemas go to every provider through `z.toJSONSchema` (`registry.ts:64`) and no tool-facing schema uses `const` today.
- `DialogueLineSchema`: `style` and `tail` as `.nullable().default(null)`.
- `DialogueDraftSchema`: `.omit({ id: true }).extend({ placement, style, tail })`, all `.nullable().optional()` with no default.
- `panel-service.ts`: `withId(line, inherited: Pick<DialogueLine, 'placement' | 'style' | 'tail'> | undefined)`. Each field is `line.x === undefined ? (inherited?.x ?? null) : line.x`. `create` passes `undefined`, and `update` passes `current.dialogue[i]`.
- `dialogue-edits.ts`: `toDrafts` passes `style` and `tail`.
- `LinesTab.tsx` and `use-bubble-editing.ts`: new and appended lines carry `style: null, tail: null`.

- [ ] **Step 4: Update the fake server in `PanelStage.test.tsx:79`**

It must inherit like the service, or it cannot catch a look moving between lines:

```ts
const dialogue = (req.patch.dialogue ?? []).map((line, i) => ({
  ...line,
  id: `dlg_${String((ids += 1)).padStart(10, '0')}`,
  placement: line.placement ?? null,
  style: line.style === undefined ? (stored.dialogue[i]?.style ?? null) : line.style,
  tail: line.tail === undefined ? (stored.dialogue[i]?.tail ?? null) : line.tail
}))
```

Add the test `deleting a middle bubble leaves each look on its own line`: three lines with fills a, none, c. Select the second, press Delete, and expect stored fills a, c on the two lines left.

- [ ] **Step 5: Run everything and fix fixtures**

Run: `npm run check`
Expected: type errors only in fixtures typed `DialogueLine`, and `toEqual` failures on line literals. Add `style: null, tail: null` to each. PASS.

- [ ] **Step 6: Commit**

```bash
git add src tests
git commit -m "feat: store a look and a tail on each dialogue line"
```

---

### Task 2: Tail geometry

**Files:**
- Create: `src/renderer/src/components/visualizer/bubble-tail.ts`, `src/renderer/src/components/visualizer/bubble-tail.test.ts`

**Interfaces:**
- Consumes: `BubbleShape` from Task 1. `BubbleSide` from `bubble-layout.ts`.
- Produces, all in px from the bubble's centre:
  - `type Point = { x: number; y: number }`, `type Size = { width: number; height: number }`
  - `type TailedShape = 'speech' | 'shout' | 'whisper' | 'thought'`
  - `hasTail(shape: BubbleShape): shape is TailedShape`
  - `tailWedge(a: { box: Size; tip: Point; em: number; stroke: number; shape: TailedShape }): { a: Point; tip: Point; b: Point } | null`
  - `thoughtPuffs(a: { box: Size; tip: Point; em: number }): { cx: number; cy: number; rx: number; ry: number }[]`
  - `restingTip(a: { box: Size; em: number; side: BubbleSide; drawing: 'down' | 'edge' | 'none' }): Point`

- [ ] **Step 1: Write the failing tests**

With `const box = { width: 200, height: 100 }, em = 15, stroke = 2`:

```ts
describe('tailWedge', () => {
  it('puts both root ends on the inner edge of the outline', () => {
    const g = tailWedge({ box, tip: { x: 60, y: 120 }, em, stroke, shape: 'speech' })!
    for (const p of [g.a, g.b]) expect((p.x / 98) ** 2 + (p.y / 48) ** 2).toBeCloseTo(1, 5)
  })
  it('ends at the tip it was given', () => {
    expect(tailWedge({ box, tip: { x: 60, y: 120 }, em, stroke, shape: 'speech' })!.tip).toEqual({ x: 60, y: 120 })
  })
  it('centres the root on the way to the tip', () => {
    const g = tailWedge({ box, tip: { x: 0, y: 120 }, em, stroke, shape: 'speech' })!
    expect(g.a.x).toBeCloseTo(-g.b.x, 5)
    expect(g.a.y).toBeCloseTo(g.b.y, 5)
    expect(g.a.y).toBeGreaterThan(0)
  })
  it('draws nothing while the tip is inside the body', () => {
    expect(tailWedge({ box, tip: { x: 10, y: 10 }, em, stroke, shape: 'speech' })).toBeNull()
  })
  it('keeps a usable root on a short tail, and widens only a little on a long one', () => {
    const width = (tip: Point) => {
      const g = tailWedge({ box, tip, em, stroke, shape: 'speech' })!
      return Math.hypot(g.a.x - g.b.x, g.a.y - g.b.y)
    }
    expect(width({ x: 0, y: 60 })).toBeGreaterThan(em)
    expect(width({ x: 0, y: 400 })).toBeLessThanOrEqual(50)
  })
  it('roots a shout inside its spikes', () => {
    const g = tailWedge({ box, tip: { x: 160, y: 0 }, em, stroke, shape: 'shout' })!
    expect(Math.abs(g.a.x)).toBeLessThan(100 * 0.82)
  })
})

describe('thoughtPuffs', () => {
  it('draws three shrinking puffs, the last on the tip', () => {
    const p = thoughtPuffs({ box, tip: { x: 90, y: 120 }, em })
    expect(p).toHaveLength(3)
    expect(p[0].rx).toBeGreaterThan(p[1].rx)
    expect(p[1].rx).toBeGreaterThan(p[2].rx)
    expect(p[2].cx).toBeCloseTo(90)
    expect(p[2].cy).toBeCloseTo(120)
  })
  it('draws none while the tip is inside the body', () => {
    expect(thoughtPuffs({ box, tip: { x: 10, y: 10 }, em })).toEqual([])
  })
})

describe('restingTip', () => {
  it('rests where the automatic wedge ends', () => {
    expect(restingTip({ box, em, side: 'left', drawing: 'down' }).x).toBeLessThan(0)
    expect(restingTip({ box, em, side: 'right', drawing: 'down' }).x).toBeGreaterThan(0)
    expect(restingTip({ box, em, side: 'center', drawing: 'down' }).x).toBeCloseTo(0)
    expect(restingTip({ box, em, side: 'left', drawing: 'down' }).y).toBeGreaterThan(50)
    expect(restingTip({ box, em, side: 'left', drawing: 'edge' }).y).toBeLessThan(-50)
  })
  it('rests below a bubble with no tail', () => {
    expect(restingTip({ box, em, side: 'left', drawing: 'none' })).toEqual({ x: 0, y: 50 + 1.1 * em })
  })
})

it('gives tails to the four shapes that speak from someone', () => {
  expect(['speech', 'shout', 'whisper', 'thought', 'caption', 'sfx'].map((s) => hasTail(s as BubbleShape))).toEqual([true, true, true, true, false, false])
})
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run src/renderer/src/components/visualizer/bubble-tail.test.ts`
Expected: FAIL, the module doesn't exist.

- [ ] **Step 3: Implement**

This is the geometry rendered in the prototype (spec section 4.3). It walks along the ellipse by its parameter, so both root ends land exactly on the outline at any angle:

```ts
/** The part of the box the shape's body fills. A shout's spikes and a cloud's bumps stop short of their box. */
const BODY: Record<TailedShape, { rx: number; ry: number }> = {
  speech: { rx: 1, ry: 1 },
  whisper: { rx: 1, ry: 1 },
  shout: { rx: 0.81, ry: 0.67 },
  thought: { rx: 0.85, ry: 0.8 }
}

export function tailWedge({ box, tip, em, stroke, shape }: TailInput): { a: Point; tip: Point; b: Point } | null {
  const body = BODY[shape]
  const A = Math.max((box.width / 2) * body.rx - stroke, 1)
  const B = Math.max((box.height / 2) * body.ry - stroke, 1)
  if ((tip.x / (A + stroke)) ** 2 + (tip.y / (B + stroke)) ** 2 <= 1) return null
  const root = Math.min(1.1 * em + 0.08 * Math.hypot(tip.x, tip.y), 0.5 * Math.min(box.width, box.height))
  const phi = Math.atan2(tip.y / B, tip.x / A)
  const speed = Math.hypot(A * Math.sin(phi), B * Math.cos(phi))
  const half = Math.min(root / 2 / speed, Math.PI / 4)
  const at = (t: number): Point => ({ x: A * Math.cos(t), y: B * Math.sin(t) })
  return { a: at(phi - half), tip, b: at(phi + half) }
}
```

`thoughtPuffs`: find `r`, the distance to the cloud's ellipse along the line to the tip. Return `[]` when `length <= r`. Otherwise place puffs at `t` = 0.3, 0.65, 1 from there to the tip, with `rx` = 0.42, 0.28, 0.17 em and `ry = rx * 0.8`.

`restingTip`:
- `down`: y is `box.height / 2 + 1.1 * em`. x is `0` in the centre, and `±(box.width * 0.26 - 0.18 * em)` to the sides (left negative), matching the CSS wedge at 24%.
- `edge`: the same x, y negated.
- `none`: `{ x: 0, y: box.height / 2 + 1.1 * em }`.

- [ ] **Step 4: Run them to verify they pass**

Run: `npx vitest run src/renderer/src/components/visualizer/bubble-tail.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/visualizer/bubble-tail.ts src/renderer/src/components/visualizer/bubble-tail.test.ts
git commit -m "feat: work out where a bubble's tail joins its outline"
```

---

### Task 3: Styled lettering

**Files:**
- Create: `src/renderer/src/components/visualizer/bubble-style.ts`, `src/renderer/src/components/visualizer/bubble-style.test.ts`, `src/renderer/src/components/visualizer/BubbleBody.tsx`, `src/renderer/src/lettering-fonts.ts`
- Modify: `src/renderer/src/components/visualizer/bubble-layout.ts:7,41`, `src/renderer/src/components/visualizer/DialogueOverlay.tsx`, `src/renderer/src/styles.css:2184-2467`, `src/renderer/src/main.tsx:9-12`, `src/renderer/src/export-main.tsx:9-11`, `package.json`
- Test: `src/renderer/src/components/visualizer/bubble-layout.test.ts`, `src/renderer/src/components/visualizer/DialogueOverlay.test.tsx`

**Interfaces:**
- Consumes: `BubbleStyle`, `BubbleShape`, `BubbleFont` from Task 1.
- Produces:
  - `bubbleDefaults(shape: BubbleShape): Required<Omit<BubbleStyle, 'shape'>>`
  - `bubbleStyleProps(style: BubbleStyle | null): CSSProperties`
  - `withStyleChange(style: BubbleStyle | null, change: Partial<BubbleStyle>, defaults: Required<Omit<BubbleStyle, 'shape'>>): BubbleStyle | null`
  - `FONTS: { id: BubbleFont; label: string; family: string }[]`
  - `bubbleShape(line)` now honours `line.style?.shape`.

- [ ] **Step 1: Write the failing tests**

`bubble-style.test.ts`:

```ts
it('knows each shape\'s default look', () => {
  expect(bubbleDefaults('speech')).toEqual({ font: 'comic', size: 1, bold: true, italic: false, caps: true, align: 'center', color: '#111111', fill: '#ffffff', stroke: '#111111', strokeWidth: 2 })
  expect(bubbleDefaults('whisper').bold).toBe(false)
  expect(bubbleDefaults('thought').bold).toBe(false)
  expect(bubbleDefaults('caption').align).toBe('left')
  expect(bubbleDefaults('sfx')).toMatchObject({ font: 'bangers', bold: false, color: '#ffffff' })
})

it('sets nothing for a line with no style', () => {
  expect(bubbleStyleProps(null)).toEqual({})
})

it('turns a style into variables and text properties', () => {
  expect(bubbleStyleProps({ size: 1.5, fill: '#ff0000', stroke: '#00ff00', strokeWidth: 5, color: '#0000ff' })).toEqual({
    '--bubble-size': '1.5', '--bubble-fill': '#ff0000', '--bubble-stroke': '#00ff00', '--bubble-stroke-width': '5px', '--bubble-color': '#0000ff'
  })
  expect(bubbleStyleProps({ bold: false, italic: true, caps: false, align: 'right' })).toEqual({ fontWeight: 400, fontStyle: 'italic', textTransform: 'none', textAlign: 'right' })
  expect(bubbleStyleProps({ bold: true }).fontWeight).toBe(700)
  expect(bubbleStyleProps({ font: 'impact' }).fontFamily).toContain('Anton')
})

it('stores only what differs from the default, and nothing when nothing does', () => {
  const d = bubbleDefaults('speech')
  expect(withStyleChange(null, { bold: false }, d)).toEqual({ bold: false })
  expect(withStyleChange({ bold: false }, { bold: true }, d)).toBeNull()
  expect(withStyleChange({ shape: 'shout', fill: '#ff0000' }, { shape: undefined }, d)).toEqual({ fill: '#ff0000' })
})
```

`bubble-layout.test.ts`:

- `draws the chosen shape whatever the words say`: `bubbleShape({ kind: 'speech', text: 'Hello.', style: { shape: 'shout' } })` is `'shout'`, and `bubbleShape({ kind: 'speech', text: 'STOP!', style: { shape: 'speech' } })` is `'speech'`.

`DialogueOverlay.test.tsx`:

- `gives an unstyled bubble no inline style, as before`: `bubbleOf(...).getAttribute('style')` is null in the flow.
- `keeps a placed bubble's position beside its look`: `style.left` is `25%`, and `style.getPropertyValue('--bubble-fill')` is the fill.
- `draws shouts and thoughts from inline SVG`: `.bubble-shout .bubble-body polygon` and `.bubble-thought .bubble-body circle` exist. Speech has no `.bubble-body`.
- `puts a line shaped as a sound effect in the sound-effect layer`: `kind: 'speech', style: { shape: 'sfx' }`, parent has class `dialogue-sfx`.

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run src/renderer/src/components/visualizer`
Expected: FAIL.

- [ ] **Step 3: Implement the style and the bodies**

- `bubble-style.ts`: the three functions and `FONTS`, with `comic` Comic Neue, `bangers` Bangers, `hand` Patrick Hand, `impact` Anton, `serif` Lora, `typewriter` Special Elite. Each family falls back to `'Comic Neue', var(--font)`.
- `bubble-layout.ts`: import `BubbleShape` from `@shared/types`, and rename the local tail type to `TailDrawing`. `bubbleShape` takes `Pick<DialogueLine, 'kind' | 'text'> & { style?: BubbleStyle | null }` and returns `line.style?.shape` first.
- `BubbleBody.tsx`: `BubbleBody({ shape })` returns an `aria-hidden` `<svg className="bubble-body" preserveAspectRatio="none">` for `shout` and `thought`, and `null` otherwise. Copy the viewBoxes and the points and circles from `styles.css:2300` and `:2391` as constants, with `vectorEffect="non-scaling-stroke"`.
- `DialogueOverlay.tsx`: merge `bubbleStyleProps(line.style)` with the position into `style`, passing `undefined` when both are empty. Render `<BubbleBody>` before the text. Choose the sound-effect layer by `b.shape === 'sfx'`, not by kind.

- [ ] **Step 4: Update the CSS, keeping every default**

- Multiply by `var(--bubble-size, 1)` in each of the six `font-size` calcs (lines 2190, 2297, 2389, 2439, 2450, 2462).
- `.bubble`: `color: var(--bubble-color, #111)`. `.bubble-sfx`: `color: var(--bubble-color, #fff)`, and `var(--bubble-stroke, #111)` in its `text-shadow` and `-webkit-text-stroke`.
- `.bubble-speech, .bubble-whisper, .bubble-caption`: `background: var(--bubble-fill, #fff)`, `border-width: var(--bubble-stroke-width, 2px)`, `border-color: var(--bubble-stroke, #111)`. Caption's `box-shadow` uses `--bubble-stroke`.
- The tail wedges and thought puffs use `--bubble-stroke` and `--bubble-fill` where they hard-code `#111` and `#fff`.
- Remove the data-URI backgrounds from `.bubble-shout` and `.bubble-thought`.
- Add `.bubble-body { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; pointer-events: none; fill: var(--bubble-fill, #fff); stroke: var(--bubble-stroke, #111); }`.
- Shout's polygon: `stroke-width: calc(var(--bubble-stroke-width, 2px) * 1.5)`. Thought's outline circles: `calc(var(--bubble-stroke-width, 2px) * 2.5)`.
- `.bubble-text, .bubble-editor { position: relative; }`, and `.bubble-editor { text-align: inherit; }`.

- [ ] **Step 5: Bundle the fonts**

Run: `npm install @fontsource/patrick-hand @fontsource/anton @fontsource/lora @fontsource/special-elite`

Create `lettering-fonts.ts`. It imports Comic Neue's `latin-400`, `latin-700`, `latin-400-italic` and `latin-700-italic`, Bangers, Patrick Hand and Anton `latin-400`, Lora's `latin-400`, `latin-700`, `latin-400-italic` and `latin-700-italic`, and Special Elite `latin-400`. Replace the lettering imports in `main.tsx` and `export-main.tsx` with `import './lettering-fonts'`.

- [ ] **Step 6: Verify the default look did not move**

Run: `npm run check`, then `npm run test:e2e -- tests/e2e/export.spec.ts tests/e2e/panel-editing.spec.ts`
Expected: PASS, with the ratio check unchanged.

Then take a screenshot of a speech, shout, whisper, thought, caption and sound-effect bubble at `origin/main` and on this branch, and compare them side by side. A difference in any default is a bug.

- [ ] **Step 7: Commit**

```bash
git add src package.json package-lock.json
git commit -m "feat: draw each bubble in its own shape, font and colours"
```

---

### Task 4: Drawing a pointed tail

**Files:**
- Create: `src/renderer/src/components/visualizer/BubbleTailArt.tsx`, `src/renderer/src/components/visualizer/BubbleTailArt.test.tsx`
- Modify: `src/renderer/src/components/visualizer/bubble-layout.ts:10,79-94`, `src/renderer/src/components/visualizer/DialogueOverlay.tsx`, `src/renderer/src/styles.css:2394`
- Test: `src/renderer/src/components/visualizer/bubble-layout.test.ts`, `tests/e2e/export.spec.ts`

**Interfaces:**
- Consumes: `tailWedge`, `thoughtPuffs`, `restingTip`, `hasTail` from Task 2. `bubbleStyleProps` from Task 3.
- Produces:
  - `TailDrawing = 'down' | 'edge' | 'none' | 'point'`, on `BubbleLayout.tail`.
  - `BubbleTailArt(props: { shape: TailedShape; side: BubbleSide; drawing: TailDrawing; tip: BubblePlacement | null; stroke: number; handle?: HTMLAttributes<HTMLDivElement> })`.
  - DOM for later tasks: `svg.bubble-tail` holding a `path` or `ellipse`s, and `.bubble-tail-handle` with `data-state="pointed" | "resting"`.

- [ ] **Step 1: Write the failing tests**

`bubble-layout.test.ts`:

- `a line's tail decides how it is drawn`: `tail: 'none'` gives `tail: 'none'`, `tail: { x: 0.2, y: 0.9 }` gives `'point'`, and `tail: null` keeps `'down'` or `'edge'` as before.
- `a caption or sound effect never draws a tail, whatever is stored`: `kind: 'narration'` with `tail: { x: 0.2, y: 0.9 }` gives `'none'`.

`BubbleTailArt.test.tsx`, rendering `DialogueOverlay` with rects mocked as in `PanelStage.test.tsx:39`: the overlay is 400×600 at the origin, the bubble 100×50 at (100, 100), so its centre is (150, 125). Mock `offsetWidth` on the overlay where a test needs scale.

```ts
it('draws the tail to the tip, in px from the bubble's centre', () => {
  // The tip is at (0.5, 0.5) of 400x600: (200, 300), so (50, 175) from the centre.
  const { container } = render(<DialogueOverlay dialogue={[line('dlg_0000000001', 'Hi', { tail: { x: 0.5, y: 0.5 } })]} />)
  const d = container.querySelector('.bubble-tail path')!.getAttribute('d')!
  expect(d).toContain('L50 175')
  expect(d).not.toMatch(/NaN/)
})

it('reads the same at any stage zoom', () => {
  // On screen everything is twice the size, and the overlay's offsetWidth stays 400: the tip is still (50, 175).
})

it('draws no art for an automatic tail, or for none', () => {
  // tail: null, and tail: 'none': `.bubble-tail` is absent; the second has class `bubble-tail-none`.
})

it('draws three puffs for a thought', () => {
  // kind: 'thought', tail: {...}: three ellipses, no path, class `bubble-tail-point`.
})

it('hides a stored tail on a caption and brings it back as speech', () => {
  // Render as narration: no `.bubble-tail`. Rerender the same line as speech: `.bubble-tail path` exists.
})

it('redraws when the bubble resizes', () => {
  // Stub ResizeObserver, change the mocked bubble rect, fire the callback: the `d` changes.
})
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run src/renderer/src/components/visualizer`
Expected: FAIL.

- [ ] **Step 3: Implement**

- `layoutBubbles`: after computing the side, `tail` is `'none'` for caption and sfx, as today, and otherwise follows `line.tail` as tested.
- `BubbleTailArt`: a `useBubbleBox(ref)` hook, following the pattern of `useStageFit`, reads `closest('.bubble')` and `closest('.dialogue-overlay')` in a layout effect that runs on every commit and through a `ResizeObserver` on both, and it keeps the previous object when nothing changed.
  - All boxes come from `getBoundingClientRect`, divided by `overlayRect.width / overlay.offsetWidth` (use 1 when `offsetWidth` is 0, as in jsdom).
  - `em` comes from `getComputedStyle(bubble).fontSize`, or 16 when that does not parse to a number, as in jsdom.
  - Local tip: `{ x: tip.x * panel.width - centre.x, y: tip.y * panel.height - centre.y }`.
- Render `<svg className="bubble-tail" aria-hidden="true">` as the bubble's child after `BubbleBody`, holding either `<path d="M a L tip L b">` or the puffs. The path `d` uses plain numbers, rounded to two decimals. Render `handle` as `<div className="bubble-tail-handle" role="button" tabIndex={0} {...handle}>`, at the tip, or at `restingTip` before one is set.
- `DialogueOverlay`: mount `BubbleTailArt` only when `hasTail(b.shape)` and `b.tail === 'point'`, with `stroke` from `line.style?.strokeWidth ?? 2`. Unstyled strip bubbles then read no layout at all. Task 5 also mounts it on the selected bubble.

CSS:

```css
/* 1 x 1: Chromium paints nothing for a 0 x 0 svg, even with overflow visible. Coordinates are px from the bubble's centre. */
.bubble-tail { position: absolute; left: 50%; top: 50%; width: 1px; height: 1px; overflow: visible; pointer-events: none; }
.bubble-tail path, .bubble-tail ellipse { fill: var(--bubble-fill, #fff); stroke: var(--bubble-stroke, #111); stroke-width: var(--bubble-stroke-width, 2px); stroke-linejoin: round; }
.bubble-whisper .bubble-tail path { stroke-dasharray: 4 3; }
```

Change the thought puffs' base rule at line 2394 to `.bubble-thought:not(.bubble-tail-none, .bubble-tail-point)::before, ...::after`, so an automatic thought keeps them and the others do not.

- [ ] **Step 4: Extend the export test**

In `tests/e2e/export.spec.ts`:

- Give `panel('Mina stops.', ...)` a line `{ speakerId: mina, kind: 'speech', text: 'Over here!', style: { font: 'impact', fill: '#fff4c2' }, tail: { x: 0.2, y: 0.9 } }`.
- Add to `MEASURE_STRIP`, and to `Geometry`:
  - `tail: document.querySelector('.bubble-tail path')?.getAttribute('d') ?? null`
  - `anton: [...document.fonts].some((f) => f.family.replace(/["']/g, '') === 'Anton' && f.status === 'loaded')`. Not `document.fonts.check`, which also says true when no such face is registered.
- Assert `inExport!.tail` is not null and equals `onScreen!.tail`: both lay out at 440 px, so a tail measured before the fonts settled shows up as a difference. Assert `inExport!.anton` is true.
- Confirm the font assertion can fail: remove `import './lettering-fonts'` from `export-main.tsx`, rebuild, watch the test fail, and put the import back.
- Let `recordExportGeometry` take the script to run, defaulting to `MEASURE_STRIP`, and give `exportActiveEpisode` an optional `withoutLettering` that ticks `dialog.getByLabel('Without lettering')`.
- Add a separate test, `Without lettering draws no bubble and no tail`, with one panel holding that styled line. Record `({ panels: document.querySelectorAll('.panel-media').length, bubbles: document.querySelectorAll('.bubble').length, tails: document.querySelectorAll('.bubble-tail').length })` and assert `panels` is 1 and the other two are 0. Counting the panel keeps the test from passing when nothing was drawn.

- [ ] **Step 5: Run the tests**

Run: `npm run check`, then `npm run test:e2e -- tests/e2e/export.spec.ts`
Expected: PASS, including the unchanged ratio check on the first bubble.

- [ ] **Step 6: Look at it**

Capture the strip, the stage and an exported slice with tips at short and long lengths and at four angles, on speech, whisper, shout and thought. Include a tip near the corner a slanted frame cuts deepest, which must be clipped with the lettering. Compare them with rows B and C of `docs/superpowers/specs/2026-11-06-bubble-styling-prototype.png`: the root is open, there is no seam, and all three surfaces agree.

- [ ] **Step 7: Commit**

```bash
git add src tests
git commit -m "feat: draw a tail that points where the line says"
```

---

### Task 5: The dot on the stage

**Files:**
- Modify: `src/renderer/src/components/panel-editor/use-bubble-editing.ts`, `src/renderer/src/components/visualizer/DialogueOverlay.tsx:11-21`, `src/renderer/src/components/panel-editor/PanelStage.tsx:117`, `src/renderer/src/styles.css`
- Test: `src/renderer/src/components/panel-editor/PanelStage.test.tsx`, `src/renderer/src/components/visualizer/DialogueOverlay.test.tsx:14`

**Interfaces:**
- Consumes: `BubbleTailArt`'s `handle` prop from Task 4, plus `placementFromPointer`, `nudgePlacement` and `NUDGE_COMMIT_MS` from `bubble-placement.ts`. With `bubble: { width: 0, height: 0 }` and `half: { x: 0, y: 0 }` they already clamp to 0 to 1, so no new math is needed.
- Produces: `OverlayEditing` gains `tailPreview: { index: number; tip: BubblePlacement } | null` and `bindTail(index: number): HTMLAttributes<HTMLDivElement>`.

- [ ] **Step 1: Write the failing tests**

In `PanelStage.test.tsx`, with the mocks at line 39 (panel 400×600), add `describe('the tail's dot', ...)`:

- `shows only on the selected bubble that can have a tail`: none until selected. One on a selected speech line. None on a selected caption.
- `dragging it saves the tip as fractions of the panel, and nothing else`: press on the dot, move to (100, 300), release. The last patch has `tail: { x: 0.25, y: 0.5 }`, with placement and text unchanged, and the bubble stays selected.
- `a press on it neither drags the bubble nor clears the selection`.
- `dragging past the panel's edge keeps the tip inside`: move to (900, -50), expect `{ x: 1, y: 0 }`.
- `shows the tip while it is dragged, before anything is saved`: no `panels:update` before release, and `.bubble-tail path` is already drawn.
- `moving the bubble leaves the tip where it is`: a stored tail, drag the bubble, expect the same `tail` in the patch.
- `arrow keys on it nudge the tip, saved once, with the focus kept on it`: focus the dot, press ArrowRight twice, advance `NUDGE_COMMIT_MS`. One save with `x + 0.02`, and after the remount `document.activeElement` is the dot.
- `double-clicking it gives the tail back to the app, without opening the text or adding a line`: patch has `tail: null`, `.bubble-editor` is absent, and the line count is unchanged.
- `goes while the text is open`.
- `dragging from a bubble with no tail creates one`: `tail: 'none'`, drag, expect a tip in the patch.
- `a tip inside the bubble draws no tail and keeps the dot`: a stored tip inside the mocked bubble's box. `.bubble-tail path` is absent, and the dot is there.

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run src/renderer/src/components/panel-editor/PanelStage.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement**

In `use-bubble-editing.ts`:

- `Press` gains `tail: boolean`. `Nudge` gains `tail: boolean`, sharing its timer and `flushNudge`.
- Add `const inTailHandle = (t: EventTarget) => t instanceof Element && t.closest('.bubble-tail-handle') !== null`.
- `pressBubble` and the bubble's `onDoubleClick` return early on `inTailHandle`. The handle sits inside `.bubble`, so the stage's `inBubble` guards already keep it from deselecting or adding a line.
- `bindTail(i)`:
  - `onPointerDown` records a tail press.
  - `onKeyDown` handles the arrows: `nudgePlacement(tip, key, shift, { x: 0, y: 0 })`, starting from the stored tip or, before one is set, from `centreOf(boxOf(dot), panelBox())`. It calls `preventDefault`. The bubble's own handler already ignores keys whose target is not the bubble.
  - `onDoubleClick` saves `tail: null`, with `stopPropagation`.
  - `onFocus` sets a `tailFocus` ref.
  - `aria-label` is `` `Point of line ${i + 1}` ``. `BubbleTailArt` sets the dot's `left`, `top` and `data-state` itself.
- `onPointerMove`: a tail press past `DRAG_THRESHOLD_PX` takes the pointer capture, as today, and sets `tailPreview` from `placementFromPointer({ pointer, grab: { dx: 0, dy: 0 }, panel, bubble: { width: 0, height: 0 } })`.
- `endPress` sets `dragEnded`, and commits through `send` with `editLine(current, i, expect, { tail })`.
- The focus effect at line 187 gives focus back to the dot when `tailFocus.current` is set.
- `PanelStage`: set `'--stage-scale': scale` on `.stage-row`.
- `DialogueOverlay`: `tipOf(line, i)` prefers `editing.tailPreview`, and the preview also makes `drawing` `'point'`. Mount `BubbleTailArt` on the selected bubble too, and pass `handle={editing.bindTail(i)}` only while it is selected and its text is not open.

CSS:

```css
.bubble-tail-handle { position: absolute; width: calc(14px / var(--stage-scale, 1)); height: calc(14px / var(--stage-scale, 1)); translate: -50% -50%; cursor: grab; background: var(--accent); border: calc(2px / var(--stage-scale, 1)) solid #fff; border-radius: 50%; }
.bubble-tail-handle::before { position: absolute; inset: calc(-5px / var(--stage-scale, 1)); content: ''; border-radius: 50%; }
.bubble-tail-handle[data-state='resting'] { background: #fff; border-color: var(--accent); }
.bubble-tail-handle:focus-visible { outline: calc(2px / var(--stage-scale, 1)) solid var(--accent); outline-offset: calc(2px / var(--stage-scale, 1)); }
```

- [ ] **Step 4: Run them to verify they pass**

Run: `npx vitest run src/renderer/src/components/panel-editor`
Expected: PASS, including every test that was there before.

- [ ] **Step 5: Commit**

```bash
git add src
git commit -m "feat: point a bubble's tail by dragging its dot"
```

---

### Task 6: The style block

**Files:**
- Create: `src/renderer/src/components/panel-editor/BubbleStyleBlock.tsx`, `src/renderer/src/components/panel-editor/BubbleStyleBlock.test.tsx`
- Modify: `src/renderer/src/components/panel-editor/LinesTab.tsx`, `src/renderer/src/components/panel-editor/PanelInspector.tsx`, `src/renderer/src/components/panel-editor/PanelWorkspace.tsx`, `src/renderer/src/components/panel-editor/PanelStage.tsx`, `src/renderer/src/styles.css`
- Test: `src/renderer/src/components/panel-editor/PanelInspector.test.tsx`, `src/renderer/src/components/panel-editor/PanelWorkspace.test.tsx`

**Interfaces:**
- Consumes: `bubbleDefaults`, `withStyleChange`, `FONTS` from Task 3. `bubbleShape`, `hasTail`. `Field` from `characters/controls.tsx`. `useAutosave` from `use-field-autosave.ts`.
- Produces:
  - `BubbleStyleBlock(props: { autoShape: BubbleShape; style: BubbleStyle | null; tail: DialogueLine['tail']; onStyle(next: BubbleStyle | null): void; onTail(next: 'none' | null): void })`
  - `StylePreview = { index: number; style: BubbleStyle | null }`
  - An optional `stylePreview?: StylePreview | null` prop on `PanelStage`, and `onPreviewStyle?(p: StylePreview | null): void` on `PanelInspector` and `LinesTab`.

- [ ] **Step 1: Write the failing tests**

`BubbleStyleBlock.test.tsx`:

- `shows the look the bubble has`: with `style: null, autoShape: 'speech'`: in the `Shape` group, `Auto` is pressed. Font is `Comic Neue`. Size reads `100%`. `Bold` and `Capitals` are pressed. Fill is `#ffffff`. Outline width reads `2 px`.
- `choosing a shape reports it, and Auto clears it`: `Shout` calls `onStyle({ shape: 'shout' })`. From there, `Auto` calls `onStyle(null)`.
- `toggling away from a default and back leaves nothing stored`: `Bold` from `null` gives `{ bold: false }`. From `{ bold: false }` it gives `null`.
- `reports each control`: Font, Size at `150` as `size: 1.5`, Italic, Capitals, `Left`, `Text colour`, `Fill`, `Outline`, `Outline width`.
- `shows Tail only for shapes that have one`: absent for `caption` and `sfx`.
- `hides Fill and Outline width for a sound effect`.
- `says where a pointed tail points`: `tail: { x: 0.25, y: 0.5 }` shows `Points at 25% across, 50% down.`, with neither `Auto` nor `None` pressed. `tail: null` shows `Drag the dot on the panel to point it.`, with `Auto` pressed.
- `Tail buttons report`: `None` calls `onTail('none')`, `Auto` calls `onTail(null)`.
- `offers Reset style only on a styled line`: it calls `onStyle(null)`.

`PanelInspector.test.tsx`:

- `shows the style block only under the selected row`.
- `saves a style after the wait, with the rest of the dialogue untouched`: advance 600 ms and check the patch.
- `saves a waiting style when the row is left`.
- `a style and typed text in the same row both land`.
- `a refused style save says so, and Undo my change drops it`.
- `Tail buttons save at once`.

`PanelWorkspace.test.tsx`:

- `the stage shows a style as soon as it is picked, before it is saved`: change Fill, and `.bubble` has `--bubble-fill` before any `panels:update`.
- `the preview ends once the save lands`.

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run src/renderer/src/components/panel-editor`
Expected: FAIL.

- [ ] **Step 3: Implement the block**

Layout and strings are in spec section 5. Shape buttons draw small inline glyphs with `aria-label` and `title`. Bold, Italic, Capitals and alignment use lucide `Bold`, `Italic`, `CaseUpper`, `AlignLeft`, `AlignCenter`, `AlignRight` at 16 px, with `aria-pressed` and the look of `.sketch-tools .icon-button[aria-pressed='true']`. Font is a `select` whose options set their own `fontFamily`. Size is `<input type="range" min={50} max={300} step={5}>`, and Outline width is `min={0} max={6} step={1}`, each with a tabular readout. Colours are `<input type="color">` at 32×32. Current values come from `{ ...bubbleDefaults(shape), ...style }`.

CSS in `.bubble-style`: `flex: 1 0 100%`, wrapped flex lines with `gap: 8px 16px`, labels at `--fs-small` in `--muted`. Override the visually hidden rule at `styles.css:1569` for this block: `.line-row .bubble-style .field > label { position: static; width: auto; height: auto; clip: auto; }`.

- [ ] **Step 4: Wire it through**

In `LineRow`:

- Add a second `useAutosave<BubbleStyle | null>(line.style, { normalize: (v) => v, send })`. `send` saves through `save((current) => editLine(current, index, expectNow(), { style: v }))`, mapping outcomes as the row's existing draft does.
- `leave()` also flushes it.
- `orphaned` also covers `style.refused`.
- A layout effect calls `onPreviewStyle?.({ index, style: style.value })` while `style.pending`, and `onPreviewStyle?.(null)` on cleanup.
- Render the block when `selected`. `autoShape` is `bubbleShape({ kind: draft.value.kind, text: draft.value.text })`.
- `onTail` flushes the row's drafts and saves at once, as `resetPlacement` does.

Tail is deliberately not in this draft, so a pending style can never overwrite a tail just dragged on the stage.

`PanelWorkspace` holds `{ panelId, preview }`, passes `stylePreview` to `PanelStage` and `onPreviewStyle` to `PanelInspector`, and ignores a preview from another panel. `PanelStage` applies it to the line at `index` when building `drawn`.

- [ ] **Step 5: Run them to verify they pass**

Run: `npx vitest run src/renderer/src/components/panel-editor` and `npm run check`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src
git commit -m "feat: style the selected bubble from its row in Lines"
```

---

### Task 7: Add bubble

**Files:**
- Create: `src/renderer/src/components/panel-editor/AddBubbleMenu.tsx`, `src/renderer/src/components/panel-editor/AddBubbleMenu.test.tsx`
- Modify: `src/renderer/src/components/panel-editor/use-bubble-editing.ts:210-217`, `src/renderer/src/components/panel-editor/PanelStage.tsx:124`, `src/renderer/src/styles.css`
- Test: `src/renderer/src/components/panel-editor/PanelStage.test.tsx`, `tests/e2e/panel-editing.spec.ts`

**Interfaces:**
- Consumes: `addAt` in `useBubbleEditing`. `ZoomBar`'s `children` slot, whose wrapper already stops a press reaching the stage.
- Produces: `AddBubbleMenu(props: { disabled: boolean; onAdd(shape: BubbleShape): void })`. `useBubbleEditing` returns `add(shape: BubbleShape): void` and `adding: boolean`.

- [ ] **Step 1: Write the failing tests**

`AddBubbleMenu.test.tsx`:

- `lists the six shapes when opened`: `Add bubble` has `aria-expanded`, and the menu items are `Speech`, `Shout`, `Whisper`, `Thought`, `Caption`, `Sound effect`.
- `choosing one reports it and closes`.
- `Escape closes it without leaving the editor`: the event is `defaultPrevented`.
- `a press outside closes it`.

`PanelStage.test.tsx`:

- `Add bubble opens the new bubble's text`: choose `Shout`, and `.bubble-editor` has focus. Type and press Enter. The saved line has `kind: 'speech'`, `style: { shape: 'shout' }`, the first cast member as speaker, and a placement.
- `a caption has no speaker and no stored style`: `narration`, `speakerId: null`, `style: null`.
- `a bubble left empty is dropped`: no save.
- `two new bubbles do not land on the same spot`: the placements differ.
- `the menu is disabled while a new bubble is being typed`.

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run src/renderer/src/components/panel-editor`
Expected: FAIL.

- [ ] **Step 3: Implement**

- `AddBubbleMenu`: a button with `aria-haspopup="menu"`, and `.context-menu` overridden to open upward (`.stage-add .context-menu { position: absolute; bottom: calc(100% + 4px); left: 0; }`). `.stage-add` needs `pointer-events: auto`, because `.stage-zoom` turns it off.
- `add(shape)`: `addAt({ x: 0.5, y: Math.min(0.2 + 0.12 * base.length, 0.8) }, shape)`, using the table in spec section 5.
- `addAt` gains the optional `shape`. With none it behaves exactly as today, so a double-click is unchanged. `commitText`'s draft passes `line.style` on, in place of Task 1's `null`.

- [ ] **Step 4: Write the full flow end to end**

In `tests/e2e/panel-editing.spec.ts`, extend the first test so the chat's fix lands on a styled line (Review Focus 1). Before the panel chat step, set Fill on the bubble and drag its dot, and after the fix assert the stored line keeps `style.fill` and `tail` with the chat's text.

Add `add, style and point a bubble, and find it on the strip`: `Add bubble`, `Shout`, type, Enter. Choose Font `Anton` and a Fill. Drag the dot. Back to the strip: the card's `.bubble-shout` has that `--bubble-fill`, `.bubble-tail path` exists, and the JSON from `readProjectJson` has `style` and `tail`.

- [ ] **Step 5: Run them**

Run: `npm run check`, then `npm run test:e2e -- tests/e2e/panel-editing.spec.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src tests
git commit -m "feat: add a bubble of any shape from the stage"
```

---

### Task 8: The agent

**Files:**
- Modify: `src/main/agent/tools/panel-tools.ts:154,182`, `src/main/agent/tools/panel-chat-tools.ts:48-55,203`, `resources/agent-docs/workflows/panel-editing.md:135-151`
- Test: `src/main/agent/tools/panel-chat-tools.test.ts`, `src/main/agent/tools/panel-tools.test.ts`

**Interfaces:**
- Consumes: the schemas and inheritance from Task 1.

- [ ] **Step 1: Write the failing tests**

`panel-chat-tools.test.ts`:

- `the panel context shows a line's style and tail`: `get_panel_context` on a styled line returns both.
- `update_panel_fields keeps a look it was not sent`: reword a styled line through the tool, leaving both out. Stored `style` and `tail` are unchanged.

`panel-tools.test.ts`:

- `update_panel can set a style and a tail`.
- `a style the app cannot draw comes back as an error`: `color: 'red'` is refused.
- `the tool schema stays free of const`: `JSON.stringify(z.toJSONSchema(PanelPatchSchema))` does not contain `"const"`, and the `tail` property accepts `"none"` through an `enum`.

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run src/main/agent/tools`
Expected: FAIL on the context test. The inheritance test may already pass: keep it.

- [ ] **Step 3: Implement**

- Add `style: line.style, tail: line.tail` at `panel-chat-tools.ts:54`. Neighbour summaries at line 74 stay text only.
- Add this to all three dialogue descriptions: `style holds only what differs from the app's look (shape, font, size, bold, italic, caps, align, color, fill, stroke, strokeWidth); tail is where the bubble points, as fractions of the panel, or "none", or null for automatic; leave either out to keep it.`
- In `panel-editing.md`, after the placement rules in "Dialogue-Only Changes":

```markdown
A bubble's look is data too, and needs no redraw.

- `style` holds only what differs from the app's default: `shape` (`speech`, `shout`, `whisper`, `thought`, `caption`, `sfx`), `font` (`comic`, `bangers`, `hand`, `impact`, `serif`, `typewriter`), `size` (0.5 to 3), `bold`, `italic`, `caps`, `align` (`left`, `center`, `right`), `color`, `fill`, `stroke` (`#rrggbb`), `strokeWidth` (0 to 6).
- `tail` is where the bubble points, as fractions of the panel like a placement: `{"x": 0.3, "y": 0.7}`. `"none"` removes it and `null` hands it back to the app. Captions and sound effects have none.
- **Keep the user's looks.** A line you send without `style` or `tail` keeps those of the line at the same position, so changing words never changes a look. If you reorder, add or remove lines, send them on each line you keep.
- **Set them only when the user asks**, for example "make Mina's line red" or "point the bubble at Jun".
```

- [ ] **Step 4: Run them to verify they pass**

Run: `npx vitest run src/main/agent` (this includes `workflow-docs.lint.test.ts`)
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src resources
git commit -m "feat: let the agent read, keep and set a bubble's look"
```

---

### Task 9: Finish

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Say it in the README**

Next to the panel editor's description, say that bubbles can be added from the stage, styled from their row in Lines, and pointed by dragging the dot.

- [ ] **Step 2: Run everything**

Run: `npm run check`, then `npm run test:e2e`
Expected: PASS. Do not set any `WEBTOON_LIVE_*` variable.

- [ ] **Step 3: Run the app and use it**

Use the `/run` skill: open a panel, then add, style, point, move and delete bubbles. Zoom to 200% and repeat a drag. Check a dark-gutter panel and a slanted one. Export with and without lettering. Fix what looks wrong.

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: say how to style a bubble"
```
