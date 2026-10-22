import fs from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Panel, PanelDraft, ToolResult } from '@shared/types'
import type { ProjectContext } from '../../storage/project-store'
import { testServices, type TestServices } from '../../test/test-services'
import { buildPanelChatTools } from './panel-chat-tools'
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
const GHOST_VERSION = 'ver_ffffffffff'
const IMAGE_MODEL = 'mdl_000000000b'

/** An image call that never answers on its own and rejects the way a provider does when its signal fires. */
function hangOnAbort(): (_ctx: ProjectContext, req: { signal?: AbortSignal }) => Promise<never> {
  return (_ctx, req) =>
    new Promise((_resolve, reject) => {
      req.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })))
    })
}

/** Three panels in one episode (p1, p2, p3), each with one ready image; the tools are bound to p2 unless said otherwise. */
async function setup(opts: { signal?: AbortSignal; vision?: boolean; realTrash?: boolean } = {}) {
  s = await testServices(opts.realTrash ? { trash: (p) => fs.promises.rm(p, { recursive: true, force: true }) } : {})
  const services = s
  const ctx = await services.projects.create({ title: 'Moon Diary' })
  const [episode] = await services.episodes.list(ctx)
  const made = await services.characters.create(ctx, { name: 'Mina', role: 'protagonist', appearanceLock: 'Mina LOCK' }, 'user')
  await services.characters.generateVariationImage(ctx, made.id, made.variations[0].id)
  const mina = await services.characters.get(ctx, made.id)
  const cast = [{ characterId: mina.id, variationId: mina.variations[0].id, action: '', expression: '', position: 'center' as const }]
  const draft = (description: string, o: Partial<PanelDraft> = {}): PanelDraft => ({ episodeId: episode.id, description, setting: 'Hall', shot: 'medium', characters: cast, dialogue: [], ...o })

  async function drawn(description: string, o: Partial<PanelDraft> = {}): Promise<Panel> {
    const { panel } = await services.panels.create(ctx, draft(description, o), { createdBy: 'ai', strictMentions: true })
    await services.panels.generate(ctx, panel.id)
    return services.panels.get(ctx, panel.id)
  }
  const p1 = await drawn('Mina waits.')
  const p2 = await drawn('Mina opens the door.')
  const p3 = await drawn('Mina steps outside.')

  const signal = opts.signal ?? new AbortController().signal
  const tools = (panelId = p2.id, vision = opts.vision ?? true) => buildPanelChatTools(panelId, { vision })
  const toolCtx: ToolContext = { project: ctx, services, signal, threadKey: `panel:${p2.id}` }
  const run = (name: string, input: unknown = {}, panelId = p2.id): Promise<ToolResult> => tools(panelId).execute(call(name, input), toolCtx)
  const panel = (id: string): Promise<Panel> => services.panels.get(ctx, id)
  return { s: services, ctx, episode, mina, cast, draft, drawn, p1, p2, p3, tools, toolCtx, run, panel }
}

