import fs from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Character, ChatMessage } from '@shared/types'
import { WorkflowDocs } from '../agent/workflow-docs'
import { encodeSolidPng } from '../models/providers/png'
import type { TextProvider, TextTurnRequest, TextTurnResult } from '../models/providers/types'
import type { ModelRegistry, ResolvedModel } from '../models/registry'
import { writeFileAtomic } from '../storage/atomic'
import type { ProjectContext } from '../storage/project-store'
import { makeCharacter, makePanel, makeVariation } from '../test/factories'
import { tempProject, type TempProject } from '../test/temp-project'
import { CHECK_TIMEOUT_MS, ConsistencyChecker, parseCheckResponse, type ConsistencyCheckInput } from './consistency-checker'
import { createIdentityImageOps, MAX_TEXT_MODEL_IMAGE_EDGE } from './image-ops'

const UNPARSEABLE = { passed: true, issues: ['Checker response could not be parsed'], skipped: true }

describe('parseCheckResponse', () => {
  it('parses fenced and bare JSON, tolerates junk', () => {
    expect(parseCheckResponse('```json\n{"passed": false, "issues": ["Mina hair is black"]}\n```')).toEqual({ passed: false, issues: ['Mina hair is black'], skipped: false })
    expect(parseCheckResponse('{"passed": true, "issues": []}')).toEqual({ passed: true, issues: [], skipped: false })
    expect(parseCheckResponse('looks fine')).toMatchObject({ passed: true, skipped: true })
    expect(parseCheckResponse('looks fine')).toEqual(UNPARSEABLE)
  })

  it('finds the object inside prose and ignores keys it does not know', () => {
    const text = 'Here is my verdict:\n{"passed": false, "issues": ["Jin is missing"], "confidence": 0.9}\nHope that helps.'
    expect(parseCheckResponse(text)).toEqual({ passed: false, issues: ['Jin is missing'], skipped: false })
  })

  it('is not fooled by braces inside issue strings', () => {
    const text = '{"passed": false, "issues": ["The sign says {EXIT}", "Mina wears a \\"red\\" } hoodie"]}'
    expect(parseCheckResponse(text)).toEqual({ passed: false, issues: ['The sign says {EXIT}', 'Mina wears a "red" } hoodie'], skipped: false })
  })

  it('takes the first JSON object and skips braces that are not JSON before it', () => {
    expect(parseCheckResponse('Notes {not json} then {"passed": true, "issues": []} then {"passed": false, "issues": ["x"]}')).toEqual({ passed: true, issues: [], skipped: false })
    expect(parseCheckResponse('{"passed": false, "issues": ["a"]} {"passed": true, "issues": []}')).toEqual({ passed: false, issues: ['a'], skipped: false })
  })

  it('finds the object even when the model wraps it in an array', () => {
    expect(parseCheckResponse('[{"passed": false, "issues": ["x"]}]')).toEqual({ passed: false, issues: ['x'], skipped: false })
  })

  it('keeps the issues of a passing answer as given', () => {
    expect(parseCheckResponse('{"passed": true, "issues": ["Minor: hand"]}')).toEqual({ passed: true, issues: ['Minor: hand'], skipped: false })
  })

  it.each([
    ['an empty reply', ''],
    ['a bare array', '[true, false]'],
    ['an empty object', '{}'],
    ['a missing passed', '{"issues": []}'],
    ['a string passed', '{"passed": "yes", "issues": []}'],
    ['a missing issues list', '{"passed": true}'],
    ['issues that is not a list', '{"passed": false, "issues": "hair"}'],
    ['issues holding a non-string', '{"passed": false, "issues": ["ok", 3]}'],
    ['an unclosed object', '{"passed": true, "issues": []'],
    ['invalid JSON in braces', '{passed: true}']
  ])('reads %s as skipped', (_name, text) => {
    expect(parseCheckResponse(text)).toEqual(UNPARSEABLE)
  })

  it('judges only the first JSON object: a later valid one does not rescue a malformed first', () => {
    expect(parseCheckResponse('{"passed": "maybe", "issues": []} {"passed": true, "issues": []}')).toEqual(UNPARSEABLE)
  })
})

