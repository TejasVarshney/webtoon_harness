import { createHash } from 'node:crypto'
import fs from 'node:fs'
import { writeFileAtomic } from '../storage/atomic'
import type { ProjectContext } from '../storage/project-store'
import { MAX_REFERENCE_IMAGE_EDGE, sniffImageMime } from './image-ops'
import type { PanelPromptReference } from './prompts'

// Reference packing. When a panel's references would go over the image model's cap, the sheets of some cast members
// are drawn on one image, each under its name, and sent as one reference instead of being dropped.
// Only character sheets are packed. A member may name an item, so item usages can be packed later, but item sheets
// are square, and no model has been tried on packed item sheets yet.

/** One sheet on a packed image, in grid order. `name` is drawn above it. */
export interface PackMember {
  subject: { kind: 'character' | 'item'; id: string }
  name: string
  relPath: string
}

/**
 * How a packed image is laid out, in px of a full-size 1024 × 1536 sheet. Sheets fill rows of `columns`: two sit side
 * by side, three or four make a 2 × 2 grid (three leave its last corner blank). A white band above each sheet holds
 * its name in large bold type. This is the layout a 4-character test kept identities with. Changing a value here
 * gives packed images new file names (see `packRelPath`), so a changed layout never reuses an old file.
 */
export const PACK_LAYOUT = {
  maxCells: 4,
  columns: 2,
  cellWidth: 1024,
  cellHeight: 1536,
  band: 200,
  gap: 40,
  fontPx: 120,
  /** CSS font families, in order. The canvas falls back to a system font for scripts they lack, such as Hangul. */
  fontFamily: 'Arial, Helvetica, sans-serif',
  background: '#ffffff',
  ink: '#000000'
}

export type PackLayout = typeof PACK_LAYOUT

/**
 * Which cast entries to pack, as indexes in cast order; none when every reference fits under `cap`. `ready` says which
 * entries have a sheet to send, and `others` counts the other references that would go (ready items, the sketch, the
 * previous panel). Packing k sheets frees k - 1 slots, so the fewest that bring the total down to the cap are packed,
 * at least 2 and at most `maxCells`: the last ready ones, so the lead characters keep a full-size image. When a full
 * pack still leaves more cast than slots, the first ready ones are packed instead, so that what is dropped from the
 * end of the cast is not the pack. Whatever still does not fit is dropped as without packing.
 */
export function chooseCastToPack(ready: boolean[], others: number, cap: number, maxCells = PACK_LAYOUT.maxCells): number[] {
  const readyAt = ready.flatMap((isReady, i) => (isReady ? [i] : []))
  const over = readyAt.length + others - cap
  if (cap < 1 || over <= 0) return []
  const count = Math.min(over + 1, maxCells, readyAt.length)
  if (count < 2) return []
  const castSlots = readyAt.length - count + 1
  return castSlots > cap ? readyAt.slice(0, count) : readyAt.slice(-count)
}

interface PackRect {
  x: number
  y: number
  width: number
  height: number
}

/** A packed image's size and what goes where, in px of the drawn image. */
export interface PackPlan {
  width: number
  height: number
  layout: PackLayout
  /** Size of the names' type. */
  fontPx: number
  /** In grid order. `position` says where the cell is ("left", "top right"), for the consistency checker. */
  cells: { name: string; position: string; band: PackRect; sheet: PackRect }[]
}

/**
 * Lays out a pack of `names` (in the order given: left to right, then top to bottom), scaled down so its long edge is
 * at most `maxEdge`, which is as much as the image model is sent anyway.
 */