describe('panel chat tools: the tool set', () => {
  it('offers exactly the six panel-scoped tools, view_current_image only with vision', () => {
    // A dummy id is fine: building the registry does no I/O.
    expect(buildPanelChatTools('pnl_0000000000', { vision: true }).names()).toEqual([
      'get_panel_context',
      'view_current_image',
      'update_panel_fields',
      'regenerate_image',
      'edit_image',
      'revert_to_version'
    ])
    expect(buildPanelChatTools('pnl_0000000000', { vision: false }).names()).toEqual(['get_panel_context', 'update_panel_fields', 'regenerate_image', 'edit_image', 'revert_to_version'])
  })

  it('takes no panel id in any input, and describes the inputs the model has to fill in', () => {
    const specs = buildPanelChatTools('pnl_0000000000', { vision: true }).specs()
    for (const spec of specs) {
      expect(spec.inputSchema, spec.name).not.toHaveProperty('properties.panelId')
      expect(spec.description.length, spec.name).toBeGreaterThan(20)
    }
    const schema = (name: string) => specs.find((t) => t.name === name)!.inputSchema as { required?: string[]; properties: Record<string, any> }
    expect(schema('edit_image').required).toEqual(['instruction'])
    expect(schema('revert_to_version').required).toEqual(['versionId'])
    expect(schema('update_panel_fields').required ?? []).toEqual([])
    expect(Object.keys(schema('update_panel_fields').properties)).toEqual(
      expect.arrayContaining(['description', 'setting', 'shot', 'aspect', 'characters', 'dialogue', 'continuityNotes', 'offPanelMentions'])
    )
    expect(schema('update_panel_fields').properties.shot.enum).toContain('close-up')
    for (const field of ['description', 'setting', 'characters', 'dialogue', 'continuityNotes', 'offPanelMentions']) {
      expect(schema('update_panel_fields').properties[field].description, field).toEqual(expect.any(String))
    }
    expect(schema('get_panel_context').properties ?? {}).toEqual({})
  })
})

describe('edit_image and regenerate_image', () => {
  it('edit_image acts only on the bound panel', async () => {
    const { run, s, ctx, p1, p2, tools, toolCtx } = await setup()
    const reg = tools(p2.id, false)
    const r = await reg.execute(call('edit_image', { instruction: 'make her smile' }), toolCtx)
    expect(JSON.parse(r.content)).toMatchObject({ label: 'v2', status: 'ready' })
    expect((await s.panels.get(ctx, p2.id)).versions).toHaveLength(2)
    expect((await s.panels.get(ctx, p1.id)).versions).toHaveLength(1)
    expect(reg.specs().find((spec) => spec.name === 'edit_image')!.inputSchema).not.toHaveProperty('properties.panelId')
    // A panel id smuggled into the input is not part of the schema, so it cannot redirect the call.
    const sneaky = await run('edit_image', { instruction: 'again', panelId: p1.id })
    expect(sneaky.ok, sneaky.content).toBe(true)
    expect((await s.panels.get(ctx, p1.id)).versions).toHaveLength(1)
    expect((await s.panels.get(ctx, p2.id)).versions).toHaveLength(3)
  })

  it('returns the version, its label, the status, the error and the image path, with the image attached', async () => {
    const { run, p2, panel } = await setup()
    const r = await run('edit_image', { instruction: 'make her smile' })
    expect(r.ok, r.content).toBe(true)
    const out = json(r)
    const stored = await panel(p2.id)
    expect(out).toEqual({ versionId: stored.currentVersionId, label: 'v2', status: 'ready', error: null, imagePath: stored.versions[1].imagePath })
    expect(out.imagePath).toMatch(/^panels\/pnl_[0-9a-f]{10}\/ver_[0-9a-f]{10}\.png$/)
    expect(r.images).toEqual([out.imagePath])
    expect(stored.versions[1]).toMatchObject({ source: 'edit', instruction: 'make her smile', parentVersionId: p2.currentVersionId })
  })

  it('regenerate_image draws the panel again from its current fields as a new current version', async () => {
    const { run, s, p1, p2, panel } = await setup()
    const generate = vi.spyOn(s.images, 'generate')
    const r = await run('regenerate_image')
    expect(r.ok, r.content).toBe(true)
    const out = json(r)
    expect(out).toMatchObject({ label: 'v2', status: 'ready', error: null })
    expect(Object.keys(out).sort()).toEqual(['error', 'imagePath', 'label', 'status', 'versionId'])
    expect(r.images).toEqual([out.imagePath])
    expect(generate).toHaveBeenCalledTimes(1)
    const stored = await panel(p2.id)
    expect(stored).toMatchObject({ currentVersionId: out.versionId })
    expect(stored.versions).toHaveLength(2)
    expect((await panel(p1.id)).versions).toHaveLength(1)
  })

  it('counts ready versions only (Ruling P7): a failed attempt has no label and the next ready one takes the next number', async () => {
    const { run, s, p2, panel } = await setup()
    await s.registry.assignRole('image', null)
    const failed = await run('edit_image', { instruction: 'make her smile' })
    expect(failed.ok).toBe(true)
    const out = json(failed)
    expect(out).toMatchObject({ label: null, status: 'failed', imagePath: null })
    // An edit runs on the imageEdit role, which falls back to the image role.
    expect(out.error).toContain("No model assigned to role 'imageEdit'")
    expect(failed.images).toEqual([])
    // Review Focus 2: the image that was good stays current.
    const after = await panel(p2.id)
    expect(after.currentVersionId).toBe(p2.currentVersionId)
    expect(after.versions).toMatchObject([{ status: 'ready' }, { id: out.versionId, status: 'failed' }])

    await s.registry.assignRole('image', IMAGE_MODEL)
    const retried = await run('edit_image', { instruction: 'make her smile' })
    expect(json(retried)).toMatchObject({ label: 'v2', status: 'ready' })
    expect((await panel(p2.id)).versions).toHaveLength(3)
  })

  it('reports a failed regeneration as a result, not an error', async () => {
    const { run, s, p2, panel } = await setup()
    await s.registry.assignRole('image', null)
    const r = await run('regenerate_image')
    expect(r.ok).toBe(true)
    expect(json(r)).toMatchObject({ label: null, status: 'failed' })
    expect((await panel(p2.id)).currentVersionId).toBe(p2.currentVersionId)
  })

  it('passes the run signal to the image call, so Stop ends an edit that is under way (Review Focus 1 and 2)', async () => {
    const controller = new AbortController()
    const { run, s, p2, panel } = await setup({ signal: controller.signal })
    const edit = vi.spyOn(s.images, 'edit').mockImplementation(hangOnAbort())
    const pending = run('edit_image', { instruction: 'make her smile' })
    await vi.waitFor(() => expect(edit).toHaveBeenCalledTimes(1))
    expect(edit.mock.calls[0][1].signal).toBe(controller.signal)
    controller.abort()
    const r = await pending
    expect(r.ok).toBe(true)
    expect(json(r)).toMatchObject({ label: null, status: 'failed', error: 'Cancelled', imagePath: null })
    const stored = await panel(p2.id)
    expect(stored.currentVersionId).toBe(p2.currentVersionId)
    expect(stored.versions[1]).toMatchObject({ status: 'failed', error: 'Cancelled' })
  })

  it('edit_image needs an instruction', async () => {
    const { run } = await setup()
    expect(await run('edit_image', { instruction: '' })).toMatchObject({ ok: false })
    expect(await run('edit_image', {})).toMatchObject({ ok: false })
  })
})

