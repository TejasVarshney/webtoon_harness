import fs from 'node:fs'
import path from 'node:path'
import { z } from 'zod'
import { CropAreaSchema, PanelAspectSchema, PanelDraftSchema, PanelPatchSchema } from '@shared/schemas'
import { StripBackgroundSchema } from '@shared/strip-background'
import { PanelValidationError } from '../../domain/panel-service'
import type { Services } from '../../services'
import { parseInput } from '../validate'
import type { HandlerMap } from './projects'
import { STORED_EXT, type PickFiles } from './uploads'

export interface PanelsDeps {
  /** Shows the native file dialog. Absent (tests, headless) behaves like a cancelled dialog. */
  pickFiles?: PickFiles
}

/** Starts a task the caller does not wait for. Its outcome is recorded on the panel and announced as `panel.changed`. */
function inBackground(task: Promise<unknown>, what: string): void {
  task.catch((error: unknown) => console.error(`${what} failed`, error))
}

/**
 * The renderer shows an error's message as it is. A validation failure travels as a plain `Error`
 * holding one issue per line.
 */
async function showIssues<T>(task: Promise<T>): Promise<T> {
  try {
    return await task
  } catch (error) {
    if (error instanceof PanelValidationError) throw new Error(error.issues.join('\n'))
    throw error
  }
}

const Title = z.string().trim().min(1)
const CreateEpisodeSchema = z.object({ projectId: z.string(), title: Title, synopsis: z.string().optional() })
const UpdateEpisodeSchema = z.object({ projectId: z.string(), episodeId: z.string(), patch: z.object({ synopsis: z.string().optional() }).strict() })
const SetBackgroundSchema = z.object({ projectId: z.string(), episodeId: z.string(), background: StripBackgroundSchema.nullable() })
const PlaceSchema = z.object({
  projectId: z.string(),
  episodeId: z.string(),
  moves: z.array(z.object({ panelId: z.string(), placement: z.object({ x: z.number().finite(), y: z.number().finite(), width: z.number().finite() }) }))
})
const CropSchema = z.object({ projectId: z.string(), panelId: z.string(), versionId: z.string(), area: CropAreaSchema, aspect: PanelAspectSchema.optional() })
const PreviewPromptSchema = z.object({ projectId: z.string(), draft: PanelDraftSchema, hasSketch: z.boolean() })
const PNG_DATA_URL = 'data:image/png;base64,'
/** A sketch is drawn at a panel's size; anything this large did not come from the sketch pad. */
const MAX_SKETCH_BYTES = 8 * 1024 * 1024
const SketchUrl = z.string().startsWith(PNG_DATA_URL)
const SaveSketchSchema = z.object({ projectId: z.string(), panelId: z.string(), png: SketchUrl.nullable() })
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

/** The PNG a sketch data URL holds. Throws for anything that is not a PNG of a sane size. */
function sketchBytes(url: string): Buffer {
  const data = Buffer.from(url.slice(PNG_DATA_URL.length), 'base64')
  if (data.length > MAX_SKETCH_BYTES) throw new Error('Sketch is too large')
  if (data.length < PNG_SIGNATURE.length || !data.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) throw new Error('Sketch is not a PNG image')
  return data
}