export function planPack(names: string[], layout: PackLayout = PACK_LAYOUT, maxEdge: number = MAX_REFERENCE_IMAGE_EDGE): PackPlan {
  if (names.length < 2 || names.length > layout.maxCells) throw new Error(`A packed image holds 2 to ${layout.maxCells} sheets, not ${names.length}`)
  const columns = Math.min(names.length, layout.columns)
  const rows = Math.ceil(names.length / layout.columns)
  const cellHeight = layout.band + layout.cellHeight
  const fullWidth = columns * layout.cellWidth + (columns - 1) * layout.gap
  const fullHeight = rows * cellHeight + (rows - 1) * layout.gap
  const scale = Math.min(1, maxEdge / Math.max(fullWidth, fullHeight))
  const px = (v: number): number => Math.round(v * scale)
  return {
    width: px(fullWidth),
    height: px(fullHeight),
    layout,
    fontPx: px(layout.fontPx),
    cells: names.map((name, i) => {
      const column = i % layout.columns
      const row = Math.floor(i / layout.columns)
      const x = column * (layout.cellWidth + layout.gap)
      const y = row * (cellHeight + layout.gap)
      return {
        name,
        position: cellPosition(column, row, columns, rows),
        band: { x: px(x), y: px(y), width: px(layout.cellWidth), height: px(layout.band) },
        sheet: { x: px(x), y: px(y + layout.band), width: px(layout.cellWidth), height: px(layout.cellHeight) }
      }
    })
  }
}

/** The words for each place along an axis of `count` cells, or null past three. */
function axisWords(count: number, words: [string, string, string]): string[] | null {
  if (count === 1) return ['']
  if (count === 2) return [words[0], words[2]]
  return count === 3 ? words : null
}

function cellPosition(column: number, row: number, columns: number, rows: number): string {
  const vertical = axisWords(rows, ['top', 'middle', 'bottom'])
  const horizontal = axisWords(columns, ['left', 'middle', 'right'])
  if (!vertical || !horizontal) return `row ${row + 1}, column ${column + 1}`
  return [vertical[row], horizontal[column]].filter(Boolean).join(' ')
}

/**
 * Where a panel's packed image is stored, named by the layout, the size it is drawn at, and its members' names and sheets: a redraw reuses the
 * file, and a renamed character or a new sheet gets a new one. Sheets are never rewritten in place (a new image gets a
 * new file name), so a sheet's path stands for its pixels. The panel folder goes to the trash with the panel.
 */
export function packRelPath(panelId: string, members: PackMember[]): string {
  const key = JSON.stringify({ layout: PACK_LAYOUT, maxEdge: MAX_REFERENCE_IMAGE_EDGE, members: members.map((m) => [m.name, m.relPath]) })
  return `panels/${panelId}/pack-${createHash('sha256').update(key).digest('hex').slice(0, 16)}.png`
}

/** Draws a packed image as PNG bytes: `sheets` in the plan's cell order. Electron's offscreen canvas in the app. */
export interface PackComposer {
  compose(plan: PackPlan, sheets: { mime: string; data: Buffer }[]): Promise<Buffer>
}

/**
 * Draws and stores every packed image in `references` that is not on disk yet. No lock is held: a pack's file name
 * stands for its content, so two draws writing it at once write the same bytes. A sheet that is missing or is not an
 * image throws, and nothing is stored for that pack.
 */
export async function storePacks(ctx: ProjectContext, composer: PackComposer, references: PanelPromptReference[]): Promise<void> {
  for (const ref of references) {
    if (ref.subject.kind !== 'pack') continue
    const abs = ctx.paths.resolveAsset(ref.relPath)
    if (fs.existsSync(abs)) continue
    const sheets = await Promise.all(
      ref.subject.members.map(async (m) => {
        const data = await fs.promises.readFile(ctx.paths.resolveAsset(m.relPath))
        const mime = sniffImageMime(data)
        if (!mime) throw new Error(`Reference image ${m.relPath} is not a readable image (png, jpg, webp or gif)`)
        return { mime, data }
      })
    )
    await writeFileAtomic(abs, await composer.compose(planPack(ref.subject.members.map((m) => m.name)), sheets))
  }
}