describe('revert_to_version', () => {
  it('makes an earlier ready version current and returns it with its label and image', async () => {
    const { run, p2, panel } = await setup()
    await run('edit_image', { instruction: 'make her smile' })
    const first = p2.versions[0]
    const r = await run('revert_to_version', { versionId: first.id })
    expect(r.ok, r.content).toBe(true)
    expect(json(r)).toEqual({ versionId: first.id, label: 'v1', status: 'ready', error: null, imagePath: first.imagePath })
    expect(r.images).toEqual([first.imagePath])
    const stored = await panel(p2.id)
    expect(stored.currentVersionId).toBe(first.id)
    expect(stored.versions).toHaveLength(2) // nothing is deleted
  })

  it('revert_to_version rejects unknown versions', async () => {
    const { run, p1, p2, panel } = await setup()
    const r = await run('revert_to_version', { versionId: GHOST_VERSION })
    expect(r.ok).toBe(false)
    expect(r.content).toContain('Unknown version')
    // A version of another panel is unknown to this panel's chat.
    const foreign = await run('revert_to_version', { versionId: p1.versions[0].id })
    expect(foreign).toMatchObject({ ok: false })
    expect(foreign.content).toContain('Unknown version')
    expect((await panel(p2.id)).currentVersionId).toBe(p2.currentVersionId)
  })

  it('refuses a version that is not ready, and says why', async () => {
    const { run, s, p2, panel } = await setup()
    await s.registry.assignRole('image', null)
    const failedId = json(await run('regenerate_image')).versionId
    const r = await run('revert_to_version', { versionId: failedId })
    expect(r.ok).toBe(false)
    expect(r.content).toContain(failedId)
    expect(r.content).toContain('failed')
    expect((await panel(p2.id)).currentVersionId).toBe(p2.currentVersionId)
  })
})

