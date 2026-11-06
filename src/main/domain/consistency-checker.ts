import { newId } from '@shared/ids'
import type { Character, ChatMessage, CheckResult, Item, ItemUsage, Panel, Variation } from '@shared/types'
import type { WorkflowDocs } from '../agent/workflow-docs'
import { createTextProvider as defaultCreateTextProvider } from '../models/providers/factory'
import { ImageUnavailableError, type TextProvider } from '../models/providers/types'
import type { ModelRegistry, ResolvedModel } from '../models/registry'
import type { ProjectContext } from '../storage/project-store'
import { loadImageForTextModel, MAX_TEXT_MODEL_IMAGE_EDGE, UnreadableImageError, type ImageOps } from './image-ops'
import type { PanelPromptReference } from './prompts'

/** The project doc that is the checker's system prompt. Editing the project's copy changes how the checker judges. */
const CHECKLIST_DOC = 'reference/consistency-checklist'

/** The project doc that is the system prompt of a sheet check (`checkSheet`). */
const SHEET_CHECKLIST_DOC = 'reference/sheet-checklist'

/** The reserved image key under which the not-yet-saved candidate sheet is served to the vision model. */
export const CANDIDATE_IMAGE_KEY = 'candidate://sheet'

/**
 * How long the vision call may take before the check is given up, unless the vision model's endpoint
 * sets `timeoutSeconds`; the image call has the same default.
 */
export const CHECK_TIMEOUT_MS = 180_000

export interface ConsistencyCheckInput {
  /** The generated image to judge (project-relative). */
  imageRelPath: string
  /** The reference images the panel was drawn from, in prompt order (cast variations, then items, then the previous panel). */
  references: PanelPromptReference[]
  panel: Panel
  /** Every character, archived ones included. */
  roster: Character[]
  /** Every item, archived ones included. */
  itemRoster: Item[]
  /** The run's signal: aborting it ends the vision call. */
  signal?: AbortSignal
}

export interface ConsistencyCheckerOptions {
  registry: ModelRegistry
  docs: WorkflowDocs
  imageOps: ImageOps
  /** Test seam; production uses the provider factory. */
  createTextProvider?: (r: ResolvedModel) => TextProvider
  /** The limit when the endpoint sets no `timeoutSeconds`. Test seam; production uses 180 s. */
  timeoutMs?: number
}

/** What a sheet check judges: a character variation or an item usage, with its owner (which holds the lock). */
type SheetSubject = { kind: 'character'; character: Character; variation: Variation } | { kind: 'item'; item: Item; usage: ItemUsage }

export interface SheetCheckInput {
  /** The candidate sheet, not yet on disk. */
  image: Buffer
  subject: SheetSubject
  /** The base sheet of the character or item, for a non-base sheet; null for a base sheet. */
  baseImageRelPath: string | null
  /** The caller's signal: aborting it ends the vision call. */
  signal?: AbortSignal
}

const UNPARSEABLE: CheckResult = { passed: true, issues: ['Checker response could not be parsed'], skipped: true }

/**
 * The end index (exclusive) of the JSON object that starts at `start`, found by matching braces while
 * skipping string contents (an issue text may hold a "}"), or -1 when the object never closes.
 */
function objectEnd(text: string, start: number): number {
  let depth = 0
  let inString = false
  for (let i = start; i < text.length; i++) {
    const c = text[i]
    if (inString) {
      if (c === '\\') i++
      else if (c === '"') inString = false
    } else if (c === '"') inString = true
    else if (c === '{') depth++
    else if (c === '}' && --depth === 0) return i + 1
  }
  return -1
}

/** The first `{…}` in `text` that is valid JSON and an object, or null. Code fences and prose around it do not matter. */
function firstJsonObject(text: string): Record<string, unknown> | null {
  for (let start = text.indexOf('{'); start !== -1; start = text.indexOf('{', start + 1)) {
    const end = objectEnd(text, start)
    if (end === -1) continue
    try {
      const value: unknown = JSON.parse(text.slice(start, end))
      if (typeof value === 'object' && value !== null && !Array.isArray(value)) return value as Record<string, unknown>
    } catch {
      // not JSON (prose in braces): try the next `{`
    }
  }
  return null
}

/**
 * Reads the checker's answer: the first JSON object in the text, fenced or not, with a boolean `passed`
 * and a string-array `issues`. Anything else counts as a skipped pass, so a rambling model never
 * blocks a panel or triggers a pointless redraw.
 */
export function parseCheckResponse(text: string): CheckResult {
  const object = firstJsonObject(text)
  if (!object) return { ...UNPARSEABLE }
  const { passed, issues } = object
  if (typeof passed !== 'boolean' || !Array.isArray(issues) || !issues.every((i): i is string => typeof i === 'string')) return { ...UNPARSEABLE }
  return { passed, issues, skipped: false }
}