// ---------------------------------------------------------------------------------------------

let tp: TempProject | undefined
afterEach(async () => {
  await tp?.cleanup()
  tp = undefined
})

const PNG = encodeSolidPng(2, 3, [1, 2, 3])
const CHECKLIST_TEMPLATE = fs.readFileSync(path.resolve('resources', 'agent-docs', 'reference', 'consistency-checklist.md'), 'utf8')
const RESOLVED = { endpoint: { id: 'end_0000000000', kind: 'mock' }, model: { id: 'mdl_000000000a', modelId: 'mock-text' }, apiKey: null } as unknown as ResolvedModel

interface Turn {
  req: TextTurnRequest
  /** What `loadImage` returned for each image path of the user message, in order (the adapters load them one by one). */
  loaded: { mime: string; base64: string }[]
}

/** A fake vision model: records each request, loads every image the way the real adapters do, and answers from `reply`. */
function fakeProvider(reply: (req: TextTurnRequest) => string | Promise<string> = () => '{"passed": true, "issues": []}') {
  const turns: Turn[] = []
  const provider: TextProvider = {
    async runTurn(req): Promise<TextTurnResult> {
      const message = req.messages.at(-1) as Extract<ChatMessage, { role: 'user' }>
      const loaded: Turn['loaded'] = []
      for (const p of message.imagePaths) loaded.push(await req.loadImage(p))
      turns.push({ req, loaded })
      return { text: await reply(req), toolCalls: [], stopReason: 'end', raw: null }
    }
  }
  return { provider, turns }
}

async function setup(opts: { vision?: boolean; reply?: Parameters<typeof fakeProvider>[0]; provider?: TextProvider; timeoutMs?: number } = {}) {
  const t = await tempProject()
  tp = t
  const docs = new WorkflowDocs(path.resolve('resources', 'agent-docs'))
  await docs.install(t.ctx)
  const imageOps = createIdentityImageOps()
  const fake = fakeProvider(opts.reply)
  const resolved: ResolvedModel[] = []
  const registry = {
    resolveOptional: vi.fn((role: string) => {
      expect(role).toBe('vision')
      return opts.vision === false ? null : RESOLVED
    })
  } as unknown as ModelRegistry
  const createTextProvider = vi.fn((r: ResolvedModel) => {
    resolved.push(r)
    return opts.provider ?? fake.provider
  })
  const checker = new ConsistencyChecker({ registry, docs, imageOps, createTextProvider, timeoutMs: opts.timeoutMs })
  return { checker, ctx: t.ctx, docs, imageOps, registry, createTextProvider, resolved, turns: fake.turns }
}

async function image(ctx: ProjectContext, rel: string): Promise<string> {
  await writeFileAtomic(ctx.paths.resolveAsset(rel), PNG)
  return rel
}

const MINA_REF = 'characters/chr_aaaaaaaaaa/var_aaaaaaaaaa.png'
const JIN_REF = 'characters/chr_bbbbbbbbbb/var_bbbbbbbbbb.png'
const PREVIOUS = 'panels/pnl_0000000002/ver_0000000002.png'
const GENERATED = 'panels/pnl_0000000001/ver_0000000001.png'

const mina = (): Character =>
  makeCharacter({
    id: 'chr_aaaaaaaaaa',
    name: 'Mina',
    appearanceLock: 'MINA LOCK',
    variations: [
      makeVariation({ id: 'var_aaaaaaaaaa', characterId: 'chr_aaaaaaaaaa', name: 'Base', status: 'ready', imagePath: MINA_REF }),
      makeVariation({ id: 'var_aaaaaaaaa2', characterId: 'chr_aaaaaaaaaa', name: 'School uniform', kind: 'outfit', delta: 'navy blazer, red ribbon', status: 'ready', imagePath: MINA_REF })
    ]
  })
