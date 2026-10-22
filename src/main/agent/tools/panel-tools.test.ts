import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Character, Panel, PanelDraft, ToolResult } from '@shared/types'
import type { ProjectContext } from '../../storage/project-store'
import { testServices, type TestServices } from '../../test/test-services'
import { buildAgentTools } from '.'
import type { ToolContext } from './registry'

let s: TestServices | undefined
afterEach(async () => {
  vi.restoreAllMocks()
  await s?.cleanup()
  s = undefined
})

let n = 0
const call = (name: string, input: unknown) => ({ id: `call_${++n}`, name, input })
const json = (r: ToolResult): Record<string, any> => JSON.parse(r.content)
const GHOST_PANEL = 'pnl_ffffffffff'
const GHOST_EPISODE = 'epi_ffffffffff'

async function setup(opts: { signal?: AbortSignal; vision?: boolean } = {}) {
  s = await testServices()
  const services = s
  const ctx = await services.projects.create({ title: 'Moon Diary' })
  const tools = buildAgentTools({ vision: opts.vision ?? true })
  const toolCtx: ToolContext = { project: ctx, services, signal: opts.signal ?? new AbortController().signal, threadKey: 'ses_0000000001' }
  const run = (name: string, input: unknown): Promise<ToolResult> => tools.execute(call(name, input), toolCtx)
  const [episode] = await services.episodes.list(ctx)

  /** A character whose base image is ready, so it can be cast. */
  async function character(name: string): Promise<Character> {
    const created = await services.characters.create(ctx, { name, role: 'protagonist', appearanceLock: `${name} LOCK` }, 'user')
    await services.characters.generateVariationImage(ctx, created.id, created.variations[0].id)
    return services.characters.get(ctx, created.id)
  }
  const cast = (c: Character) => ({ characterId: c.id, variationId: c.variations[0].id, action: 'standing', expression: 'calm', position: 'center' as const })
  const draft = (members: Character[], o: Record<string, unknown> = {}) => ({
    episodeId: episode.id,
    description: 'Mina opens the door.',
    setting: 'Apartment hallway, evening',
    shot: 'medium',
    characters: members.map(cast),
    dialogue: [],
    ...o
  })
  const created = async (members: Character[], o: Record<string, unknown> = {}): Promise<Record<string, any>> => {
    const r = await run('create_panel', draft(members, o))
    expect(r.ok, r.content).toBe(true)
    return json(r)
  }
  const panel = (id: string): Promise<Panel> => services.panels.get(ctx, id)
  return { s: services, ctx, tools, toolCtx, run, episode, character, cast, draft, created, panel }
}

/** An image call that never answers on its own and rejects the way a provider does when its signal fires. */
function hangOnAbort(): (_ctx: ProjectContext, req: { signal?: AbortSignal }) => Promise<never> {
  return (_ctx, req) =>
    new Promise((_resolve, reject) => {
      req.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })))
    })
}

