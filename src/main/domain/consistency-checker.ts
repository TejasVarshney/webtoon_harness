import { newId } from '@shared/ids'
import type { Character, ChatMessage, CheckResult, Panel } from '@shared/types'
import type { WorkflowDocs } from '../agent/workflow-docs'
import { createTextProvider as defaultCreateTextProvider } from '../models/providers/factory'
import type { TextProvider } from '../models/providers/types'
import type { ModelRegistry, ResolvedModel } from '../models/registry'
import type { ProjectContext } from '../storage/project-store'
import { loadImageForTextModel, type ImageOps } from './image-ops'

/** The project doc that is the checker's system prompt. Editing the project's copy changes how the checker judges. */
export const CHECKLIST_DOC = 'reference/consistency-checklist'

/** How long the vision call may take before the check is given up (Ruling T25c); the image call has the same limit. */
export const CHECK_TIMEOUT_MS = 180_000

export interface ConsistencyCheckInput {
  /** The generated image to judge (project-relative). */
  imageRelPath: string
  /** The reference images the panel was drawn from, in prompt order (cast variations, then the previous panel). */
  references: { relPath: string; label: string }[]
  panel: Panel
  /** Every character, archived ones included. */
  roster: Character[]
  /** The run's signal: aborting it ends the vision call. */
  signal?: AbortSignal
}

export interface ConsistencyCheckerOptions {
  registry: ModelRegistry
  docs: WorkflowDocs
  imageOps: ImageOps
  /** Test seam; production uses the provider factory. */
  createTextProvider?: (r: ResolvedModel) => TextProvider
  /** Test seam; production uses 180 s. */
  timeoutMs?: number
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
 * reference was not sent), the panel description and the shot. `reference/prompt-templates` documents it.
 */
export function buildCheckMessage(input: Pick<ConsistencyCheckInput, 'references' | 'panel' | 'roster'>): string {
  const { references, panel, roster } = input
  const images = [...references.map((r, i) => `${i + 1}. Reference: ${r.label}`), `${references.length + 1}. Generated panel (the image to check)`]

  // References are the ready cast variations in cast order, then the previous panel: a cast member
  // has one exactly when the next unused reference carries their name.
  let next = 0
  const cast = panel.characters.map((entry) => {
    const character = roster.find((c) => c.id === entry.characterId)
    const variation = character?.variations.find((v) => v.id === entry.variationId)
    if (!character || !variation) throw new Error(`Unknown cast entry: ${entry.characterId}/${entry.variationId}`)
    const hasReference = references[next]?.label === character.name
    if (hasReference) next++
    const look = variation.delta ? `${variation.name} — ${variation.delta}` : variation.name
    return `- ${character.name} — ${character.appearanceLock} — Look: ${look}${hasReference ? '' : ' (no reference image)'}`
  })

  return [
    'Images, in the order attached:',
    ...images,
    '',
    'Cast:',
    ...(cast.length > 0 ? cast : ['(none)']),
    '',
    `Panel description: ${panel.description}`,
    `Shot: ${panel.shot}`
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
 * Asks the `vision` model whether a generated panel matches its references (spec §9, step 5). The
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
   * Ruling T25c: the call is cut off after the timeout (a skipped pass, so the panel is not held up);
   * a caller abort is told apart from it and reads "Cancelled".
   */
  async check(ctx: ProjectContext, input: ConsistencyCheckInput): Promise<CheckResult | null> {
    const resolved = this.opts.registry.resolveOptional('vision')
    if (!resolved) return null
    const timeout = AbortSignal.timeout(this.timeoutMs)
    const signal = input.signal ? AbortSignal.any([input.signal, timeout]) : timeout
    try {
      const system = await this.opts.docs.read(ctx, CHECKLIST_DOC)
      const provider = this.create(resolved)
      const message: ChatMessage = {
        id: newId('msg'),
        role: 'user',
        text: buildCheckMessage(input),
        imagePaths: [...input.references.map((r) => r.relPath), input.imageRelPath],
        stateSnapshot: null,
        createdAt: new Date().toISOString()
      }
      const turn = await abortable(
        provider.runTurn({
          system,
          messages: [message],
          tools: [],
          loadImage: (relPath) => loadImageForTextModel(ctx, this.opts.imageOps, relPath),
          signal
        }),
        signal
      )
      return parseCheckResponse(turn.text)
    } catch (error) {
      if (timeout.aborted && !input.signal?.aborted) return { passed: true, issues: [`Consistency check timed out after ${this.timeoutMs / 1000}s`], skipped: true }
      return skipped(failureMessage(error, input.signal))
    }
  }
}