const jin = (): Character =>
  makeCharacter({
    id: 'chr_bbbbbbbbbb',
    name: 'Jin',
    appearanceLock: 'JIN LOCK',
    variations: [makeVariation({ id: 'var_bbbbbbbbbb', characterId: 'chr_bbbbbbbbbb', name: 'Base', status: 'ready', imagePath: JIN_REF })]
  })

const cast = (characterId: string, variationId: string) => ({ characterId, variationId, action: '', expression: '', position: 'center' as const })

async function input(ctx: ProjectContext, over: Partial<ConsistencyCheckInput> = {}): Promise<ConsistencyCheckInput> {
  for (const rel of [MINA_REF, JIN_REF, PREVIOUS, GENERATED]) await image(ctx, rel)
  return {
    imageRelPath: GENERATED,
    references: [
      { relPath: MINA_REF, label: 'Mina' },
      { relPath: JIN_REF, label: 'Jin' },
      { relPath: PREVIOUS, label: 'previous panel' }
    ],
    panel: makePanel({
      description: 'Mina and Jin wait at the bus stop.',
      shot: 'close-up',
      characters: [cast('chr_aaaaaaaaaa', 'var_aaaaaaaaa2'), cast('chr_bbbbbbbbbb', 'var_bbbbbbbbbb')]
    }),
    roster: [mina(), jin()],
    ...over
  }
}