describe('panel tools: the tool set', () => {
  it('tool set depends on vision', () => {
    expect(buildAgentTools({ vision: false }).names()).not.toContain('view_panel_image')
    expect(buildAgentTools({ vision: true }).names()).toEqual(
      expect.arrayContaining([
        'list_characters',
        'get_character',
        'create_character',
        'update_character',
        'create_variation',
        'regenerate_variation',
        'list_episodes',
        'create_episode',
        'list_panels',
        'get_panel',
        'view_panel_image',
        'create_panel',
        'update_panel',
        'regenerate_panel',
        'edit_panel_image'
      ])
    )
  })

  it('offers exactly the panel tools, view_panel_image only with vision', () => {
    // The six character tools come first (character-tools.test.ts), then the panel tools, then the four story tools (story-tools.test.ts).
    expect(buildAgentTools({ vision: true }).names().slice(6, -4)).toEqual([
      'list_episodes',
      'create_episode',
      'list_panels',
      'get_panel',
      'view_panel_image',
      'create_panel',
      'update_panel',
      'regenerate_panel',
      'edit_panel_image'
    ])
    expect(buildAgentTools({ vision: false }).names().slice(6, -4)).toEqual([
      'list_episodes',
      'create_episode',
      'list_panels',
      'get_panel',
      'create_panel',
      'update_panel',
      'regenerate_panel',
      'edit_panel_image'
    ])
  })

  it('describes the inputs as JSON schemas the model can fill in', () => {
    const specs = Object.fromEntries(buildAgentTools({ vision: true }).specs().map((t) => [t.name, t]))
    const schema = (name: string) => specs[name].inputSchema as { required?: string[]; properties: Record<string, any> }
    expect(schema('create_panel').required).toEqual(expect.arrayContaining(['episodeId', 'description', 'setting', 'shot', 'characters', 'dialogue']))
    for (const optional of ['afterPanelId', 'aspect', 'continuityNotes', 'offPanelMentions']) expect(schema('create_panel').required).not.toContain(optional)
    expect(schema('create_panel').properties.shot.enum).toContain('close-up')
    expect(schema('create_panel').properties.aspect.enum).toContain('2:3')
    expect(schema('list_panels').required).toEqual(['episodeId'])
    expect(schema('update_panel').required).toEqual(['panelId', 'patch'])
    expect(schema('edit_panel_image').required).toEqual(['panelId', 'instruction'])
    expect(schema('regenerate_panel').required).toEqual(['panelId'])
    expect(schema('create_episode').required).toEqual(['title'])
    for (const spec of Object.values(specs)) expect(spec.description.length).toBeGreaterThan(20)
  })
})

