import fs from 'node:fs'
import { afterEach, describe, expect, it } from 'vitest'
import { buildStateSnapshot } from '../agent/system-prompt'
import { tempProject, type TempProject } from '../test/temp-project'
import { CorruptFileError, EntityNotFoundError } from './errors'
import { listSections } from './markdown-sections'
import { StoryService } from './story-service'

let tp: TempProject | undefined
afterEach(async () => {
  await tp?.cleanup()
  tp = undefined
})

const SECTIONS = ['Premise', 'World', 'Tone', 'Characters & Relationships', 'Arcs', 'Open Threads']
const EPISODE = 'epi_0000000001'
const OTHER_EPISODE = 'epi_0000000002'

async function setup() {
  const t = await tempProject()
  tp = t
  const svc = new StoryService({ bus: t.bus, projects: t.store })
  t.events.length = 0
  const bibleFile = t.ctx.paths.storyBible()
  const outlineFile = t.ctx.paths.storyOutline()
  const storyEvents = () => t.events.filter((e) => e.type === 'story.changed')
  return { svc, ctx: t.ctx, t, events: t.events, storyEvents, bibleFile, outlineFile }
}

describe('StoryService', () => {
  it('creates the bible template and tracks beats', async () => {
    const { svc, ctx, outlineFile } = await setup()
    const first = await svc.get(ctx)
    expect(first.mode).toBe('user')
    expect(first.beats).toEqual([])
    expect(first.bible.startsWith('# Story Bible\n')).toBe(true)
    expect(listSections(first.bible)).toEqual(SECTIONS)
    expect(first.bible).toBe('# Story Bible\n\n## Premise\n\n## World\n\n## Tone\n\n## Characters & Relationships\n\n## Arcs\n\n## Open Threads\n')
    expect(JSON.parse(fs.readFileSync(outlineFile, 'utf8'))).toEqual({ beats: [] })

    const added = await svc.addBeats(ctx, EPISODE, ['Mina finds the map', 'Jin follows her'])
    expect(added).toHaveLength(2)
    expect(added.map((b) => b.summary)).toEqual(['Mina finds the map', 'Jin follows her'])
    for (const beat of added) {
      expect(beat).toMatchObject({ episodeId: EPISODE, status: 'planned' })
      expect(beat.id).toMatch(/^bt_[0-9a-f]{10}$/)
      expect(Number.isNaN(Date.parse(beat.createdAt))).toBe(false)
    }
    expect((await svc.get(ctx)).beats).toEqual(added)

    const drawn = await svc.updateBeat(ctx, added[0].id, { status: 'drawn' })
    expect(drawn).toEqual({ ...added[0], status: 'drawn' })
    const reworded = await svc.updateBeat(ctx, added[1].id, { summary: 'Jin trails her at a distance', status: 'dropped' })
    expect(reworded).toMatchObject({ summary: 'Jin trails her at a distance', status: 'dropped' })
    expect((await svc.get(ctx)).beats.map((b) => b.status)).toEqual(['drawn', 'dropped'])
    expect(JSON.parse(fs.readFileSync(outlineFile, 'utf8')).beats).toHaveLength(2)
  })

  it('filters beats by episode and keeps the order they were added in', async () => {
    const { svc, ctx } = await setup()
    await svc.addBeats(ctx, EPISODE, ['a'])
    await svc.addBeats(ctx, OTHER_EPISODE, ['b'])
    await svc.addBeats(ctx, EPISODE, ['c'])
    expect((await svc.get(ctx)).beats.map((b) => b.summary)).toEqual(['a', 'b', 'c'])
    expect((await svc.get(ctx, EPISODE)).beats.map((b) => b.summary)).toEqual(['a', 'c'])
    expect((await svc.get(ctx, OTHER_EPISODE)).beats.map((b) => b.summary)).toEqual(['b'])
    expect((await svc.get(ctx, 'epi_ffffffffff')).beats).toEqual([])
  })

  it('does not touch a bible or outline that already exists, and strips a byte order mark', async () => {
    const { svc, ctx, bibleFile, outlineFile } = await setup()
    fs.mkdirSync(ctx.paths.resolveAsset('story'), { recursive: true })
    fs.writeFileSync(bibleFile, '﻿# My Story\n\n## Premise\nhand written\n')
    const beat = { id: 'bt_0000000001', episodeId: EPISODE, summary: 'kept', status: 'drawn', createdAt: '2026-10-21T10:00:00.000Z' }
    fs.writeFileSync(outlineFile, JSON.stringify({ beats: [beat] }))
    const got = await svc.get(ctx)
    expect(got.bible).toBe('# My Story\n\n## Premise\nhand written\n')
    expect(got.beats).toEqual([beat])
    expect(fs.readFileSync(bibleFile, 'utf8')).toBe('﻿# My Story\n\n## Premise\nhand written\n')
  })

  it('get never announces anything, not even when it creates the template', async () => {
    const { svc, ctx, events } = await setup()
    await svc.get(ctx)
    await svc.get(ctx)
    expect(events).toEqual([])
  })

  it('setMode persists, announces, and shows in get and the state snapshot', async () => {
    const { svc, ctx, t, storyEvents, events } = await setup()
    const meta = await svc.setMode(ctx, 'ai')
    expect(meta.storyMode).toBe('ai')
    expect((await t.store.getMeta(ctx)).storyMode).toBe('ai')
    expect((await svc.get(ctx)).mode).toBe('ai')
    expect(storyEvents()).toEqual([{ type: 'story.changed', projectId: ctx.id }])
    expect(events).toContainEqual({ type: 'project.changed', projectId: ctx.id })
    const snapshot = buildStateSnapshot({ meta: await t.store.getMeta(ctx), characters: [], episode: null, recentPanels: [] })
    expect(snapshot).toContain('story_mode: ai')
    await svc.setMode(ctx, 'user')
    expect((await svc.get(ctx)).mode).toBe('user')
  })

  describe('bible', () => {
    it('updates one section, leaves the rest, and announces', async () => {
      const { svc, ctx, storyEvents } = await setup()
      await svc.get(ctx)
      const bible = await svc.updateBibleSection(ctx, 'premise', 'A girl who hears the moon.')
      expect(bible).toBe('# Story Bible\n\n## Premise\nA girl who hears the moon.\n\n## World\n\n## Tone\n\n## Characters & Relationships\n\n## Arcs\n\n## Open Threads\n')
      expect((await svc.get(ctx)).bible).toBe(bible)
      expect(storyEvents()).toHaveLength(1)
      const withNew = await svc.updateBibleSection(ctx, 'Themes', 'Loneliness')
      expect(listSections(withNew)).toEqual([...SECTIONS, 'Themes'])
      expect(storyEvents()).toHaveLength(2)
    })

    it('starts from the template when a section is written before anything was read', async () => {
      const { svc, ctx } = await setup()
      const bible = await svc.updateBibleSection(ctx, 'Premise', 'Moon')
      expect(listSections(bible)).toEqual(SECTIONS)
      expect(bible).toContain('## Premise\nMoon\n')
      expect((await svc.get(ctx)).bible).toBe(bible)
    })

    it('does not announce or rewrite a section that already holds that text', async () => {
      const { svc, ctx, storyEvents, events } = await setup()
      await svc.updateBibleSection(ctx, 'Premise', 'same')
      events.length = 0
      await svc.updateBibleSection(ctx, 'Premise', 'same')
      expect(storyEvents()).toEqual([])
    })

    it('refuses section content that would open another section, and a bad section name', async () => {
      const { svc, ctx, storyEvents } = await setup()
      await svc.get(ctx)
      await expect(svc.updateBibleSection(ctx, 'Premise', 'text\n## Sneaky\nmore')).rejects.toThrow(/### /)
      await expect(svc.updateBibleSection(ctx, '   ', 'x')).rejects.toThrow(/section/i)
      await expect(svc.updateBibleSection(ctx, 'A\nB', 'x')).rejects.toThrow(/section/i)
      expect(listSections((await svc.get(ctx)).bible)).toEqual(SECTIONS)
      expect(storyEvents()).toEqual([])
      // Sub-headings are fine.
      await svc.updateBibleSection(ctx, 'Premise', 'text\n### Sub\nmore')
    })

    it('replaceBible stores the text exactly and announces', async () => {
      const { svc, ctx, bibleFile, storyEvents } = await setup()
      await svc.replaceBible(ctx, '# Mine\n\n## Premise\nx')
      expect(fs.readFileSync(bibleFile, 'utf8')).toBe('# Mine\n\n## Premise\nx')
      expect((await svc.get(ctx)).bible).toBe('# Mine\n\n## Premise\nx')
      expect(storyEvents()).toHaveLength(1)
    })

    it('two first reads create the template once and a write racing them survives', async () => {
      const { svc, ctx } = await setup()
      const [a, , c, written] = await Promise.all([svc.get(ctx), svc.get(ctx), svc.get(ctx), svc.updateBibleSection(ctx, 'Premise', 'Moon')])
      expect(listSections(written)).toEqual(SECTIONS)
      const final = (await svc.get(ctx)).bible
      expect(final).toContain('## Premise\nMoon\n')
      expect(listSections(final)).toEqual(SECTIONS)
      // A read ran before or after the write and saw a whole bible either way, never a half-created one.
      for (const read of [a, c]) expect(listSections(read.bible)).toEqual(SECTIONS)
    })

    it('concurrent section writes all land', async () => {
      const { svc, ctx } = await setup()
      await Promise.all(SECTIONS.map((name) => svc.updateBibleSection(ctx, name, `text for ${name}`)))
      const bible = (await svc.get(ctx)).bible
      for (const name of SECTIONS) expect(bible).toContain(`## ${name}\ntext for ${name}\n`)
    })
  })

  describe('beats', () => {
    it('trims summaries, rejects blank ones before writing anything, and accepts an empty list as a no-op', async () => {
      const { svc, ctx, storyEvents, events } = await setup()
      const [beat] = await svc.addBeats(ctx, EPISODE, ['  padded  '])
      expect(beat.summary).toBe('padded')
      events.length = 0
      await expect(svc.addBeats(ctx, EPISODE, ['fine', '   '])).rejects.toThrow(/empty/i)
      expect(await svc.addBeats(ctx, EPISODE, [])).toEqual([])
      expect((await svc.get(ctx)).beats).toHaveLength(1)
      expect(storyEvents()).toEqual([])
      await expect(svc.updateBeat(ctx, beat.id, { summary: ' ' })).rejects.toThrow(/empty/i)
    })

    it('rejects an unknown beat and treats an empty patch as no change', async () => {
      const { svc, ctx, storyEvents, events } = await setup()
      const [beat] = await svc.addBeats(ctx, EPISODE, ['one'])
      events.length = 0
      await expect(svc.updateBeat(ctx, 'bt_ffffffffff', { status: 'drawn' })).rejects.toBeInstanceOf(EntityNotFoundError)
      await expect(svc.updateBeat(ctx, 'bt_ffffffffff', { status: 'drawn' })).rejects.toThrow('Unknown beat: bt_ffffffffff')
      expect(await svc.updateBeat(ctx, beat.id, {})).toEqual(beat)
      expect(storyEvents()).toEqual([])
    })

    it('announces every beat mutation', async () => {
      const { svc, ctx, storyEvents } = await setup()
      const [beat] = await svc.addBeats(ctx, EPISODE, ['one'])
      await svc.updateBeat(ctx, beat.id, { status: 'drawn' })
      expect(storyEvents()).toEqual([
        { type: 'story.changed', projectId: ctx.id },
        { type: 'story.changed', projectId: ctx.id }
      ])
    })

    it('concurrent additions all land, in order', async () => {
      const { svc, ctx } = await setup()
      await Promise.all(Array.from({ length: 8 }, (_, i) => svc.addBeats(ctx, EPISODE, [`beat ${i}`])))
      const beats = (await svc.get(ctx)).beats
      expect(beats.map((b) => b.summary).sort()).toEqual(Array.from({ length: 8 }, (_, i) => `beat ${i}`).sort())
      expect(new Set(beats.map((b) => b.id)).size).toBe(8)
    })

    it('a get racing the first addBeats cannot wipe the beats', async () => {
      const { svc, ctx } = await setup()
      const [, added] = await Promise.all([svc.get(ctx), svc.addBeats(ctx, EPISODE, ['x'])])
      expect((await svc.get(ctx)).beats.map((b) => b.id)).toEqual(added.map((b) => b.id))
    })
  })

  describe('a corrupt outline', () => {
    const CORRUPT = '{ "beats": [ not json'

    async function withCorruptOutline() {
      const s = await setup()
      fs.mkdirSync(s.ctx.paths.resolveAsset('story'), { recursive: true })
      fs.writeFileSync(s.outlineFile, CORRUPT)
      return s
    }

    it('is reported once, shown as no beats, and left alone by get', async () => {
      const { svc, ctx, outlineFile } = await withCorruptOutline()
      expect((await svc.get(ctx)).beats).toEqual([])
      await svc.get(ctx)
      expect(ctx.problems.filter((p) => p.path === 'story/outline.json')).toHaveLength(1)
      expect(fs.readFileSync(outlineFile, 'utf8')).toBe(CORRUPT)
    })

    it('makes addBeats and updateBeat fail with CorruptFileError instead of replacing the user file', async () => {
      const { svc, ctx, outlineFile, storyEvents } = await withCorruptOutline()
      await expect(svc.addBeats(ctx, EPISODE, ['x'])).rejects.toBeInstanceOf(CorruptFileError)
      await expect(svc.updateBeat(ctx, 'bt_0000000001', { status: 'drawn' })).rejects.toBeInstanceOf(CorruptFileError)
      expect(fs.readFileSync(outlineFile, 'utf8')).toBe(CORRUPT)
      expect(ctx.problems.filter((p) => p.path === 'story/outline.json')).toHaveLength(1)
      expect(storyEvents()).toEqual([])
    })

    it('does not stop the bible from working', async () => {
      const { svc, ctx } = await withCorruptOutline()
      const bible = await svc.updateBibleSection(ctx, 'Premise', 'still fine')
      expect(bible).toContain('## Premise\nstill fine\n')
    })

    it('a schema mismatch is just as corrupt', async () => {
      const { svc, ctx, outlineFile } = await setup()
      fs.mkdirSync(ctx.paths.resolveAsset('story'), { recursive: true })
      fs.writeFileSync(outlineFile, JSON.stringify({ beats: [{ id: 'bt_0000000001' }] }))
      expect((await svc.get(ctx)).beats).toEqual([])
      await expect(svc.addBeats(ctx, EPISODE, ['x'])).rejects.toBeInstanceOf(CorruptFileError)
      expect(JSON.parse(fs.readFileSync(outlineFile, 'utf8'))).toEqual({ beats: [{ id: 'bt_0000000001' }] })
    })
  })
})