/** Episodes and the panels in them. */
export function panelsHandlers(s: Services, deps: PanelsDeps = {}): HandlerMap {
  const { episodes, panels } = s
  const pickFiles: PickFiles = deps.pickFiles ?? (async () => [])

  return {
    'episodes:list': async ({ projectId }) => episodes.list(await s.projects.open(projectId)),
    'episodes:create': async (req) => {
      const { projectId, title, synopsis } = parseInput(CreateEpisodeSchema, req)
      return episodes.create(await s.projects.open(projectId), { title, synopsis })
    },
    'episodes:update': async (req) => {
      const { projectId, episodeId, patch } = parseInput(UpdateEpisodeSchema, req)
      return episodes.update(await s.projects.open(projectId), episodeId, patch)
    },
    'episodes:setBackground': async (req) => {
      const { projectId, episodeId, background } = parseInput(SetBackgroundSchema, req)
      return episodes.setBackground(await s.projects.open(projectId), episodeId, background)
    },
    'episodes:pickBackgroundImage': async ({ projectId, episodeId }, event) => {
      const ctx = await s.projects.open(projectId)
      await episodes.get(ctx, episodeId)
      const [file] = await pickFiles(event, { multiple: false, title: 'Choose a background image' })
      if (file === undefined) return null
      const ext = STORED_EXT[path.extname(file).toLowerCase()]
      if (!ext) throw new Error('Unsupported image type: use png, jpg or webp')
      return episodes.storeBackgroundImage(ctx, episodeId, await fs.promises.readFile(file), ext)
    },

    'panels:list': async ({ projectId, episodeId }) => panels.list(await s.projects.open(projectId), episodeId),
    'panels:get': async ({ projectId, panelId }) => panels.get(await s.projects.open(projectId), panelId),

    'panels:create': async ({ projectId, draft, generate, sketchPng }) => {
      // Checked before anything is made, so a bad sketch leaves no panel.
      const sketch = sketchPng === undefined ? undefined : sketchBytes(parseInput(SketchUrl, sketchPng))
      const ctx = await s.projects.open(projectId)
      // The manual editor is lenient: a mention of a character who is not attached is a warning, not an error.
      const created = await showIssues(panels.create(ctx, PanelDraftSchema.parse(draft), { createdBy: 'user', strictMentions: false, strictSheets: false, sketch }))
      if (generate) inBackground(panels.generate(ctx, created.panel.id), 'Panel image generation')
      return created
    },

    'panels:previewPrompt': async (req) => {
      const { projectId, draft, hasSketch } = parseInput(PreviewPromptSchema, req)
      return panels.previewPrompt(await s.projects.open(projectId), draft, hasSketch)
    },

    'panels:update': async ({ projectId, panelId, patch }) =>
      showIssues(panels.update(await s.projects.open(projectId), panelId, PanelPatchSchema.parse(patch), { strictMentions: false, strictSheets: false })),

    'panels:generate': async ({ projectId, panelId }) => {
      const ctx = await s.projects.open(projectId)
      // An unknown panel must be refused here: in the background it would only be logged.
      await panels.get(ctx, panelId)
      inBackground(panels.generate(ctx, panelId), 'Panel image generation')
    },

    'panels:delete': async ({ projectId, panelId }) => panels.delete(await s.projects.open(projectId), panelId),
    'panels:place': async (req) => {
      const { projectId, episodeId, moves } = parseInput(PlaceSchema, req)
      return panels.place(await s.projects.open(projectId), episodeId, moves)
    },
    'panels:revert': async ({ projectId, panelId, versionId }) => panels.revert(await s.projects.open(projectId), panelId, versionId),

    'panels:uploadImage': async ({ projectId, panelId }, event) => {
      const ctx = await s.projects.open(projectId)
      await panels.get(ctx, panelId)
      const [file] = await pickFiles(event, { multiple: false, title: 'Choose a panel image' })
      if (file === undefined) return null
      const ext = STORED_EXT[path.extname(file).toLowerCase()]
      if (!ext) throw new Error('Unsupported image type: use png, jpg or webp')
      return panels.uploadImage(ctx, panelId, await fs.promises.readFile(file), ext)
    },

    'panels:crop': async (req) => {
      const { projectId, panelId, versionId, area, aspect } = parseInput(CropSchema, req)
      return panels.cropImage(await s.projects.open(projectId), panelId, versionId, area, s.imageOps, aspect)
    },

    'panels:saveSketch': async (req) => {
      const { projectId, panelId, png } = parseInput(SaveSketchSchema, req)
      return panels.saveSketch(await s.projects.open(projectId), panelId, png === null ? null : sketchBytes(png))
    },

    'panels:readSketch': async ({ projectId, panelId }) => {
      const png = await panels.readSketch(await s.projects.open(projectId), panelId)
      return png === null ? null : `${PNG_DATA_URL}${png.toString('base64')}`
    }
  }
}