describe('ConsistencyChecker', () => {
  it('skips when no vision model is assigned', async () => {
    const { checker, ctx, createTextProvider, turns } = await setup({ vision: false })
    expect(await checker.check(ctx, await input(ctx))).toBeNull()
    expect(createTextProvider).not.toHaveBeenCalled()
    expect(turns).toHaveLength(0)
  })

  it('runs one tool-less turn on the vision model and returns the parsed verdict', async () => {
    const { checker, ctx, createTextProvider, resolved, turns } = await setup({ reply: () => '```json\n{"passed": false, "issues": ["Mina hair is black"]}\n```' })
    const result = await checker.check(ctx, await input(ctx))
    expect(result).toEqual({ passed: false, issues: ['Mina hair is black'], skipped: false })
    expect(createTextProvider).toHaveBeenCalledTimes(1)
    expect(resolved).toEqual([RESOLVED])
    expect(turns).toHaveLength(1)
    expect(turns[0].req.tools).toEqual([])
    expect(turns[0].req.messages).toHaveLength(1)
    expect(turns[0].req.messages[0]).toMatchObject({ role: 'user', stateSnapshot: null })
  })

  it('uses the checklist doc as system prompt', async () => {
    const { checker, ctx, turns, docs } = await setup()
    await checker.check(ctx, await input(ctx))
    expect(turns[0].req.system).toBe(await docs.read(ctx, 'reference/consistency-checklist'))
    expect(turns[0].req.system).toBe(CHECKLIST_TEMPLATE)
  })

  it('reads the project copy of the checklist, so an edit changes how the checker judges', async () => {
    const { checker, ctx, turns, docs } = await setup()
    await fs.promises.writeFile(docs.filePath(ctx, 'reference/consistency-checklist'), '# Mine\n\nBe strict about hats.\n')
    await checker.check(ctx, await input(ctx))
    expect(turns[0].req.system).toBe('# Mine\n\nBe strict about hats.\n')
  })

  it('downscales every image before sending', async () => {
    const { checker, ctx, turns, imageOps } = await setup()
    const inp = await input(ctx)
    await checker.check(ctx, inp)
    expect(imageOps.calls).toHaveLength(inp.references.length + 1)
    expect(imageOps.calls.every((c) => c.maxEdge === 1568)).toBe(true)
    expect(MAX_TEXT_MODEL_IMAGE_EDGE).toBe(1568)
    expect(turns[0].loaded).toHaveLength(4)
    expect(turns[0].loaded.every((l) => l.mime === 'image/png' && l.base64 === PNG.toString('base64'))).toBe(true)
  })

  it('sends the references in order and the generated image last', async () => {
    const { checker, ctx, turns } = await setup()
    await checker.check(ctx, await input(ctx))
    const message = turns[0].req.messages[0] as Extract<ChatMessage, { role: 'user' }>
    expect(message.imagePaths).toEqual([MINA_REF, JIN_REF, PREVIOUS, GENERATED])
  })

  it('lists the references, the cast with its looks, the description and the shot', async () => {
    const { checker, ctx, turns } = await setup()
    await checker.check(ctx, await input(ctx))
    const text = (turns[0].req.messages[0] as Extract<ChatMessage, { role: 'user' }>).text
    expect(text).toBe(
      [
        'Images, in the order attached:',
        '1. Reference: Mina',
        '2. Reference: Jin',
        '3. Reference: previous panel',
        '4. Generated panel (the image to check)',
        '',
        'Cast:',
        '- Mina — MINA LOCK — Look: School uniform — navy blazer, red ribbon',
        '- Jin — JIN LOCK — Look: Base',
        '',
        'Panel description: Mina and Jin wait at the bus stop.',
        'Shot: close-up'
      ].join('\n')
    )
  })

  it('marks a cast member without a reference image, and copes with an empty cast and no references', async () => {
    const { checker, ctx, turns } = await setup()
    // Jin's reference was dropped (over the image model's limit): only Mina and the previous panel were sent.
    const partial = await input(ctx)
    await checker.check(ctx, { ...partial, references: [partial.references[0], partial.references[2]] })
    const text = (turns[0].req.messages[0] as Extract<ChatMessage, { role: 'user' }>).text
    expect(text).toContain('- Mina — MINA LOCK — Look: School uniform — navy blazer, red ribbon\n')
    expect(text).toContain('- Jin — JIN LOCK — Look: Base (no reference image)')
    expect(text).toContain('1. Reference: Mina\n2. Reference: previous panel\n3. Generated panel (the image to check)')

    await checker.check(ctx, { ...partial, references: [], panel: makePanel({ characters: [] }) })
    const bare = (turns[1].req.messages[0] as Extract<ChatMessage, { role: 'user' }>).text
    expect(bare).toContain('1. Generated panel (the image to check)')
    expect(bare).toContain('Cast:\n(none)')
    expect((turns[1].req.messages[0] as Extract<ChatMessage, { role: 'user' }>).imagePaths).toEqual([GENERATED])
  })

  it('ties the run signal to the model call, and gives it a signal of its own when none is given', async () => {
    const { checker, ctx, turns } = await setup()
    const controller = new AbortController()
    await checker.check(ctx, { ...(await input(ctx)), signal: controller.signal })
    expect(turns[0].req.signal).toBeInstanceOf(AbortSignal)
    expect(turns[0].req.signal.aborted).toBe(false)
    controller.abort()
    expect(turns[0].req.signal.aborted).toBe(true)
    await checker.check(ctx, await input(ctx))
    expect(turns[1].req.signal).toBeInstanceOf(AbortSignal)
    expect(turns[1].req.signal.aborted).toBe(false)
  })

  it('answers a provider error with a skipped pass instead of throwing', async () => {
    const { checker, ctx } = await setup({
      provider: {
        runTurn: async () => {
          throw new Error('429 slow down')
        }
      }
    })
    expect(await checker.check(ctx, await input(ctx))).toEqual({ passed: true, issues: ['Consistency check failed to run: 429 slow down'], skipped: true })
  })

  it('answers a missing image, a missing checklist doc and an unsupported endpoint with a skipped pass too', async () => {
    const { checker, ctx, docs } = await setup()
    const inp = await input(ctx)
    const missing = await checker.check(ctx, { ...inp, imageRelPath: 'panels/pnl_0000000001/nope.png' })
    expect(missing).toMatchObject({ passed: true, skipped: true })
    expect(missing?.issues[0]).toMatch(/^Consistency check failed to run: /)

    const unsupported = new ConsistencyChecker({
      registry: { resolveOptional: () => RESOLVED } as unknown as ModelRegistry,
      docs,
      imageOps: createIdentityImageOps(),
      createTextProvider: () => {
        throw new Error('gemini endpoints do not support text models')
      }
    })
    expect(await unsupported.check(ctx, inp)).toEqual({ passed: true, issues: ['Consistency check failed to run: gemini endpoints do not support text models'], skipped: true })

    await fs.promises.rm(docs.filePath(ctx, 'reference/consistency-checklist'))
    expect(await checker.check(ctx, inp)).toEqual({ passed: true, issues: ['Consistency check failed to run: Unknown doc: reference/consistency-checklist'], skipped: true })
  })

  it('reads a reply it cannot parse as skipped', async () => {
    const { checker, ctx } = await setup({ reply: () => 'The panel looks consistent to me.' })
    expect(await checker.check(ctx, await input(ctx))).toEqual(UNPARSEABLE)
  })

  it('reports a cancelled check as skipped, not as a failure of the model', async () => {
    const controller = new AbortController()
    const { checker, ctx } = await setup({
      provider: {
        runTurn: async (req) => {
          controller.abort()
          throw Object.assign(new Error('The operation was aborted'), { name: 'AbortError', cause: req.signal.aborted })
        }
      }
    })
    expect(await checker.check(ctx, { ...(await input(ctx)), signal: controller.signal })).toEqual({ passed: true, issues: ['Consistency check failed to run: Cancelled'], skipped: true })
  })
})