describe('create_panel', () => {
  it('create_panel returns the image and continuity', async () => {
    const { run, character, created, draft, panel } = await setup()
    const mina = await character('Mina')
    const first = await created([mina])
    const r = await run('create_panel', draft([mina], { description: 'Mina steps outside.' }))
    expect(r.ok).toBe(true)
    const out = json(r)
    expect(out).toMatchObject({ status: 'ready', error: null, warnings: [], check: null })
    expect(out.panelId).toMatch(/^pnl_[0-9a-f]{10}$/)
    expect(out.versionId).toMatch(/^ver_[0-9a-f]{10}$/)
    expect(out.imagePath).toMatch(/^panels\/pnl_[0-9a-f]{10}\/ver_[0-9a-f]{10}\.png$/)
    expect(r.images).toHaveLength(1)
    expect(r.images).toEqual([out.imagePath])

    const stored = await panel(out.panelId)
    expect(stored).toMatchObject({ createdBy: 'ai', currentVersionId: out.versionId })
    // The cast variation image first, then the previous panel's current image.
    expect(stored.versions[0].referenceImagePaths).toEqual([mina.variations[0].imagePath, first.imagePath])
  })

  it('create_panel enforces the mention guard', async () => {
    const { run, s, ctx, character, draft, episode } = await setup()
    const mina = await character('Mina')
    await character('Jin')
    const generate = vi.spyOn(s.images, 'generate')
    const r = await run('create_panel', draft([mina], { description: 'Mina waits while Jin watches from the stairs.' }))
    expect(r.ok).toBe(false)
    expect(r.content).toContain('Mentioned but not attached: Jin')
    expect(generate).not.toHaveBeenCalled()
    expect((await s.episodes.get(ctx, episode.id)).panelIds).toEqual([])

    // Listing the name as off-panel is the sanctioned way through.
    const ok = await run('create_panel', draft([mina], { description: 'Mina waits while Jin watches from the stairs.', offPanelMentions: ['Jin'] }))
    expect(ok.ok).toBe(true)
  })

  it('stores the draft as the agent made it, with the project default aspect and dialogue ids', async () => {
    const { run, character, draft, panel } = await setup()
    const mina = await character('Mina')
    const r = await run(
      'create_panel',
      draft([mina], {
        continuityNotes: 'Same lighting.',
        dialogue: [
          { speakerId: mina.id, kind: 'speech', text: 'Hello?' },
          { speakerId: null, kind: 'narration', text: 'Silence.' }
        ]
      })
    )
    const stored = await panel(json(r).panelId)
    expect(stored).toMatchObject({ aspect: '2:3', shot: 'medium', continuityNotes: 'Same lighting.', createdBy: 'ai' })
    expect(stored.dialogue).toMatchObject([
      { speakerId: mina.id, kind: 'speech', text: 'Hello?' },
      { speakerId: null, kind: 'narration', text: 'Silence.' }
    ])
    expect(stored.dialogue[0].id).toMatch(/^dlg_[0-9a-f]{10}$/)
  })

  it('applies the cast defaults a model may leave out', async () => {
    const { run, character, draft, panel } = await setup()
    const mina = await character('Mina')
    const r = await run('create_panel', draft([], { characters: [{ characterId: mina.id, variationId: mina.variations[0].id }] }))
    expect(r.ok, r.content).toBe(true)
    expect((await panel(json(r).panelId)).characters).toEqual([{ characterId: mina.id, variationId: mina.variations[0].id, action: '', expression: '', position: 'center' }])
  })

  it('joins every validation issue with newlines and writes nothing', async () => {
    const { run, s, ctx, draft, episode } = await setup()
    const r = await run(
      'create_panel',
      draft([], {
        characters: [{ characterId: 'chr_ffffffffff', variationId: 'var_ffffffffff', action: '', expression: '', position: 'center' }],
        dialogue: [{ speakerId: 'chr_eeeeeeeeee', kind: 'speech', text: 'Hi' }]
      })
    )
    expect(r).toMatchObject({ ok: false, content: 'Unknown character: chr_ffffffffff\nUnknown speaker: chr_eeeeeeeeee' })
    expect((await s.episodes.get(ctx, episode.id)).panelIds).toEqual([])
  })

  it('rejects an archived character and a variation that is not ready (Review Focus 4)', async () => {
    const { run, s, ctx, character, draft } = await setup()
    const jin = await character('Jin')
    await s.characters.archive(ctx, jin.id)
    expect(await run('create_panel', draft([jin], { description: 'Jin looks up.' }))).toMatchObject({ ok: false, content: 'Character Jin is archived' })

    const pending = await s.characters.create(ctx, { name: 'Ren', role: 'minor', appearanceLock: 'LOCK' }, 'user')
    const r = await run('create_panel', draft([], { description: 'Ren looks up.', characters: [{ characterId: pending.id, variationId: pending.variations[0].id }] }))
    expect(r).toMatchObject({ ok: false, content: 'Variation "Base" of Ren has no ready reference image' })
  })

  it('reports an unknown or malformed episode and an unknown anchor panel', async () => {
    const { run, draft } = await setup()
    expect(await run('create_panel', draft([], { episodeId: GHOST_EPISODE }))).toMatchObject({ ok: false, content: `Unknown episode: ${GHOST_EPISODE}` })
    expect(await run('create_panel', draft([], { episodeId: 'Episode 1' }))).toMatchObject({ ok: false, content: 'Unknown episode: Episode 1' })
    expect(await run('create_panel', draft([], { afterPanelId: GHOST_PANEL }))).toMatchObject({ ok: false, content: `Unknown panel: ${GHOST_PANEL}` })
  })

  it('inserts after the anchor, at the start for null, and at the end by default', async () => {
    const { run, s, ctx, created, episode } = await setup()
    const a = (await created([], { description: 'A' })).panelId
    const b = (await created([], { description: 'B' })).panelId
    const c = (await created([], { description: 'C', afterPanelId: a })).panelId
    const d = (await created([], { description: 'D', afterPanelId: null })).panelId
    expect((await s.episodes.get(ctx, episode.id)).panelIds).toEqual([d, a, c, b])
    expect(json(await run('list_panels', { episodeId: episode.id })).panels.map((p: { description: string }) => p.description)).toEqual(['D', 'A', 'C', 'B'])
  })

  it('keeps the panel and reports a failed image inside an ok result', async () => {
    const { run, s, character, draft, panel } = await setup()
    const mina = await character('Mina')
    await s.registry.assignRole('image', null)
    const r = await run('create_panel', draft([mina]))
    expect(r.ok).toBe(true)
    const out = json(r)
    expect(out).toMatchObject({ status: 'failed', imagePath: null })
    expect(out.error).toContain("No model assigned to role 'image'")
    expect(r.images).toEqual([])
    const stored = await panel(out.panelId)
    expect(stored.currentVersionId).toBeNull()
    expect(stored.versions).toMatchObject([{ id: out.versionId, status: 'failed' }])
  })

  it('passes the run signal to the image call, so Stop ends a generation that is under way (Review Focus 1)', async () => {
    const controller = new AbortController()
    const { run, s, draft, panel } = await setup({ signal: controller.signal })
    const generate = vi.spyOn(s.images, 'generate').mockImplementation(hangOnAbort())
    const pending = run('create_panel', draft([]))
    await vi.waitFor(() => expect(generate).toHaveBeenCalledTimes(1))
    expect(generate.mock.calls[0][1].signal).toBe(controller.signal)
    controller.abort()
    const r = await pending
    expect(r.ok).toBe(true)
    expect(json(r)).toMatchObject({ status: 'failed', error: 'Cancelled', imagePath: null })
    expect((await panel(json(r).panelId)).versions[0]).toMatchObject({ status: 'failed', error: 'Cancelled' })
  })
})