/**
 * The text half of the checker's user message: the images in the order they are attached, the cast
 * (`Name — appearanceLock — Look: variation`, plus "(no reference image)" for a cast member whose
 * reference was not sent), the items when the panel has any (`Name — appearanceLock — Use: usage —
 * Held by: holder`, with the same marker), the panel description and the shot.
 * `reference/prompt-templates` documents it. A reference belongs to a cast member or item by its
 * `subject`, never by label (a character and an item may share a name).
 */
export function buildCheckMessage(input: Pick<ConsistencyCheckInput, 'references' | 'panel' | 'roster' | 'itemRoster'>): string {
  const { references, panel, roster, itemRoster } = input
  const images = [...references.map((r, i) => `${i + 1}. Reference: ${r.label}`), `${references.length + 1}. Generated panel (the image to check)`]

  const sent = (kind: 'character' | 'item', id: string): boolean => references.some((r) => r.subject.kind === kind && r.subject.id === id)

  const cast = panel.characters.map((entry) => {
    const character = roster.find((c) => c.id === entry.characterId)
    const variation = character?.variations.find((v) => v.id === entry.variationId)
    if (!character || !variation) throw new Error(`Unknown cast entry: ${entry.characterId}/${entry.variationId}`)
    const hasReference = sent('character', character.id)
    const look = variation.delta ? `${variation.name} — ${variation.delta}` : variation.name
    return `- ${character.name} — ${character.appearanceLock} — Look: ${look}${hasReference ? '' : ' (no reference image)'}`
  })

  const items = panel.items.map((entry) => {
    const item = itemRoster.find((i) => i.id === entry.itemId)
    const usage = item?.usages.find((u) => u.id === entry.usageId)
    if (!item || !usage) throw new Error(`Unknown item entry: ${entry.itemId}/${entry.usageId}`)
    const look = usage.delta ? `${usage.name} — ${usage.delta}` : usage.name
    const holder = entry.heldBy === null ? 'nobody' : (roster.find((c) => c.id === entry.heldBy)?.name ?? entry.heldBy)
    return `- ${item.name} — ${item.appearanceLock} — Use: ${look} — Held by: ${holder}${sent('item', item.id) ? '' : ' (no reference image)'}`
  })

  return [
    'Images, in the order attached:',
    ...images,
    '',
    'Cast:',
    ...(cast.length > 0 ? cast : ['(none)']),
    ...(items.length > 0 ? ['', 'Items:', ...items] : []),
    '',
    `Panel description: ${panel.description}`,
    `Shot: ${panel.shot}`
  ].join('\n')
}

/**
 * The text half of a sheet check's user message: the images in the order attached (the base sheet first
 * when there is one, then the candidate), then what the sheet is, its subject, the lock and, for a
 * non-base sheet, its look, state or usage. `reference/sheet-checklist` documents it.
 */
export function buildSheetCheckMessage(input: Pick<SheetCheckInput, 'subject' | 'baseImageRelPath'>): string {
  const { subject, baseImageRelPath } = input
  const named = (name: string, delta: string): string => (delta ? `${name} — ${delta}` : name)
  let sheet: string
  let name: string
  let lock: string
  let detail: string | null = null
  if (subject.kind === 'character') {
    const { character, variation } = subject
    sheet = 'Character reference sheet'
    name = character.name
    lock = character.appearanceLock
    if (variation.kind !== 'base') detail = `Look: ${named(variation.name, variation.delta)}`
  } else {
    const { item, usage } = subject
    sheet = usage.kind === 'action' ? 'Item usage reference sheet' : 'Item reference sheet'
    name = item.name
    lock = item.appearanceLock
    if (usage.kind === 'state') detail = `State: ${named(usage.name, usage.delta)}`
    else if (usage.kind === 'action') detail = `Usage: ${named(usage.name, usage.delta)}`
  }
  const images = [...(baseImageRelPath === null ? [] : [`Base reference: ${subject.kind} ${name}`]), 'Generated sheet (the image to check)']
  return [
    'Images, in the order attached:',
    ...images.map((label, i) => `${i + 1}. ${label}`),
    '',
    `Sheet: ${sheet}`,
    `Subject: ${name}`,
    `Lock: ${lock}`,
    ...(detail === null ? [] : [detail])
  ].join('\n')
}

/**
 * Settles with `promise`, or rejects with the signal's reason as soon as it aborts. A provider that
 * ignores its signal therefore cannot keep a timed-out or cancelled check hanging.
 */
function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) {
    promise.catch(() => undefined)
    return Promise.reject(signal.reason)
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => reject(signal.reason)
    signal.addEventListener('abort', onAbort, { once: true })
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort))
  })
}

function skipped(message: string): CheckResult {
  return { passed: true, issues: [`Consistency check failed to run: ${message}`], skipped: true }
}

function failureMessage(error: unknown, signal: AbortSignal | undefined): string {
  if (signal?.aborted || (error instanceof Error && (error.name === 'AbortError' || error.name === 'APIUserAbortError'))) return 'Cancelled'
  return error instanceof Error && error.message ? error.message : String(error)
}

/**
 * Asks the `vision` model whether a generated panel matches its references. The
 * checklist doc is the system prompt; the references and the generated image go as downscaled images
 * on one user message. `check` never throws: a model, image or doc problem is a skipped pass.
 */
