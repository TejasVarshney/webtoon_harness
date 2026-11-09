import fs from 'node:fs'
import { newId } from '@shared/ids'
import { PanelSchema } from '@shared/schemas'
import type { Panel, PanelVersion } from '@shared/types'
import { visualFields } from '@shared/visual-fields'
import { writeFileAtomic, writeJsonAtomic } from '../storage/atomic'
import { isNotFound } from '../storage/fs-errors'
import type { ProjectContext } from '../storage/project-store'
import { getPanel } from './panel-files'
import { panelImageRelPath } from './panel-recording'
import { composePanelPrompt, type PanelPromptInput, type PanelPromptResult } from './prompts'
import { now, UPLOAD_EXTS, type UploadExt } from './records'
import { packRelPath, storePacks, type PackComposer } from './reference-pack'

// Images the user supplies: uploads and layout sketches. The bytes are in hand, so there is no pending phase.

/** Stores the user's own image as a new current version. The caller emits the change. */
export async function storeUploadedImage(ctx: ProjectContext, id: string, data: Buffer, ext: UploadExt): Promise<PanelVersion> {
  if (!UPLOAD_EXTS.includes(ext)) throw new Error(`Unsupported image extension: ${String(ext)} (use png, jpg or webp)`)
  const file = ctx.paths.panelFile(id)
  return ctx.mutex.run(file, async () => {
    const current = await getPanel(ctx, id)
    const versionId = newId('ver')
    const rel = panelImageRelPath(id, versionId, ext)
    const abs = ctx.paths.resolveAsset(rel)
    await writeFileAtomic(abs, data)
    const uploaded: PanelVersion = {
      id: versionId,
      source: 'upload',
      status: 'ready',
      error: null,
      imagePath: rel,
      prompt: '',
      referenceImagePaths: [],
      instruction: null,
      parentVersionId: null,
      drawnFrom: visualFields(current),
      check: null,
      createdAt: now()
    }
    try {
      await writeJsonAtomic(file, { ...current, versions: [...current.versions, uploaded], currentVersionId: versionId, updatedAt: now() })
    } catch (error) {
      await fs.promises.rm(abs, { force: true }).catch(() => undefined)
      throw error
    }
    return uploaded
  })
}

/**
 * Stores the user's layout sketch (a PNG) under a new name, so versions drawn from an older sketch keep pointing at
 * it, or forgets it with `null`. The caller emits the change.
 */
export async function storeSketch(ctx: ProjectContext, id: string, png: Buffer | null): Promise<Panel> {
  const file = ctx.paths.panelFile(id)
  return ctx.mutex.run(file, async () => {
    const current = await getPanel(ctx, id)
    let sketchPath: string | null = null
    if (png !== null) {
      // Time first, so names sort by age; the random tail keeps two saves in one millisecond apart.
      sketchPath = `panels/${id}/sketch-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}.png`
      await writeFileAtomic(ctx.paths.resolveAsset(sketchPath), png)
    }
    const valid = PanelSchema.parse({ ...current, sketchPath, updatedAt: now() })
    try {
      await writeJsonAtomic(file, valid)
    } catch (error) {
      if (sketchPath !== null) await fs.promises.rm(ctx.paths.resolveAsset(sketchPath), { force: true }).catch(() => undefined)
      throw error
    }
    // The sketch it replaces goes, unless a version was drawn from it (its referenceImagePaths name it).
    const old = current.sketchPath
    if (old && old !== sketchPath && !current.versions.some((v) => v.referenceImagePaths.includes(old))) {
      await fs.promises.rm(ctx.paths.resolveAsset(old), { force: true }).catch(() => undefined)
    }
    return valid
  })
}

/** The bytes of a stored sketch, or `null` when its file is gone. */
export async function readSketchFile(ctx: ProjectContext, sketchPath: string): Promise<Buffer | null> {
  try {
    return await fs.promises.readFile(ctx.paths.resolveAsset(sketchPath))
  } catch (error) {
    if (isNotFound(error)) return null
    throw error
  }
}

/**
 * The generation prompt, with cast sheets packed over the cap when a composer is set and each pack drawn into the
 * panel folder (no lock held: see `storePacks`). A pack that cannot be drawn costs only the packing: the prompt is
 * composed again without it, dropping references as it would with no composer.
 */
export async function composeWithPacks(ctx: ProjectContext, composer: PackComposer | undefined, panelId: string, input: PanelPromptInput): Promise<PanelPromptResult> {
  if (!composer) return composePanelPrompt(input)
  const packed = composePanelPrompt({ ...input, packing: { path: (members) => packRelPath(panelId, members) } })
  try {
    await storePacks(ctx, composer, packed.references)
    return packed
  } catch (error) {
    console.warn(`Panel ${panelId}: the packed reference image could not be drawn, so references over the cap are dropped`, error)
    return composePanelPrompt(input)
  }
}
