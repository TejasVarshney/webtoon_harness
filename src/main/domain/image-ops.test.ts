import fs from 'node:fs'
import { afterEach, describe, expect, it } from 'vitest'
import { encodeSolidPng } from '../models/providers/png'
import { tempProject, type TempProject } from '../test/temp-project'
import { createIdentityImageOps, loadImageForTextModel, MAX_TEXT_MODEL_IMAGE_EDGE } from './image-ops'

let tp: TempProject | undefined
afterEach(async () => {
  await tp?.cleanup()
  tp = undefined
})

describe('loadImageForTextModel', () => {
  it('downscales oversized attachments for text models', async () => {
    tp = await tempProject()
    const png = encodeSolidPng(4, 2, [1, 2, 3])
    await fs.promises.writeFile(tp.ctx.paths.resolveAsset('uploads/a b.png'), png)
    const ops = createIdentityImageOps()
    const out = await loadImageForTextModel(tp.ctx, ops, 'uploads/a b.png')
    expect(MAX_TEXT_MODEL_IMAGE_EDGE).toBe(1568)
    expect(ops.calls).toEqual([{ maxEdge: 1568, bytes: png.length }])
    expect(out).toEqual({ mime: 'image/png', base64: png.toString('base64') })
  })

  it('rejects paths outside the project', async () => {
    tp = await tempProject()
    await expect(loadImageForTextModel(tp.ctx, createIdentityImageOps(), '../x.png')).rejects.toThrow()
  })

  it('identity size reads PNG dimensions', () => {
    expect(createIdentityImageOps().size(encodeSolidPng(5, 7, [0, 0, 0]))).toEqual({ width: 5, height: 7 })
    expect(createIdentityImageOps().size(Buffer.from('nope'))).toEqual({ width: 0, height: 0 })
  })
})
