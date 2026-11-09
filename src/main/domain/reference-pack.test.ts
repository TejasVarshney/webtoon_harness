import fs from 'node:fs'
import { afterEach, describe, expect, it } from 'vitest'
import { encodeSolidPng } from '../models/providers/png'
import { writeFileAtomic } from '../storage/atomic'
import { createFakePackComposer } from '../test/fake-pack-composer'
import { tempProject, type TempProject } from '../test/temp-project'
import { MAX_REFERENCE_IMAGE_EDGE } from './image-ops'
import type { PanelPromptReference } from './prompts'
import { chooseCastToPack, PACK_LAYOUT, packRelPath, planPack, storePacks, type PackMember } from './reference-pack'

const ready = (n: number): boolean[] => Array.from({ length: n }, () => true)

describe('chooseCastToPack', () => {
  it('packs nothing at or under the cap', () => {
    expect(chooseCastToPack(ready(3), 1, 4)).toEqual([])
    expect(chooseCastToPack(ready(4), 0, 4)).toEqual([])
    expect(chooseCastToPack(ready(2), 0, 4)).toEqual([])
  })

  it('packs the fewest trailing sheets that bring the references down to the cap', () => {
    // 3 cast + item + previous: one over, so the last two share an image.
    expect(chooseCastToPack(ready(3), 2, 4)).toEqual([1, 2])
    // 4 cast + previous.
    expect(chooseCastToPack(ready(4), 1, 4)).toEqual([2, 3])
    // 4 cast + item + previous: two over.
    expect(chooseCastToPack(ready(4), 2, 4)).toEqual([1, 2, 3])
    // 4 cast + item + sketch + previous: the whole cast.
    expect(chooseCastToPack(ready(4), 3, 4)).toEqual([0, 1, 2, 3])
  })

  it('packs at most four, and leaves the rest to the usual drop order', () => {
    // 6 cast + item + previous: four over; packing four frees three, so the previous panel is still dropped.
    expect(chooseCastToPack(ready(6), 2, 4)).toEqual([2, 3, 4, 5])
    expect(chooseCastToPack(ready(6), 2, 4, 3)).toEqual([3, 4, 5])
  })

  it('packs the first sheets when even a full pack leaves more cast than slots, so the pack is not what gets dropped', () => {
    expect(chooseCastToPack(ready(2), 0, 1)).toEqual([0, 1])
    expect(chooseCastToPack(ready(5), 0, 1)).toEqual([0, 1, 2, 3])
    expect(chooseCastToPack(ready(6), 1, 2)).toEqual([0, 1, 2, 3])
  })

  it('packs only cast members whose sheet is ready', () => {
    expect(chooseCastToPack([true, true, false, true], 1, 3)).toEqual([1, 3])
    expect(chooseCastToPack([true, false, true], 1, 4)).toEqual([])
  })

  it('does not pack one sheet alone, or with a cap of 0', () => {
    expect(chooseCastToPack([true, false], 4, 4)).toEqual([])
    expect(chooseCastToPack(ready(3), 2, 0)).toEqual([])
    expect(chooseCastToPack([], 6, 4)).toEqual([])
  })
})

describe('planPack', () => {
  it('sets two sheets side by side, scaled to the reference edge limit', () => {
    const plan = planPack(['Jin', 'Mina'])
    const scale = MAX_REFERENCE_IMAGE_EDGE / (2 * 1024 + 40)
    expect(plan.width).toBe(MAX_REFERENCE_IMAGE_EDGE)
    expect(plan.height).toBe(Math.round((200 + 1536) * scale))
    expect(plan.fontPx).toBe(Math.round(120 * scale))
    expect(plan.cells.map((c) => [c.name, c.position])).toEqual([
      ['Jin', 'left'],
      ['Mina', 'right']
    ])
    expect(plan.cells[0].band).toEqual({ x: 0, y: 0, width: Math.round(1024 * scale), height: Math.round(200 * scale) })
    expect(plan.cells[0].sheet).toEqual({ x: 0, y: Math.round(200 * scale), width: Math.round(1024 * scale), height: Math.round(1536 * scale) })
    expect(plan.cells[1].band.x).toBe(Math.round((1024 + 40) * scale))
    expect(plan.cells[1].sheet.y).toBe(plan.cells[0].sheet.y)
  })

  it('fills the 2 × 2 grid left to right, then top to bottom, in the order given', () => {
    const plan = planPack(['A', 'B', 'C', 'D'])
    const scale = MAX_REFERENCE_IMAGE_EDGE / (2 * (200 + 1536) + 40)
    expect(plan.height).toBe(MAX_REFERENCE_IMAGE_EDGE)
    expect(plan.width).toBe(Math.round((2 * 1024 + 40) * scale))
    expect(plan.cells.map((c) => [c.name, c.position])).toEqual([
      ['A', 'top left'],
      ['B', 'top right'],
      ['C', 'bottom left'],
      ['D', 'bottom right']
    ])
    const left = plan.cells[0].band.x
    const right = plan.cells[1].band.x
    const top = plan.cells[0].band.y
    const bottom = plan.cells[2].band.y
    expect(plan.cells.map((c) => [c.band.x, c.band.y])).toEqual([
      [left, top],
      [right, top],
      [left, bottom],
      [right, bottom]
    ])
    expect(bottom).toBe(Math.round((200 + 1536 + 40) * scale))
  })

  it('leaves the last corner of the grid blank for three sheets', () => {
    const plan = planPack(['A', 'B', 'C'])
    expect(plan.cells.map((c) => c.position)).toEqual(['top left', 'top right', 'bottom left'])
    expect(plan.height).toBe(MAX_REFERENCE_IMAGE_EDGE)
    expect(plan.width).toBe(planPack(['A', 'B', 'C', 'D']).width)
  })

  it('draws at full size when the grid is under the edge limit', () => {
    const plan = planPack(['A', 'B'], PACK_LAYOUT, 10_000)
    expect([plan.width, plan.height, plan.fontPx]).toEqual([2 * 1024 + 40, 200 + 1536, 120])
  })

  it('takes another layout', () => {
    const plan = planPack(['A', 'B', 'C'], { ...PACK_LAYOUT, columns: 3, maxCells: 3 }, 10_000)
    expect(plan.cells.map((c) => c.position)).toEqual(['left', 'middle', 'right'])
    expect(plan.width).toBe(3 * 1024 + 2 * 40)
  })

  it('refuses a pack of one sheet or more than the layout holds', () => {
    expect(() => planPack(['A'])).toThrow('A packed image holds 2 to 4 sheets, not 1')
    expect(() => planPack(['A', 'B', 'C', 'D', 'E'])).toThrow('A packed image holds 2 to 4 sheets, not 5')
  })
})