export class ConsistencyChecker {
  private readonly create: (r: ResolvedModel) => TextProvider
  private readonly timeoutMs: number

  constructor(private readonly opts: ConsistencyCheckerOptions) {
    this.create = opts.createTextProvider ?? defaultCreateTextProvider
    this.timeoutMs = opts.timeoutMs ?? CHECK_TIMEOUT_MS
  }

  /**
   * The verdict, or null when no model is assigned to the `vision` role (the check is optional).
   * The call is cut off after the timeout (a skipped pass, so the panel is not held up);
   * a caller abort is told apart from it and reads "Cancelled".
   */
  async check(ctx: ProjectContext, input: ConsistencyCheckInput): Promise<CheckResult | null> {
    return this.runVision(ctx, {
      doc: CHECKLIST_DOC,
      text: () => buildCheckMessage(input),
      imagePaths: [...input.references.map((r) => r.relPath), input.imageRelPath],
      loadImage: (relPath) => loadImageForTextModel(ctx, this.opts.imageOps, relPath),
      signal: input.signal
    })
  }

  /**
   * The verdict on a sheet that is not on disk yet, judged against its lock (and its base sheet, for a
   * non-base one), or null when no model is assigned to the `vision` role. Same contract as `check`:
   * never throws, a timeout is a skipped pass, a caller abort reads "Cancelled". An empty or undecodable
   * candidate is a skipped pass.
   */
  async checkSheet(ctx: ProjectContext, input: SheetCheckInput): Promise<CheckResult | null> {
    // The candidate is prepared before the turn: the adapters turn an ImageUnavailableError from `loadImage` into a
    // text note and carry on, so a failure there would leave the model judging a sheet it never saw.
    let candidate: { mime: string; base64: string } | undefined
    return this.runVision(ctx, {
      doc: SHEET_CHECKLIST_DOC,
      text: () => buildSheetCheckMessage(input),
      imagePaths: [...(input.baseImageRelPath === null ? [] : [input.baseImageRelPath]), CANDIDATE_IMAGE_KEY],
      prepare: async () => {
        candidate = await this.loadCandidate(input.image)
      },
      loadImage: async (relPath) => {
        if (relPath !== CANDIDATE_IMAGE_KEY) return loadImageForTextModel(ctx, this.opts.imageOps, relPath)
        if (!candidate) throw new ImageUnavailableError(CANDIDATE_IMAGE_KEY, 'the image was not prepared')
        return candidate
      },
      signal: input.signal
    })
  }

  /** The candidate buffer shrunk for the vision model, with the empty and undecodable guards of `loadImageForTextModel`. */
  private async loadCandidate(image: Buffer): Promise<{ mime: string; base64: string }> {
    if (image.length === 0) throw new ImageUnavailableError(CANDIDATE_IMAGE_KEY, 'the image is empty')
    let out: { mime: string; data: Buffer }
    try {
      out = await this.opts.imageOps.downscale(image, MAX_TEXT_MODEL_IMAGE_EDGE, { format: 'jpeg' })
    } catch (error) {
      if (error instanceof UnreadableImageError) throw new ImageUnavailableError(CANDIDATE_IMAGE_KEY, error.message)
      throw error
    }
    if (out.data.length === 0) throw new ImageUnavailableError(CANDIDATE_IMAGE_KEY, 'the image could not be decoded')
    return { mime: out.mime, base64: out.data.toString('base64') }
  }

  /** The shared body of `check` and `checkSheet`: one tool-less vision turn with `doc` as system prompt. Never throws. */
  private async runVision(
    ctx: ProjectContext,
    run: { doc: string; text: () => string; imagePaths: string[]; prepare?: () => Promise<void>; loadImage: (relPath: string) => Promise<{ mime: string; base64: string }>; signal?: AbortSignal }
  ): Promise<CheckResult | null> {
    const resolved = this.opts.registry.resolveOptional('vision')
    if (!resolved) return null
    const timeoutMs = (resolved.endpoint.options.timeoutSeconds ?? 0) * 1000 || this.timeoutMs
    const timeout = AbortSignal.timeout(timeoutMs)
    const signal = run.signal ? AbortSignal.any([run.signal, timeout]) : timeout
    try {
      const system = await this.opts.docs.read(ctx, run.doc)
      await run.prepare?.()
      const provider = this.create(resolved)
      const message: ChatMessage = {
        id: newId('msg'),
        role: 'user',
        text: run.text(),
        imagePaths: run.imagePaths,
        stateSnapshot: null,
        createdAt: new Date().toISOString()
      }
      const turn = await abortable(provider.runTurn({ system, messages: [message], tools: [], loadImage: run.loadImage, signal }), signal)
      return parseCheckResponse(turn.text)
    } catch (error) {
      if (timeout.aborted && !run.signal?.aborted) return { passed: true, issues: [`Consistency check timed out after ${timeoutMs / 1000}s`], skipped: true }
      return skipped(failureMessage(error, run.signal))
    }
  }
}