describe('update_panel_fields', () => {
  it('changes only the named fields of the bound panel and never touches an image', async () => {
    const { run, s, p1, p2, panel } = await setup()
    const generate = vi.spyOn(s.images, 'generate')
    const edit = vi.spyOn(s.images, 'edit')
    const r = await run('update_panel_fields', { description: 'Mina steps out.', shot: 'wide', panelId: p1.id })
    expect(r.ok, r.content).toBe(true)
    expect(json(r)).toMatchObject({ updated: ['description', 'shot'], warnings: [], fields: { description: 'Mina steps out.', shot: 'wide', setting: 'Hall' } })
    expect(r.images).toEqual([])
    expect(generate).not.toHaveBeenCalled()
    expect(edit).not.toHaveBeenCalled()
    expect(await panel(p2.id)).toMatchObject({ description: 'Mina steps out.', shot: 'wide', setting: 'Hall', currentVersionId: p2.currentVersionId })
    expect((await panel(p2.id)).versions).toHaveLength(1)
    expect(await panel(p1.id)).toMatchObject({ description: 'Mina waits.', shot: 'medium' })
  })

  it('replaces the dialogue and gives the new lines ids', async () => {
    const { run, mina, p2, panel } = await setup()
    const r = await run('update_panel_fields', {
      dialogue: [
        { speakerId: mina.id, kind: 'speech', text: 'Hello?' },
        { speakerId: null, kind: 'narration', text: 'Silence.' }
      ]
    })
    expect(r.ok, r.content).toBe(true)
    const stored = await panel(p2.id)
    expect(stored.dialogue).toMatchObject([
      { speakerId: mina.id, kind: 'speech', text: 'Hello?' },
      { speakerId: null, kind: 'narration', text: 'Silence.' }
    ])
    expect(stored.dialogue[0].id).toMatch(/^dlg_[0-9a-f]{10}$/)
    expect(stored.versions).toHaveLength(1)
  })

  it('joins every validation issue with newlines and writes nothing', async () => {
    const { run, p2, panel } = await setup()
    const r = await run('update_panel_fields', {
      description: 'The hallway is empty.',
      characters: [{ characterId: 'chr_ffffffffff', variationId: 'var_ffffffffff' }],
      dialogue: [{ speakerId: 'chr_eeeeeeeeee', kind: 'speech', text: 'Hi' }]
    })
    expect(r).toMatchObject({ ok: false, content: 'Unknown character: chr_ffffffffff\nUnknown speaker: chr_eeeeeeeeee' })
    expect(await panel(p2.id)).toMatchObject({ description: 'Mina opens the door.', characters: p2.characters, dialogue: [] })
  })

  it('applies the mention guard to the description (strictMentions)', async () => {
    const { run, s, ctx, p2, panel } = await setup()
    const jin = await s.characters.create(ctx, { name: 'Jin', role: 'supporting', appearanceLock: 'Jin LOCK' }, 'user')
    await s.characters.generateVariationImage(ctx, jin.id, jin.variations[0].id)
    const rejected = await run('update_panel_fields', { description: 'Mina meets Jin.' })
    expect(rejected.ok).toBe(false)
    expect(rejected.content).toContain('Mentioned but not attached: Jin')
    expect((await panel(p2.id)).description).toBe('Mina opens the door.')

    const ok = await run('update_panel_fields', { description: 'Mina meets Jin.', offPanelMentions: ['Jin'] })
    expect(ok.ok, ok.content).toBe(true)
    expect(json(ok).warnings).toEqual([])
  })

  // Ruling T21b (same as T19a for the main agent): the mention guard is strict only when the description changes.
  describe('a panel saved with an unattached-mention warning (Ruling T21b)', () => {
    async function warned() {
      const h = await setup()
      const jin = await h.s.characters.create(h.ctx, { name: 'Jin', role: 'supporting', appearanceLock: 'Jin LOCK' }, 'user')
      await h.s.characters.generateVariationImage(h.ctx, jin.id, jin.variations[0].id)
      const { panel, warnings } = await h.s.panels.create(h.ctx, h.draft('Mina waits while Jin watches.'), { createdBy: 'user', strictMentions: false })
      expect(warnings).toHaveLength(1)
      return { ...h, id: panel.id }
    }

    it('still accepts an edit that does not touch the description, and passes the warning on', async () => {
      const { run, mina, id, panel } = await warned()
      const r = await run('update_panel_fields', { dialogue: [{ speakerId: mina.id, kind: 'speech', text: 'Hello?' }] }, id)
      expect(r.ok, r.content).toBe(true)
      const out = json(r)
      expect(out.updated).toEqual(['dialogue'])
      expect(out.warnings).toEqual([expect.stringContaining('Mentioned but not attached: Jin')])
      expect(out.fields.dialogue).toMatchObject([{ speakerId: mina.id, text: 'Hello?' }])
      expect((await panel(id)).dialogue).toMatchObject([{ text: 'Hello?' }])
    })

    it('accepts a change of shot or setting the same way', async () => {
      const { run, id, panel } = await warned()
      const r = await run('update_panel_fields', { shot: 'wide', setting: 'Rooftop' }, id)
      expect(r.ok, r.content).toBe(true)
      expect(json(r).warnings).toHaveLength(1)
      expect(await panel(id)).toMatchObject({ shot: 'wide', setting: 'Rooftop' })
    })

    it('rejects a description edit that leaves the character unattached', async () => {
      const { run, id, panel } = await warned()
      const r = await run('update_panel_fields', { description: 'Mina waits while Jin watches from the stairs.' }, id)
      expect(r.ok).toBe(false)
      expect(r.content).toContain('Mentioned but not attached: Jin')
      expect((await panel(id)).description).toBe('Mina waits while Jin watches.')
    })

    it('accepts a description edit once the mention is listed as off-panel', async () => {
      const { run, id } = await warned()
      const r = await run('update_panel_fields', { description: 'Mina waits while Jin watches from the stairs.', offPanelMentions: ['Jin'] }, id)
      expect(r.ok, r.content).toBe(true)
      expect(json(r).warnings).toEqual([])
    })
  })
})

