import fs from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Character, ChatMessage, EndpointConfig } from '@shared/types'
import { WorkflowDocs } from '../agent/workflow-docs'
import { planImageReplay } from '../models/providers/image-replay'
import { encodeSolidPng } from '../models/providers/png'
import type { TextProvider, TextTurnRequest, TextTurnResult } from '../models/providers/types'
import type { ModelRegistry, ResolvedModel } from '../models/registry'
import { writeFileAtomic } from '../storage/atomic'
import type { ProjectContext } from '../storage/project-store'
import { makeCharacter, makeItem, makeItemUsage, makePanel, makeVariation } from '../test/factories'
import { tempProject, type TempProject } from '../test/temp-project'
import {
  buildCheckMessage,
  buildSheetCheckMessage,
  CANDIDATE_IMAGE_KEY,
  CHECK_TIMEOUT_MS,
  ConsistencyChecker,
  parseCheckResponse,
  type ConsistencyCheckInput,
  type SheetCheckInput
} from './consistency-checker'
import { createIdentityImageOps, MAX_TEXT_MODEL_IMAGE_EDGE, UnreadableImageError, type ImageOps } from './image-ops'

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
const RESOLVED = { endpoint: { id: 'end_0000000000', kind: 'mock', options: {} }, model: { id: 'mdl_000000000a', modelId: 'mock-text' }, apiKey: null } as unknown as ResolvedModel

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

async function setup(
  opts: { vision?: boolean; reply?: Parameters<typeof fakeProvider>[0]; provider?: TextProvider; timeoutMs?: number; endpointOptions?: EndpointConfig['options'] } = {}
) {
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
      if (opts.vision === false) return null
      return opts.endpointOptions ? { ...RESOLVED, endpoint: { ...RESOLVED.endpoint, options: opts.endpointOptions } } : RESOLVED
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
      { relPath: MINA_REF, label: 'Mina', subject: { kind: 'character', id: 'chr_aaaaaaaaaa' } },
      { relPath: JIN_REF, label: 'Jin', subject: { kind: 'character', id: 'chr_bbbbbbbbbb' } },
      { relPath: PREVIOUS, label: 'previous panel', subject: { kind: 'previous' } }
    ],
    panel: makePanel({
      description: 'Mina and Jin wait at the bus stop.',
      shot: 'close-up',
      characters: [cast('chr_aaaaaaaaaa', 'var_aaaaaaaaa2'), cast('chr_bbbbbbbbbb', 'var_bbbbbbbbbb')]
    }),
    roster: [mina(), jin()],
    itemRoster: [],
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