describe('list_panels and get_panel', () => {
  it('list_panels returns the last N in order', async () => {
    const { run, s, ctx, episode, character, cast } = await setup()
    const mina = await character('Mina')
    for (let i = 0; i < 7; i++) {
      await s.panels.create(ctx, { episodeId: episode.id, description: `Beat ${i}`, setting: 'Hall', shot: 'medium', characters: i === 6 ? [cast(mina)] : [], dialogue: [] }, { createdBy: 'ai', strictMentions: true })
    }
    const last = json(await run('list_panels', { episodeId: episode.id }))
    expect(last.panels.map((p: { index: number }) => p.index)).toEqual([2, 3, 4, 5, 6])
    expect(last.panels.map((p: { description: string }) => p.description)).toEqual(['Beat 2', 'Beat 3', 'Beat 4', 'Beat 5', 'Beat 6'])

    expect(json(await run('list_panels', { episodeId: episode.id, last: 2 })).panels.map((p: { index: number }) => p.index)).toEqual([5, 6])
    expect(json(await run('list_panels', { episodeId: episode.id, last: 50 })).panels).toHaveLength(7)
    expect(await run('list_panels', { episodeId: episode.id, last: 0 })).toMatchObject({ ok: false })
  })

  it('shows each panel with its cast names, dialogue and current version', async () => {
    const { run, character, created, episode } = await setup()
    const mina = await character('Mina')
    const made = await created([mina], { shot: 'close-up', aspect: '1:1', dialogue: [{ speakerId: mina.id, kind: 'thought', text: 'Not again.' }] })
    const { panels } = json(await run('list_panels', { episodeId: episode.id }))
    expect(panels).toHaveLength(1)
    expect(panels[0]).toEqual({
      id: made.panelId,
      index: 0,
      shot: 'close-up',
      aspect: '1:1',
      cast: [{ name: 'Mina', characterId: mina.id, variationId: mina.variations[0].id }],
      description: 'Mina opens the door.',
      dialogue: [{ id: expect.stringMatching(/^dlg_/), speakerId: mina.id, kind: 'thought', text: 'Not again.' }],
      currentVersion: { id: made.versionId, status: 'ready', imagePath: made.imagePath }
    })
  })

  it('reports no current version for a panel with no ready image, and keeps naming an archived cast member (Review Focus 4)', async () => {
    const { run, s, ctx, episode, character, cast } = await setup()
    const mina = await character('Mina')
    await s.panels.create(ctx, { episodeId: episode.id, description: 'Mina waits.', setting: 'Hall', shot: 'wide', characters: [cast(mina)], dialogue: [] }, { createdBy: 'ai', strictMentions: true })
    await s.characters.archive(ctx, mina.id)
    const { panels } = json(await run('list_panels', { episodeId: episode.id }))
    expect(panels[0]).toMatchObject({ currentVersion: null, cast: [{ name: 'Mina', characterId: mina.id }] })
  })

  it('list_panels reports an unknown or malformed episode', async () => {
    const { run } = await setup()
    expect(await run('list_panels', { episodeId: GHOST_EPISODE })).toMatchObject({ ok: false, content: `Unknown episode: ${GHOST_EPISODE}` })
    expect(await run('list_panels', { episodeId: '../x' })).toMatchObject({ ok: false, content: 'Unknown episode: ../x' })
  })

  it('get_panel returns the whole panel with its version history, and rejects unknown ids', async () => {
    const { run, created, character, panel } = await setup()
    const mina = await character('Mina')
    const made = await created([mina])
    const full = json(await run('get_panel', { panelId: made.panelId }))
    expect(full).toEqual(JSON.parse(JSON.stringify(await panel(made.panelId))))
    expect(full.versions).toMatchObject([{ id: made.versionId, source: 'generate', status: 'ready' }])
    expect(await run('get_panel', { panelId: GHOST_PANEL })).toMatchObject({ ok: false, content: `Unknown panel: ${GHOST_PANEL}` })
    expect(await run('get_panel', { panelId: 'the first one' })).toMatchObject({ ok: false, content: 'Unknown panel: the first one' })
  })
})