describe('view_current_image', () => {
  it('returns the current image for the model to look at', async () => {
    const { run, p2 } = await setup()
    const r = await run('view_current_image')
    expect(r.ok, r.content).toBe(true)
    expect(json(r)).toEqual({ versionId: p2.currentVersionId, label: 'v1', imagePath: p2.versions[0].imagePath })
    expect(r.images).toEqual([p2.versions[0].imagePath])
  })

  it('shows the image that is current after a revert', async () => {
    const { run, p2 } = await setup()
    await run('edit_image', { instruction: 'make her smile' })
    await run('revert_to_version', { versionId: p2.versions[0].id })
    expect(json(await run('view_current_image'))).toMatchObject({ versionId: p2.versions[0].id, label: 'v1' })
  })

  it('says so when the panel has no ready image', async () => {
    const { run, s, ctx, draft } = await setup()
    const { panel: bare } = await s.panels.create(ctx, draft('Nothing drawn yet.'), { createdBy: 'ai', strictMentions: true })
    expect(await run('view_current_image', {}, bare.id)).toMatchObject({ ok: false, content: 'This panel has no ready image', images: [] })
  })
})

describe('get_panel_context', () => {
  it('describes the bound panel: fields, cast with variation names, versions, and its neighbors', async () => {
    const { run, s, mina, p1, p2, p3, panel } = await setup()
    await run('edit_image', { instruction: 'make her smile' })
    await s.registry.assignRole('image', null)
    await run('regenerate_image') // a failed attempt in the history
    const stored = await panel(p2.id)

    const r = await run('get_panel_context')
    expect(r.ok, r.content).toBe(true)
    expect(r.images).toEqual([])
    const out = json(r)
    expect(out).toMatchObject({
      panelId: p2.id,
      episodeId: p2.episodeId,
      shot: 'medium',
      aspect: '2:3',
      setting: 'Hall',
      description: 'Mina opens the door.',
      continuityNotes: '',
      offPanelMentions: [],
      dialogue: [],
      currentVersionId: stored.versions[1].id
    })
    expect(out.cast).toEqual([
      { characterId: mina.id, name: 'Mina', variationId: mina.variations[0].id, variationName: 'Base', action: '', expression: '', position: 'center' }
    ])
    expect(out.versions).toEqual([
      { id: stored.versions[0].id, label: 'v1', status: 'ready', source: 'generate' },
      { id: stored.versions[1].id, label: 'v2', status: 'ready', source: 'edit' },
      { id: stored.versions[2].id, label: null, status: 'failed', source: 'generate' }
    ])
    expect(out.previous).toMatchObject({ id: p1.id, shot: 'medium', description: 'Mina waits.', cast: [{ name: 'Mina', variationName: 'Base' }] })
    expect(out.next).toMatchObject({ id: p3.id, description: 'Mina steps outside.' })
  })

  it('has no previous panel for the first one and no next panel for the last', async () => {
    const { run, p1, p3 } = await setup()
    expect(json(await run('get_panel_context', {}, p1.id))).toMatchObject({ previous: null, next: { id: expect.any(String) } })
    expect(json(await run('get_panel_context', {}, p3.id))).toMatchObject({ previous: { id: expect.any(String) }, next: null })
  })

  it('names the speakers of the dialogue, archived characters included', async () => {
    const { run, s, ctx, mina, p2 } = await setup()
    await s.panels.update(ctx, p2.id, { dialogue: [{ speakerId: mina.id, kind: 'speech', text: 'Hi' }, { speakerId: null, kind: 'sfx', text: 'Click' }] }, { strictMentions: true })
    await s.characters.archive(ctx, mina.id)
    const out = json(await run('get_panel_context'))
    expect(out.dialogue).toMatchObject([
      { speakerId: mina.id, speaker: 'Mina', kind: 'speech', text: 'Hi' },
      { speakerId: null, speaker: null, kind: 'sfx', text: 'Click' }
    ])
    expect(out.cast[0]).toMatchObject({ name: 'Mina' })
  })
})

describe('a panel that is gone', () => {
  it('reports it as unknown from every tool, and draws nothing', async () => {
    const { run, s, ctx, p2 } = await setup({ realTrash: true })
    await s.panels.delete(ctx, p2.id)
    const generate = vi.spyOn(s.images, 'generate')
    const edit = vi.spyOn(s.images, 'edit')
    for (const [name, input] of [
      ['get_panel_context', {}],
      ['view_current_image', {}],
      ['update_panel_fields', { description: 'x' }],
      ['regenerate_image', {}],
      ['edit_image', { instruction: 'x' }],
      ['revert_to_version', { versionId: GHOST_VERSION }]
    ] as const) {
      expect(await run(name, input), name).toMatchObject({ ok: false, content: `Unknown panel: ${p2.id}` })
    }
    expect(generate).not.toHaveBeenCalled()
    expect(edit).not.toHaveBeenCalled()
  })
})