describe('ConsistencyChecker timeout', () => {
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

  it("gives the vision call its endpoint's timeoutSeconds instead, and names it when it runs out", async () => {
    const real = AbortSignal.timeout.bind(AbortSignal)
    // The endpoint asks for 600 s; the signal it gets fires after 20 ms so the test does not wait.
    const timeout = vi.spyOn(AbortSignal, 'timeout').mockImplementation(() => real(20))
    try {
      const { checker, ctx } = await setup({ timeoutMs: 5_000, endpointOptions: { timeoutSeconds: 600 }, provider: { runTurn: never } })
      expect(await checker.check(ctx, await input(ctx))).toEqual({ passed: true, issues: ['Consistency check timed out after 600s'], skipped: true })
      expect(timeout).toHaveBeenCalledWith(600_000)
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

describe('buildCheckMessage with items', () => {
  const NOVA_USAGE = makeItemUsage({ id: 'use_nova_fire', itemId: 'itm_nova', name: 'Firing', kind: 'action', delta: 'cyan beam', status: 'ready', imagePath: 'items/itm_nova/fire.png' })
  const novaItem = makeItem({ id: 'itm_nova', name: 'Nova', appearanceLock: 'NOVA ITEM LOCK', usages: [NOVA_USAGE] })
  const novaCharacter = makeCharacter({
    id: 'chr_nova',
    name: 'Nova',
    appearanceLock: 'NOVA CHAR LOCK',
    variations: [makeVariation({ id: 'var_nova', characterId: 'chr_nova', name: 'Base', status: 'ready', imagePath: 'characters/chr_nova/base.png' })]
  })
  const panel = makePanel({
    description: 'Nova draws.',
    shot: 'medium',
    characters: [{ characterId: 'chr_nova', variationId: 'var_nova', action: '', expression: '', position: 'center' }],
    items: [{ itemId: 'itm_nova', usageId: 'use_nova_fire', heldBy: 'chr_nova', action: 'aimed' }]
  })
  const characterRef = { relPath: 'characters/chr_nova/base.png', label: 'Nova', subject: { kind: 'character' as const, id: 'chr_nova' } }
  const itemRef = { relPath: 'items/itm_nova/fire.png', label: 'Nova', subject: { kind: 'item' as const, id: 'itm_nova' } }

  it('lists the items after the cast, with holder and usage', () => {
    const text = buildCheckMessage({ references: [characterRef, itemRef], panel, roster: [novaCharacter], itemRoster: [novaItem] })
    expect(text.split('\n')).toEqual([
      'Images, in the order attached:',
      '1. Reference: Nova',
      '2. Reference: Nova',
      '3. Generated panel (the image to check)',
      '',
      'Cast:',
      '- Nova — NOVA CHAR LOCK — Look: Base',
      '',
      'Items:',
      '- Nova — NOVA ITEM LOCK — Use: Firing — cyan beam — Held by: Nova',
      '',
      'Panel description: Nova draws.',
      'Shot: medium'
    ])
  })

  it('matches references by subject, not label, when a character and an item share a name', () => {
    // Only the item reference was sent: the character line must say so, and the item line must not.
    const itemOnly = buildCheckMessage({ references: [itemRef], panel, roster: [novaCharacter], itemRoster: [novaItem] })
    expect(itemOnly).toContain('- Nova — NOVA CHAR LOCK — Look: Base (no reference image)')
    expect(itemOnly).toContain('Held by: Nova\n')
    expect(itemOnly).not.toContain('Held by: Nova (no reference image)')

    // Only the character reference was sent: the reverse.
    const characterOnly = buildCheckMessage({ references: [characterRef], panel, roster: [novaCharacter], itemRoster: [novaItem] })
    expect(characterOnly).toContain('- Nova — NOVA CHAR LOCK — Look: Base\n')
    expect(characterOnly).toContain('- Nova — NOVA ITEM LOCK — Use: Firing — cyan beam — Held by: Nova (no reference image)')
  })

  it('writes nobody for an unheld item and omits the delta dash when it is empty', () => {
    const plain = makeItem({ id: 'itm_nova', name: 'Nova', appearanceLock: 'NOVA ITEM LOCK', usages: [{ ...NOVA_USAGE, delta: '' }] })
    const unheld = makePanel({ description: 'd', items: [{ itemId: 'itm_nova', usageId: 'use_nova_fire', heldBy: null, action: '' }] })
    const text = buildCheckMessage({ references: [], panel: unheld, roster: [], itemRoster: [plain] })
    expect(text).toContain('Cast:\n(none)\n\nItems:\n- Nova — NOVA ITEM LOCK — Use: Firing — Held by: nobody (no reference image)\n\nPanel description: d')
  })

  it('has no Items block for a panel without items, and throws for an item that is gone', () => {
    expect(buildCheckMessage({ references: [], panel: makePanel(), roster: [], itemRoster: [novaItem] })).not.toContain('Items:')
    expect(() => buildCheckMessage({ references: [], panel, roster: [novaCharacter], itemRoster: [] })).toThrow('Unknown item entry: itm_nova/use_nova_fire')
  })
})

describe('buildCheckMessage with packed sheets', () => {
  const person = (key: string, name: string) =>
    makeCharacter({ id: `chr_${key}`, name, appearanceLock: `${name.toUpperCase()}_LOCK`, variations: [makeVariation({ id: `var_${key}`, characterId: `chr_${key}`, name: 'Base', status: 'ready', imagePath: `characters/${key}.png` })] })
  const cast = [person('mina', 'Mina'), person('jin', 'Jin'), person('dohyun', 'Dohyun'), person('yuna', 'Yuna')]
  const panel = makePanel({ description: 'They meet.', shot: 'medium', characters: cast.map((c) => ({ characterId: c.id, variationId: c.variations[0].id, action: '', expression: '', position: 'center' as const })) })
  const packOf = (people: typeof cast) => ({
    relPath: 'panels/pnl_1/pack-a.png',
    label: 'character sheets',
    subject: { kind: 'pack' as const, members: people.map((c) => ({ subject: { kind: 'character' as const, id: c.id }, name: c.name, relPath: `characters/${c.id}.png` })) }
  })
  const single = (c: (typeof cast)[number]) => ({ relPath: `characters/${c.id}.png`, label: c.name, subject: { kind: 'character' as const, id: c.id } })

  it("says whose sheet is where on a pack, and counts its members' references as sent", () => {
    const text = buildCheckMessage({ references: [single(cast[0]), single(cast[1]), packOf(cast.slice(2))], panel, roster: cast, itemRoster: [] })
    expect(text.split('\n')).toEqual([
      'Images, in the order attached:',
      '1. Reference: Mina',
      '2. Reference: Jin',
      "3. Reference: character sheets, each labeled with the person's name: Dohyun (left), Yuna (right)",
      '4. Generated panel (the image to check)',
      '',
      'Cast:',
      '- Mina — MINA_LOCK — Look: Base',
      '- Jin — JIN_LOCK — Look: Base',
      '- Dohyun — DOHYUN_LOCK — Look: Base',
      '- Yuna — YUNA_LOCK — Look: Base',
      '',
      'Panel description: They meet.',
      'Shot: medium'
    ])
  })

  it('names the cells of a 2 × 2 pack, and marks a cast member left out of every reference', () => {
    const text = buildCheckMessage({ references: [packOf(cast.slice(0, 3))], panel, roster: cast, itemRoster: [] })
    expect(text).toContain("1. Reference: character sheets, each labeled with the person's name: Mina (top left), Jin (top right), Dohyun (bottom left)\n2. Generated panel")
    expect(text).toContain('- Dohyun — DOHYUN_LOCK — Look: Base\n')
    expect(text).toContain('- Yuna — YUNA_LOCK — Look: Base (no reference image)')
  })
})

// ---------------------------------------------------------------------------------------------

describe('buildSheetCheckMessage', () => {
  const ara = makeCharacter({ id: 'chr_ara', name: 'Ara', appearanceLock: 'LOCK' })
  const glaive = makeItem({ id: 'itm_vesper', name: 'Vesper glaive', appearanceLock: 'GLAIVE LOCK' })
  const rain = makeVariation({ id: 'var_rain', characterId: 'chr_ara', name: 'Outfit: Rain', kind: 'outfit', delta: 'yellow raincoat' })
  const usage = (o: Parameters<typeof makeItemUsage>[0]) => makeItemUsage({ itemId: 'itm_vesper', ...o })

  it('writes the base character sheet with only the candidate', () => {
    expect(buildSheetCheckMessage({ subject: { kind: 'character', character: ara, variation: ara.variations[0] }, baseImageRelPath: null })).toBe(
      ['Images, in the order attached:', '1. Generated sheet (the image to check)', '', 'Sheet: Character reference sheet', 'Subject: Ara', 'Lock: LOCK'].join('\n')
    )
  })

  it('adds the base reference and the look for a character variation', () => {
    expect(buildSheetCheckMessage({ subject: { kind: 'character', character: ara, variation: rain }, baseImageRelPath: 'characters/chr_ara/base.png' })).toBe(
      [
        'Images, in the order attached:',
        '1. Base reference: character Ara',
        '2. Generated sheet (the image to check)',
        '',
        'Sheet: Character reference sheet',
        'Subject: Ara',
        'Lock: LOCK',
        'Look: Outfit: Rain — yellow raincoat'
      ].join('\n')
    )
  })

  it('writes an item base sheet without a State or Usage line', () => {
    const text = buildSheetCheckMessage({ subject: { kind: 'item', item: glaive, usage: glaive.usages[0] }, baseImageRelPath: null })
    expect(text).toBe(['Images, in the order attached:', '1. Generated sheet (the image to check)', '', 'Sheet: Item reference sheet', 'Subject: Vesper glaive', 'Lock: GLAIVE LOCK'].join('\n'))
    expect(text).not.toMatch(/State:|Usage:/)
  })

  it('writes a state usage as an item reference sheet with a State line', () => {
    const folded = usage({ id: 'use_folded', name: 'Folded', kind: 'state', delta: 'blade folded flat' })
    expect(buildSheetCheckMessage({ subject: { kind: 'item', item: glaive, usage: folded }, baseImageRelPath: 'items/itm_vesper/base.png' })).toBe(
      [
        'Images, in the order attached:',
        '1. Base reference: item Vesper glaive',
        '2. Generated sheet (the image to check)',
        '',
        'Sheet: Item reference sheet',
        'Subject: Vesper glaive',
        'Lock: GLAIVE LOCK',
        'State: Folded — blade folded flat'
      ].join('\n')
    )
  })

  it('writes an action usage as an item usage reference sheet with a Usage line', () => {
    const sweep = usage({ id: 'use_sweep', name: 'Sweeping strike', kind: 'action', delta: 'D' })
    const text = buildSheetCheckMessage({ subject: { kind: 'item', item: glaive, usage: sweep }, baseImageRelPath: 'items/itm_vesper/base.png' })
    expect(text).toContain('Sheet: Item usage reference sheet\n')
    expect(text.split('\n').at(-1)).toBe('Usage: Sweeping strike — D')
  })

  it('reads the name alone when a non-base sheet has an empty delta', () => {
    const noDelta = makeVariation({ id: 'var_plain', characterId: 'chr_ara', name: 'Outfit: Plain', kind: 'outfit', delta: '' })
    expect(buildSheetCheckMessage({ subject: { kind: 'character', character: ara, variation: noDelta }, baseImageRelPath: 'x.png' }).split('\n').at(-1)).toBe('Look: Outfit: Plain')
    const state = usage({ id: 'use_s', name: 'Folded', kind: 'state', delta: '' })
    expect(buildSheetCheckMessage({ subject: { kind: 'item', item: glaive, usage: state }, baseImageRelPath: 'x.png' }).split('\n').at(-1)).toBe('State: Folded')
    const action = usage({ id: 'use_a', name: 'Strike', kind: 'action', delta: '' })
    expect(buildSheetCheckMessage({ subject: { kind: 'item', item: glaive, usage: action }, baseImageRelPath: 'x.png' }).split('\n').at(-1)).toBe('Usage: Strike')
  })
})

describe('ConsistencyChecker.checkSheet', () => {
  const BASE = 'characters/chr_x/base.png'
  const SHEET_TEMPLATE = fs.readFileSync(path.resolve('resources', 'agent-docs', 'reference', 'sheet-checklist.md'), 'utf8')
  const CANDIDATE = encodeSolidPng(4, 5, [9, 8, 7])
  const character = makeCharacter({ id: 'chr_x', name: 'Ara', appearanceLock: 'LOCK' })
  const rain = makeVariation({ id: 'var_rain', characterId: 'chr_x', name: 'Outfit: Rain', kind: 'outfit', delta: 'yellow raincoat' })

  const sheetInput = (over: Partial<SheetCheckInput> = {}): SheetCheckInput => ({
    image: CANDIDATE,
    subject: { kind: 'character', character, variation: rain },
    baseImageRelPath: BASE,
    ...over
  })

  it('sends the sheet checklist as system and the candidate as the last image', async () => {
    const { checker, ctx, turns, docs, imageOps } = await setup({ reply: () => '{"passed": false, "issues": ["Ara reads as a man"]}' })
    await image(ctx, BASE)
    const result = await checker.checkSheet(ctx, sheetInput())
    expect(result).toEqual({ passed: false, issues: ['Ara reads as a man'], skipped: false })
    expect(turns[0].req.system).toBe(await docs.read(ctx, 'reference/sheet-checklist'))
    expect(turns[0].req.system).toBe(SHEET_TEMPLATE)
    const message = turns[0].req.messages[0] as Extract<ChatMessage, { role: 'user' }>
    expect(message.imagePaths).toEqual([BASE, CANDIDATE_IMAGE_KEY])
    expect(message.imagePaths.at(-1)).toBe('candidate://sheet')
    expect(message.text).toBe(buildSheetCheckMessage(sheetInput()))
    expect(turns[0].req.tools).toEqual([])
    expect(turns[0].loaded[0]).toEqual({ mime: 'image/png', base64: PNG.toString('base64') })
    expect(turns[0].loaded[1]).toEqual({ mime: 'image/png', base64: CANDIDATE.toString('base64') })
    // The candidate is prepared before the turn, the base sheet is loaded by the turn.
    expect(imageOps.calls).toEqual([
      { maxEdge: 1568, bytes: CANDIDATE.length, format: 'jpeg' },
      { maxEdge: 1568, bytes: PNG.length, format: 'jpeg' }
    ])
  })

  it('sends only the candidate for a base sheet', async () => {
    const { checker, ctx, turns } = await setup()
    await checker.checkSheet(ctx, sheetInput({ baseImageRelPath: null, subject: { kind: 'character', character, variation: character.variations[0] } }))
    expect((turns[0].req.messages[0] as Extract<ChatMessage, { role: 'user' }>).imagePaths).toEqual([CANDIDATE_IMAGE_KEY])
    expect(turns[0].loaded).toHaveLength(1)
  })

  it('returns null without a vision model', async () => {
    const { checker, ctx, createTextProvider } = await setup({ vision: false })
    expect(await checker.checkSheet(ctx, sheetInput())).toBeNull()
    expect(createTextProvider).not.toHaveBeenCalled()
  })

  it('is a skipped pass when the doc is missing, the base image is missing, the candidate is unusable, the provider throws or the call times out', async () => {
    const { checker, ctx, docs } = await setup()
    const noBase = await checker.checkSheet(ctx, sheetInput())
    expect(noBase).toMatchObject({ passed: true, skipped: true })
    expect(noBase?.issues[0]).toMatch(/^Consistency check failed to run: /)

    await image(ctx, BASE)
    const empty = await checker.checkSheet(ctx, sheetInput({ image: Buffer.alloc(0) }))
    expect(empty).toMatchObject({ passed: true, skipped: true })
    expect(empty?.issues[0]).toMatch(/^Consistency check failed to run: /)

    await fs.promises.rm(docs.filePath(ctx, 'reference/sheet-checklist'))
    expect(await checker.checkSheet(ctx, sheetInput())).toEqual({ passed: true, issues: ['Consistency check failed to run: Unknown doc: reference/sheet-checklist'], skipped: true })

    const thrower = await setup({
      provider: {
        runTurn: async () => {
          throw new Error('429 slow down')
        }
      }
    })
    expect(await thrower.checker.checkSheet(thrower.ctx, sheetInput())).toEqual({ passed: true, issues: ['Consistency check failed to run: 429 slow down'], skipped: true })

    const slow = await setup({ timeoutMs: 40, provider: { runTurn: () => new Promise<never>(() => undefined) } })
    expect(await slow.checker.checkSheet(slow.ctx, sheetInput())).toEqual({ passed: true, issues: ['Consistency check timed out after 0.04s'], skipped: true })
  })

  describe('an unusable candidate', () => {
    /**
     * A provider that loads user-message images the way openai-chat and anthropic do: through `planImageReplay`, which
     * turns an `ImageUnavailableError` into a text note and goes on. `turns` counts the turns that ran, `notes` the
     * placeholders the model would have been shown.
     */
    function replayingProvider() {
      const seen = { turns: 0, notes: [] as string[] }
      const provider: TextProvider = {
        async runTurn(req): Promise<TextTurnResult> {
          const message = req.messages.at(-1) as Extract<ChatMessage, { role: 'user' }>
          const images = await planImageReplay(req.messages, req.loadImage)(req.messages.length - 1, message.imagePaths)
          seen.turns++
          for (const img of images) if (img.kind === 'note') seen.notes.push(img.text)
          return { text: '{"passed": false, "issues": ["judged a sheet it never saw"]}', toolCalls: [], stopReason: 'end', raw: null }
        }
      }
      return { provider, seen }
    }

    const emptyDownscale: ImageOps = { downscale: async () => ({ mime: 'image/jpeg', data: Buffer.alloc(0) }), size: () => ({ width: 0, height: 0 }) }
    const unreadable: ImageOps = {
      downscale: async () => {
        throw new UnreadableImageError('not an image')
      },
      size: () => ({ width: 0, height: 0 })
    }

    it.each([
      ['an empty buffer', undefined, Buffer.alloc(0)],
      ['bytes that are no image', unreadable, Buffer.from('nope')],
      ['a downscale that comes back empty', emptyDownscale, CANDIDATE]
    ])('is a skipped pass without running the turn for %s', async (_name, imageOps, buffer) => {
      const { provider, seen } = replayingProvider()
      const { registry, docs, ctx } = await setup()
      const checker = new ConsistencyChecker({ registry, docs, imageOps: imageOps ?? createIdentityImageOps(), createTextProvider: () => provider })
      await image(ctx, BASE)
      const result = await checker.checkSheet(ctx, sheetInput({ image: buffer }))
      expect(result).toMatchObject({ passed: true, skipped: true })
      expect(result?.issues[0]).toMatch(/^Consistency check failed to run: .*candidate:\/\/sheet/)
      expect(seen.turns).toBe(0)
      expect(seen.notes).toEqual([])
    })

    it('still serves a good candidate to the turn', async () => {
      const { provider, seen } = replayingProvider()
      const { registry, docs, ctx, imageOps } = await setup()
      const checker = new ConsistencyChecker({ registry, docs, imageOps, createTextProvider: () => provider })
      await image(ctx, BASE)
      expect(await checker.checkSheet(ctx, sheetInput())).toEqual({ passed: false, issues: ['judged a sheet it never saw'], skipped: false })
      expect(seen).toEqual({ turns: 1, notes: [] })
      expect(imageOps.calls.filter((c) => c.bytes === CANDIDATE.length)).toHaveLength(1)
    })
  })

  it('reads Cancelled when the caller aborts', async () => {
    const controller = new AbortController()
    const { checker, ctx } = await setup({
      provider: {
        runTurn: async () => {
          controller.abort()
          throw Object.assign(new Error('The operation was aborted'), { name: 'AbortError' })
        }
      }
    })
    expect(await checker.checkSheet(ctx, sheetInput({ signal: controller.signal }))).toEqual({ passed: true, issues: ['Consistency check failed to run: Cancelled'], skipped: true })
  })
})