describe('view_panel_image', () => {
  it('returns the current image for the model to look at', async () => {
    const { run, created } = await setup()
    const made = await created([])
    const r = await run('view_panel_image', { panelId: made.panelId })
    expect(r.ok).toBe(true)
    expect(r.images).toEqual([made.imagePath])
    expect(json(r)).toMatchObject({ panelId: made.panelId, versionId: made.versionId, imagePath: made.imagePath })
  })

  it('says so when the panel has no ready image, and rejects unknown ids', async () => {
    const { run, s, draft } = await setup()
    await s.registry.assignRole('image', null)
    const made = json(await run('create_panel', draft([])))
    const r = await run('view_panel_image', { panelId: made.panelId })
    expect(r).toMatchObject({ ok: false, content: `Panel ${made.panelId} has no ready image`, images: [] })
    expect(await run('view_panel_image', { panelId: GHOST_PANEL })).toMatchObject({ ok: false, content: `Unknown panel: ${GHOST_PANEL}` })
  })
})

describe('update_panel', () => {
  it('changes only the named fields and does not touch the image', async () => {
    const { run, s, created, panel } = await setup()
    const made = await created([], { description: 'Original', setting: 'Hall', continuityNotes: 'Keep it dim.' })
    const generate = vi.spyOn(s.images, 'generate')
    const r = await run('update_panel', { panelId: made.panelId, patch: { description: 'Rewritten', shot: 'wide' } })
    expect(r.ok, r.content).toBe(true)
    expect(json(r)).toMatchObject({ panel: { id: made.panelId, description: 'Rewritten', shot: 'wide', setting: 'Hall', continuityNotes: 'Keep it dim.' }, warnings: [] })
    expect(r.images).toEqual([])
    expect(generate).not.toHaveBeenCalled()
    const stored = await panel(made.panelId)
    expect(stored).toMatchObject({ description: 'Rewritten', shot: 'wide', currentVersionId: made.versionId })
    expect(stored.versions).toHaveLength(1)
  })

  it('enforces the same validation as create_panel, and the mention guard on a description edit', async () => {
    const { run, character, created, panel } = await setup()
    const mina = await character('Mina')
    await character('Jin')
    const made = await created([mina])
    const mention = await run('update_panel', { panelId: made.panelId, patch: { description: 'Mina meets Jin.' } })
    expect(mention.ok).toBe(false)
    expect(mention.content).toContain('Mentioned but not attached: Jin')
    const bad = await run('update_panel', { panelId: made.panelId, patch: { characters: [{ characterId: 'chr_ffffffffff', variationId: 'var_ffffffffff' }] } })
    expect(bad).toMatchObject({ ok: false, content: 'Unknown character: chr_ffffffffff' })
    expect((await panel(made.panelId)).description).toBe('Mina opens the door.')
  })

  // Ruling T19a: the mention guard is strict only when the agent edits the description.
  describe('a panel saved with an unattached-mention warning (Ruling T19a)', () => {
    async function warned() {
      const h = await setup()
      const mina = await h.character('Mina')
      await h.character('Jin')
      const draft = h.draft([mina], { description: 'Mina waits while Jin watches.' }) as PanelDraft
      const { panel, warnings } = await h.s.panels.create(h.ctx, draft, { createdBy: 'user', strictMentions: false })
      expect(warnings).toHaveLength(1)
      return { ...h, mina, id: panel.id }
    }

    it('still accepts an update that does not touch the description, and passes the warning on', async () => {
      const { run, panel, mina, id } = await warned()
      const r = await run('update_panel', { panelId: id, patch: { dialogue: [{ speakerId: mina.id, kind: 'speech', text: 'Hello?' }] } })
      expect(r.ok, r.content).toBe(true)
      const out = json(r)
      expect(out.warnings).toEqual([expect.stringContaining('Mentioned but not attached: Jin')])
      expect(out.panel.dialogue).toMatchObject([{ speakerId: mina.id, text: 'Hello?' }])
      expect((await panel(id)).dialogue).toMatchObject([{ text: 'Hello?' }])
    })

    it('with regenerate, draws the panel and carries the warning in the result', async () => {
      const { run, id } = await warned()
      const r = await run('update_panel', { panelId: id, patch: { shot: 'wide' }, regenerate: true })
      expect(r.ok, r.content).toBe(true)
      expect(json(r)).toMatchObject({ status: 'ready', warnings: [expect.stringContaining('Mentioned but not attached: Jin')] })
    })

    it('rejects a description edit that leaves a character unattached', async () => {
      const { run, panel, id } = await warned()
      const r = await run('update_panel', { panelId: id, patch: { description: 'Mina waits while Jin watches from the stairs.' } })
      expect(r.ok).toBe(false)
      expect(r.content).toContain('Mentioned but not attached: Jin')
      expect((await panel(id)).description).toBe('Mina waits while Jin watches.')
    })

    it('accepts a description edit once the mention is listed as off-panel', async () => {
      const { run, id } = await warned()
      const r = await run('update_panel', { panelId: id, patch: { description: 'Mina waits while Jin watches from the stairs.', offPanelMentions: ['Jin'] } })
      expect(r.ok, r.content).toBe(true)
      expect(json(r).warnings).toEqual([])
    })
  })

  it('with regenerate awaits a new image and returns it like create_panel', async () => {
    const { run, created, panel } = await setup()
    const made = await created([])
    const r = await run('update_panel', { panelId: made.panelId, patch: { description: 'A different moment.' }, regenerate: true })
    expect(r.ok, r.content).toBe(true)
    const out = json(r)
    expect(out).toMatchObject({ panelId: made.panelId, status: 'ready', error: null, warnings: [], check: null })
    expect(out.versionId).not.toBe(made.versionId)
    expect(r.images).toEqual([out.imagePath])
    const stored = await panel(made.panelId)
    expect(stored).toMatchObject({ description: 'A different moment.', currentVersionId: out.versionId })
    expect(stored.versions).toHaveLength(2)
  })

  it('does not regenerate when the update is rejected', async () => {
    const { run, s, created, panel } = await setup()
    const made = await created([])
    const generate = vi.spyOn(s.images, 'generate')
    const r = await run('update_panel', { panelId: made.panelId, patch: { dialogue: [{ speakerId: 'chr_eeeeeeeeee', kind: 'speech', text: 'Hi' }] }, regenerate: true })
    expect(r).toMatchObject({ ok: false, content: 'Unknown speaker: chr_eeeeeeeeee' })
    expect(generate).not.toHaveBeenCalled()
    expect((await panel(made.panelId)).versions).toHaveLength(1)
  })

  it('reports unknown panels and bad input', async () => {
    const { run } = await setup()
    expect(await run('update_panel', { panelId: GHOST_PANEL, patch: { description: 'x' } })).toMatchObject({ ok: false, content: `Unknown panel: ${GHOST_PANEL}` })
    expect(await run('update_panel', { panelId: 'Panel 1', patch: {} })).toMatchObject({ ok: false, content: 'Unknown panel: Panel 1' })
    const r = await run('update_panel', { panelId: GHOST_PANEL, patch: { shot: 'huge' } })
    expect(r.ok).toBe(false)
    expect(r.content).toMatch(/^Invalid input for update_panel: patch\.shot: /)
  })
})