describe('ConsistencyChecker timeout (Ruling T25c)', () => {
  const never = (): Promise<never> => new Promise(() => undefined)
  /** Answers only when its signal fires, the way the real adapters do. */
  const rejectOnAbort = (req: TextTurnRequest): Promise<never> =>
    new Promise((_, reject) => {
      req.signal.addEventListener('abort', () => reject(req.signal.reason))
    })

  it('gives the vision call 180 s by default', async () => {
    expect(CHECK_TIMEOUT_MS).toBe(180_000)
    const timeout = vi.spyOn(AbortSignal, 'timeout')
    try {
      const { checker, ctx } = await setup()
      await checker.check(ctx, await input(ctx))
      expect(timeout).toHaveBeenCalledWith(180_000)
    } finally {
      timeout.mockRestore()
    }
  })

  it('answers a call that never returns with a skipped pass, even when the provider ignores its signal', async () => {
    const { checker, ctx } = await setup({ timeoutMs: 40, provider: { runTurn: never } })
    expect(await checker.check(ctx, await input(ctx))).toEqual({ passed: true, issues: ['Consistency check timed out after 0.04s'], skipped: true })
  })

  it('answers the same when the provider ends its call on the signal, and a caller signal is also in play', async () => {
    const { checker, ctx } = await setup({ timeoutMs: 40, provider: { runTurn: rejectOnAbort } })
    const controller = new AbortController()
    expect(await checker.check(ctx, { ...(await input(ctx)), signal: controller.signal })).toEqual({ passed: true, issues: ['Consistency check timed out after 0.04s'], skipped: true })
    expect(controller.signal.aborted).toBe(false)
  })

  it('tells a caller abort from a timeout: the run being stopped reads Cancelled', async () => {
    for (const provider of [{ runTurn: never }, { runTurn: rejectOnAbort }]) {
      const { checker, ctx } = await setup({ timeoutMs: 30_000, provider })
      const controller = new AbortController()
      const running = checker.check(ctx, { ...(await input(ctx)), signal: controller.signal })
      setTimeout(() => controller.abort(), 20)
      expect(await running).toEqual({ passed: true, issues: ['Consistency check failed to run: Cancelled'], skipped: true })
    }
  })

  it('a run that was already stopped ends the check at once', async () => {
    const { checker, ctx } = await setup({ timeoutMs: 30_000, provider: { runTurn: never } })
    const controller = new AbortController()
    controller.abort()
    expect(await checker.check(ctx, { ...(await input(ctx)), signal: controller.signal })).toEqual({ passed: true, issues: ['Consistency check failed to run: Cancelled'], skipped: true })
  })

  it('does not disturb an answer that arrives in time', async () => {
    const { checker, ctx } = await setup({ timeoutMs: 5_000, reply: () => '{"passed": false, "issues": ["x"]}' })
    expect(await checker.check(ctx, await input(ctx))).toEqual({ passed: false, issues: ['x'], skipped: false })
  })
})