const member = (name: string, relPath: string): PackMember => ({ subject: { kind: 'character', id: `chr_${name.toLowerCase()}` }, name, relPath })

describe('packRelPath', () => {
  const jin = member('Jin', 'characters/chr_jin/var_a_000001.png')
  const mina = member('Mina', 'characters/chr_mina/var_b_000002.png')

  it('is a png in the panel folder, named by its sheets and their names', () => {
    const rel = packRelPath('pnl_1', [jin, mina])
    expect(rel).toMatch(/^panels\/pnl_1\/pack-[0-9a-f]{16}\.png$/)
    expect(packRelPath('pnl_1', [jin, mina])).toBe(rel)
    expect(packRelPath('pnl_2', [jin, mina])).not.toBe(rel)
    expect(packRelPath('pnl_1', [mina, jin])).not.toBe(rel)
    expect(packRelPath('pnl_1', [{ ...jin, name: 'Jinny' }, mina])).not.toBe(rel)
    expect(packRelPath('pnl_1', [{ ...jin, relPath: 'characters/chr_jin/var_a_000009.png' }, mina])).not.toBe(rel)
  })
})

describe('storePacks', () => {
  let tp: TempProject | undefined
  afterEach(async () => {
    await tp?.cleanup()
    tp = undefined
  })

  const pack = (members: PackMember[], relPath = packRelPath('pnl_1', members)): PanelPromptReference => ({ relPath, label: 'character sheets', subject: { kind: 'pack', members } })

  it('draws a missing pack from its sheets, in order, and stores it', async () => {
    tp = await tempProject()
    const { ctx } = tp
    const jinPng = encodeSolidPng(4, 6, [1, 1, 1])
    const minaPng = encodeSolidPng(4, 6, [2, 2, 2])
    await writeFileAtomic(ctx.paths.resolveAsset('characters/chr_jin/a.png'), jinPng)
    await writeFileAtomic(ctx.paths.resolveAsset('characters/chr_mina/b.png'), minaPng)
    const composer = createFakePackComposer()
    const ref = pack([member('Mina', 'characters/chr_mina/b.png'), member('Jin', 'characters/chr_jin/a.png')])
    const single: PanelPromptReference = { relPath: 'characters/chr_jin/a.png', label: 'Jin', subject: { kind: 'character', id: 'chr_jin' } }

    await storePacks(ctx, composer, [single, ref])

    expect(composer.calls).toHaveLength(1)
    expect(composer.calls[0].plan.cells.map((c) => c.name)).toEqual(['Mina', 'Jin'])
    expect(composer.calls[0].sheets).toEqual([
      { mime: 'image/png', data: minaPng },
      { mime: 'image/png', data: jinPng }
    ])
    const stored = fs.readFileSync(ctx.paths.resolveAsset(ref.relPath))
    expect(stored.equals(composer.outputs[0])).toBe(true)
  })

  it('leaves a pack that is already stored alone', async () => {
    tp = await tempProject()
    const { ctx } = tp
    const ref = pack([member('Jin', 'characters/gone-a.png'), member('Mina', 'characters/gone-b.png')])
    await writeFileAtomic(ctx.paths.resolveAsset(ref.relPath), encodeSolidPng(2, 2, [9, 9, 9]))
    const composer = createFakePackComposer()
    await storePacks(ctx, composer, [ref])
    expect(composer.calls).toEqual([])
  })

  it('throws, storing nothing, when a sheet is missing or not an image', async () => {
    tp = await tempProject()
    const { ctx } = tp
    await writeFileAtomic(ctx.paths.resolveAsset('characters/a.png'), encodeSolidPng(2, 2, [1, 1, 1]))
    await writeFileAtomic(ctx.paths.resolveAsset('characters/b.txt'), 'not an image')
    const composer = createFakePackComposer()
    const missing = pack([member('Jin', 'characters/a.png'), member('Mina', 'characters/none.png')])
    await expect(storePacks(ctx, composer, [missing])).rejects.toThrow()
    const text = pack([member('Jin', 'characters/a.png'), member('Mina', 'characters/b.txt')])
    await expect(storePacks(ctx, composer, [text])).rejects.toThrow('Reference image characters/b.txt is not a readable image (png, jpg, webp or gif)')
    expect(fs.existsSync(ctx.paths.resolveAsset(missing.relPath))).toBe(false)
    expect(fs.existsSync(ctx.paths.resolveAsset(text.relPath))).toBe(false)
    expect(composer.calls).toEqual([])
  })
})