describe('regenerate_panel', () => {
  it('makes a new current version from the current fields', async () => {
    const { run, created, panel } = await setup()
    const made = await created([])
    const r = await run('regenerate_panel', { panelId: made.panelId })
    expect(r.ok).toBe(true)
    const out = json(r)
    expect(out).toMatchObject({ panelId: made.panelId, status: 'ready', error: null, check: null })
    expect(out.versionId).not.toBe(made.versionId)
    expect(r.images).toEqual([out.imagePath])
    expect((await panel(made.panelId)).currentVersionId).toBe(out.versionId)
  })

  it('keeps the previous good image current when the new one fails (Review Focus 2)', async () => {
    const { run, s, created, panel } = await setup()
    const made = await created([])
    await s.registry.assignRole('image', null)
    const r = await run('regenerate_panel', { panelId: made.panelId })
    expect(r.ok).toBe(true)
    expect(r.images).toEqual([])
    const out = json(r)
    expect(out).toMatchObject({ status: 'failed', imagePath: null })
    expect(out.error).toContain("No model assigned to role 'image'")
    const stored = await panel(made.panelId)
    expect(stored.currentVersionId).toBe(made.versionId)
    expect(stored.versions.map((v) => v.status)).toEqual(['ready', 'failed'])
  })

  it('still regenerates a panel whose character was archived afterwards (Review Focus 4)', async () => {
    const { run, s, ctx, character, created } = await setup()
    const mina = await character('Mina')
    const made = await created([mina])
    await s.characters.archive(ctx, mina.id)
    const r = await run('regenerate_panel', { panelId: made.panelId })
    expect(json(r)).toMatchObject({ status: 'ready' })
  })

  it('rejects unknown panels', async () => {
    const { run } = await setup()
    expect(await run('regenerate_panel', { panelId: GHOST_PANEL })).toMatchObject({ ok: false, content: `Unknown panel: ${GHOST_PANEL}` })
    expect(await run('regenerate_panel', { panelId: 'x' })).toMatchObject({ ok: false, content: 'Unknown panel: x' })
  })
})

