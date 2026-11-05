import fs from 'node:fs'
import { newId } from '@shared/ids'
import type { CheckResult, Panel, PanelVersion, VisualFields } from '@shared/types'
import { writeFileAtomic, writeJsonAtomic } from '../storage/atomic'
import { isNotFound } from '../storage/fs-errors'
import type { ProjectContext } from '../storage/project-store'
import type { ImageGenResult } from './image-service'
import { readPanelFile } from './panel-files'
import { failureMessage, now } from './records'

// Recording an image attempt on a panel. No lock is ever held across the image call: the version is appended under
// the panel lock, the model is called outside it, and the outcome is re-read and recorded under it.

const PANEL_DELETED = 'Panel was deleted'

/** What a version records about how it was made, before the image call runs. */
export interface Attempt {
  source: 'generate' | 'edit'
  prompt: string
  referenceImagePaths: string[]
  instruction: string | null
  parentVersionId: string | null
  /** The panel's visual fields as the attempt read them. */
  drawnFrom: VisualFields
}

/** Either the image call to make, or the reason it cannot be made (recorded as a `failed` version). */
export type Preparation = { call: () => Promise<ImageGenResult> } | { error: string }

export type EmitPanelChanged = (ctx: ProjectContext, panelId: string) => void

export function panelImageRelPath(panelId: string, versionId: string, ext: string): string {
  return `panels/${panelId}/${versionId}.${ext}`
}

/**
 * Runs one attempt: append the version (already `failed` when preparation failed), call the model
 * outside the lock, then record the outcome. Never throws.
 */
export async function recordAttempt(emit: EmitPanelChanged, ctx: ProjectContext, panelId: string, attempt: Attempt, preparation: Preparation): Promise<PanelVersion> {
  const preFailed = 'error' in preparation
  const version: PanelVersion = {
    id: newId('ver'),
    source: attempt.source,
    status: preFailed ? 'failed' : 'pending',
    error: preFailed ? preparation.error : null,
    imagePath: null,
    prompt: attempt.prompt,
    referenceImagePaths: attempt.referenceImagePaths,
    instruction: attempt.instruction,
    parentVersionId: attempt.parentVersionId,
    drawnFrom: attempt.drawnFrom,
    check: null,
    createdAt: now()
  }
  const problem = await append(ctx, panelId, version)
  if (problem !== null) return { ...version, status: 'failed', error: problem }
  emit(ctx, panelId)
  if (preFailed) return version

  let result: ImageGenResult | null = null
  let failure: string | null = null
  try {
    result = await preparation.call()
  } catch (error) {
    failure = failureMessage(error)
  }
  return finish(emit, ctx, panelId, version, result, failure)
}

/** Appends the version under the panel lock. Returns null when saved, else why it could not be (nothing was written). */
async function append(ctx: ProjectContext, panelId: string, version: PanelVersion): Promise<string | null> {
  const file = ctx.paths.panelFile(panelId)
  try {
    await ctx.mutex.run(file, async () => {
      const current = await readPanelFile(file, panelId)
      await writeJsonAtomic(file, { ...current, versions: [...current.versions, version], updatedAt: now() })
    })
    return null
  } catch (error) {
    return isNotFound(error) ? PANEL_DELETED : failureMessage(error)
  }
}

/**
 * Stores the check on the version under the panel lock (re-reading the file, so edits made during the
 * vision call survive). Never throws. Resolves to the panel as stored then, or null when the panel or the
 * version is gone, the file is unreadable (it is left alone) or the write failed.
 */
export async function recordCheck(emit: EmitPanelChanged, ctx: ProjectContext, panelId: string, versionId: string, check: CheckResult): Promise<Panel | null> {
  const file = ctx.paths.panelFile(panelId)
  let stored: Panel | null
  try {
    stored = await ctx.mutex.run(file, async () => {
      const current = await readPanelFile(file, panelId)
      if (!current.versions.some((v) => v.id === versionId)) return null
      const next: Panel = { ...current, versions: current.versions.map((v) => (v.id === versionId ? { ...v, check } : v)), updatedAt: now() }
      await writeJsonAtomic(file, next)
      return next
    })
  } catch {
    return null
  }
  if (stored) emit(ctx, panelId)
  return stored
}

/**
 * Under the lock, record the outcome if the version still exists. Never throws: if recording
 * fails the version is marked `failed` (best effort; `recoverInterrupted` is the backstop for a file
 * that cannot be written) and a `failed` version is returned. Success also makes it current.
 */
async function finish(emit: EmitPanelChanged, ctx: ProjectContext, panelId: string, started: PanelVersion, result: ImageGenResult | null, failure: string | null): Promise<PanelVersion> {
  const file = ctx.paths.panelFile(panelId)
  const failed = (v: PanelVersion, error: string): PanelVersion => ({ ...v, status: 'failed', error })
  const outcome = await ctx.mutex.run(file, async (): Promise<{ version: PanelVersion; persisted: boolean } | null> => {
    let current: Panel
    try {
      current = await readPanelFile(file, panelId)
    } catch (error) {
      if (isNotFound(error)) return null
      // Corrupt or unreadable: rewriting it from our stale snapshot could destroy the user's edits.
      return { version: failed(started, failureMessage(error)), persisted: false }
    }
    const existing = current.versions.find((v) => v.id === started.id)
    if (!existing) return { version: failed(started, 'Version was removed'), persisted: false }
    const save = (v: PanelVersion, makeCurrent: boolean): Promise<void> =>
      writeJsonAtomic(file, {
        ...current,
        versions: current.versions.map((x) => (x.id === v.id ? v : x)),
        currentVersionId: makeCurrent ? v.id : current.currentVersionId,
        updatedAt: now()
      })
    let imageAbs: string | null = null
    try {
      if (result && failure === null) {
        const rel = panelImageRelPath(panelId, started.id, result.ext)
        imageAbs = ctx.paths.resolveAsset(rel)
        await writeFileAtomic(imageAbs, result.data)
        const ready: PanelVersion = { ...existing, status: 'ready', error: null, imagePath: rel }
        await save(ready, true)
        return { version: ready, persisted: true }
      }
      const next = failed(existing, failure ?? 'Image generation failed')
      await save(next, false)
      return { version: next, persisted: true }
    } catch (error) {
      // The image file is not referenced by anything yet, so it would be an orphan.
      if (imageAbs) await fs.promises.rm(imageAbs, { force: true }).catch(() => undefined)
      const next = failed(existing, failureMessage(error))
      try {
        await save(next, false)
        return { version: next, persisted: true }
      } catch {
        return { version: next, persisted: false }
      }
    }
  })
  if (!outcome) return failed(started, PANEL_DELETED)
  if (outcome.persisted) emit(ctx, panelId)
  return outcome.version
}