describe('edit_panel_image', () => {
  it('edits the current image into a child version', async () => {
    const { run, created, panel } = await setup()
    const made = await created([])
    const r = await run('edit_panel_image', { panelId: made.panelId, instruction: 'Make the light warmer.' })
    expect(r.ok, r.content).toBe(true)
    const out = json(r)
    expect(out).toMatchObject({ panelId: made.panelId, status: 'ready', error: null })
    expect(r.images).toEqual([out.imagePath])
    const stored = await panel(made.panelId)
    expect(stored.currentVersionId).toBe(out.versionId)
    expect(stored.versions[1]).toMatchObject({ id: out.versionId, source: 'edit', instruction: 'Make the light warmer.', parentVersionId: made.versionId })
  })

  it('reports a panel with no image to edit inside the result, and a failed edit leaves the old image current', async () => {
    const { run, s, draft, created, panel } = await setup()
    await s.registry.assignRole('image', null)
    const bare = json(await run('create_panel', draft([])))
    expect(json(await run('edit_panel_image', { panelId: bare.panelId, instruction: 'Brighter' }))).toMatchObject({ status: 'failed', error: 'No ready image to edit' })

    await s.registry.assignRole('image', 'mdl_000000000b')
    const made = await created([])
    await s.registry.assignRole('image', null)
    const r = await run('edit_panel_image', { panelId: made.panelId, instruction: 'Brighter' })
    expect(r.ok).toBe(true)
    expect(json(r)).toMatchObject({ status: 'failed', imagePath: null })
    expect(r.images).toEqual([])
    expect((await panel(made.panelId)).currentVersionId).toBe(made.versionId)
  })

  it('rejects unknown panels and a blank instruction', async () => {
    const { run } = await setup()
    expect(await run('edit_panel_image', { panelId: GHOST_PANEL, instruction: 'x' })).toMatchObject({ ok: false, content: `Unknown panel: ${GHOST_PANEL}` })
    const blank = await run('edit_panel_image', { panelId: GHOST_PANEL, instruction: '' })
    expect(blank.ok).toBe(false)
    expect(blank.content).toMatch(/^Invalid input for edit_panel_image: instruction: /)
  })
})

describe('the run signal reaches every image call (Review Focus 1)', () => {
  const cases: { name: string; spy: 'generate' | 'edit'; start: (run: (n: string, i: unknown) => Promise<ToolResult>, panelId: string) => Promise<ToolResult> }[] = [
    { name: 'regenerate_panel', spy: 'generate', start: (run, panelId) => run('regenerate_panel', { panelId }) },
    { name: 'update_panel with regenerate', spy: 'generate', start: (run, panelId) => run('update_panel', { panelId, patch: { description: 'New' }, regenerate: true }) },
    { name: 'edit_panel_image', spy: 'edit', start: (run, panelId) => run('edit_panel_image', { panelId, instruction: 'Brighter' }) }
  ]
  for (const c of cases) {
    it(`${c.name}: Stop ends the generation and the version ends failed, not pending`, async () => {
      const controller = new AbortController()
      const { run, s, created, panel } = await setup({ signal: controller.signal })
      const made = await created([])
      const spy = vi.spyOn(s.images, c.spy).mockImplementation(hangOnAbort() as never)
      const pending = c.start(run, made.panelId)
      await vi.waitFor(() => expect(spy).toHaveBeenCalledTimes(1))
      expect((spy.mock.calls[0] as unknown as [unknown, { signal?: AbortSignal }])[1].signal).toBe(controller.signal)
      controller.abort()
      const r = await pending
      expect(r.ok).toBe(true)
      expect(json(r)).toMatchObject({ status: 'failed', error: 'Cancelled' })
      const stored = await panel(made.panelId)
      expect(stored.versions.some((v) => v.status === 'pending')).toBe(false)
      expect(stored.currentVersionId).toBe(made.versionId)
    })
  }
})

describe('episode tools', () => {
  it('list_episodes shows the automatic Episode 1 and its panel count', async () => {
    const { run, created, episode } = await setup()
    expect(json(await run('list_episodes', {}))).toEqual({ episodes: [{ id: episode.id, number: 1, title: 'Episode 1', synopsis: '', panelCount: 0 }] })
    await created([])
    await created([])
    expect(json(await run('list_episodes', {})).episodes[0].panelCount).toBe(2)
  })

  it('create_episode takes the next number and is then usable for panels', async () => {
    const { run, draft } = await setup()
    const r = await run('create_episode', { title: 'The Letter', synopsis: 'Mina finds a letter.' })
    expect(r.ok).toBe(true)
    const { episode } = json(r)
    expect(episode).toMatchObject({ id: expect.stringMatching(/^epi_[0-9a-f]{10}$/), number: 2, title: 'The Letter', synopsis: 'Mina finds a letter.', panelCount: 0 })
    expect(json(await run('list_episodes', {})).episodes.map((e: { number: number }) => e.number)).toEqual([1, 2])

    const panel = await run('create_panel', draft([], { episodeId: episode.id }))
    expect(panel.ok, panel.content).toBe(true)
    expect(json(await run('create_episode', { title: 'No synopsis' })).episode.synopsis).toBe('')
    expect((await run('create_episode', { title: '' })).ok).toBe(false)
  })
})
