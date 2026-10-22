import fs from 'node:fs'
import { afterEach, describe, expect, it } from 'vitest'
import type { ToolResult } from '@shared/types'
import { testServices, type TestServices } from '../../test/test-services'
import { buildAgentTools } from '.'
import type { ToolContext } from './registry'

let s: TestServices | undefined
afterEach(async () => {
  await s?.cleanup()
  s = undefined
})

let n = 0
const call = (name: string, input: unknown) => ({ id: `call_${++n}`, name, input })
const json = (r: ToolResult): Record<string, any> => JSON.parse(r.content)

async function setup() {
  s = await testServices()
  const services = s
  const ctx = await services.projects.create({ title: 'Moon Diary' })
  const tools = buildAgentTools({ vision: true })
  const toolCtx: ToolContext = { project: ctx, services, signal: new AbortController().signal, threadKey: 'ses_0000000001' }
  const run = (name: string, input: unknown): Promise<ToolResult> => tools.execute(call(name, input), toolCtx)
  const [episode] = await services.episodes.list(ctx)
  const ok = async (name: string, input: unknown): Promise<Record<string, any>> => {
    const r = await run(name, input)
    expect(r.ok, r.content).toBe(true)
    return json(r)
  }
  return { services, ctx, run, ok, episode }
}

describe('story tools', () => {
  it('are the four tools before read_workflow_doc at the end of the agent tool set, with or without vision', () => {
    for (const vision of [true, false]) {
      expect(buildAgentTools({ vision }).names().slice(-5, -1)).toEqual(['get_story', 'update_story_bible', 'add_beats', 'update_beat'])
    }
  })

  it('story tools round-trip', async () => {
    const { run, ok } = await setup()
    const written = await ok('update_story_bible', { section: 'Premise', content: 'A girl who can hear the moon.' })
    expect(written.sections).toEqual(['Premise', 'World', 'Tone', 'Characters & Relationships', 'Arcs', 'Open Threads'])
    const story = await ok('get_story', {})
    expect(story.mode).toBe('user')
    expect(story.bible).toContain('## Premise\nA girl who can hear the moon.\n')
    expect(story.beats).toEqual([])

    const appended = await ok('update_story_bible', { section: 'Themes', content: 'Loneliness' })
    expect(appended.sections.at(-1)).toBe('Themes')
    expect(json(await run('get_story', {})).bible).toContain('## Themes\nLoneliness\n')
  })

  it('update_story_bible takes a section name copied with its "## " and replaces that section', async () => {
    const { ok } = await setup()
    const written = await ok('update_story_bible', { section: '## Premise', content: 'Echoed heading.' })
    expect(written.section).toBe('Premise')
    expect(written.sections).toEqual(['Premise', 'World', 'Tone', 'Characters & Relationships', 'Arcs', 'Open Threads'])
    expect((await ok('get_story', {})).bible).toContain('## Premise\nEchoed heading.\n')
  })

  it('get_story reports the story mode', async () => {
    const { services, ctx, ok } = await setup()
    await services.story.setMode(ctx, 'ai')
    expect((await ok('get_story', {})).mode).toBe('ai')
  })

  it('adds beats to an episode and walks them through draw and drop', async () => {
    const { run, ok, episode, services, ctx } = await setup()
    const added = await ok('add_beats', { episodeId: episode.id, beats: ['Mina finds the map', 'Jin follows her'] })
    expect(added.beats).toHaveLength(2)
    expect(added.beats.map((b: any) => b.status)).toEqual(['planned', 'planned'])
    expect(added.beats[0].id).toMatch(/^bt_[0-9a-f]{10}$/)

    const story = await ok('get_story', { episodeId: episode.id })
    expect(story.beats.map((b: any) => b.summary)).toEqual(['Mina finds the map', 'Jin follows her'])

    const drawn = await ok('update_beat', { beatId: added.beats[0].id, status: 'drawn' })
    expect(drawn.beat).toMatchObject({ id: added.beats[0].id, status: 'drawn', summary: 'Mina finds the map' })
    const reworded = await ok('update_beat', { beatId: added.beats[1].id, summary: 'Jin trails her', status: 'dropped' })
    expect(reworded.beat).toMatchObject({ summary: 'Jin trails her', status: 'dropped' })
    expect((await services.story.get(ctx)).beats.map((b) => b.status)).toEqual(['drawn', 'dropped'])

    // Another episode's beats stay out of an episode-scoped read.
    const second = await services.episodes.create(ctx, { title: 'Two' })
    await ok('add_beats', { episodeId: second.id, beats: ['Elsewhere'] })
    expect((await ok('get_story', { episodeId: episode.id })).beats).toHaveLength(2)
    expect((await ok('get_story', { episodeId: second.id })).beats.map((b: any) => b.summary)).toEqual(['Elsewhere'])
    expect((await ok('get_story', {})).beats).toHaveLength(3)
    expect((await run('get_story', { episodeId: 'epi_ffffffffff' })).content).toBe('Unknown episode: epi_ffffffffff')
  })

  it('answers an unknown or mangled episode id with the same "Unknown episode" message', async () => {
    const { run } = await setup()
    for (const episodeId of ['epi_ffffffffff', 'Episode 1', '../../x']) {
      const r = await run('add_beats', { episodeId, beats: ['x'] })
      expect(r).toMatchObject({ ok: false, content: `Unknown episode: ${episodeId}` })
    }
  })

  it('answers an unknown beat with "Unknown beat: <id>"', async () => {
    const { run } = await setup()
    expect(await run('update_beat', { beatId: 'bt_ffffffffff', status: 'drawn' })).toMatchObject({ ok: false, content: 'Unknown beat: bt_ffffffffff' })
  })

  it('rejects an update_beat that changes nothing, and invalid input', async () => {
    const { run, ok, episode } = await setup()
    const { beats } = await ok('add_beats', { episodeId: episode.id, beats: ['x'] })
    const nothing = await run('update_beat', { beatId: beats[0].id })
    expect(nothing.ok).toBe(false)
    expect(nothing.content).toMatch(/status or summary/)
    expect((await run('update_beat', { beatId: beats[0].id, status: 'done' })).content).toMatch(/^Invalid input for update_beat/)
    expect((await run('add_beats', { episodeId: episode.id, beats: [] })).content).toMatch(/^Invalid input for add_beats/)
    expect((await run('add_beats', { episodeId: episode.id, beats: ['   '] })).ok).toBe(false)
    expect((await run('update_story_bible', { content: 'x' })).content).toMatch(/^Invalid input for update_story_bible/)
    expect((await run('update_story_bible', { section: '', content: 'x' })).ok).toBe(false)
  })

  it('refuses bible content that would start another section, naming the fix', async () => {
    const { run, ok } = await setup()
    const r = await run('update_story_bible', { section: 'Premise', content: 'x\n## Other\ny' })
    expect(r.ok).toBe(false)
    expect(r.content).toContain('###')
    expect(json(await run('get_story', {})).bible).not.toContain('## Other')
    await ok('update_story_bible', { section: 'Premise', content: 'x\n### Other\ny' })
  })

  it('tells the model about a corrupt outline without leaking a path or touching the file', async () => {
    const { services, ctx, run, episode } = await setup()
    await services.story.get(ctx)
    fs.writeFileSync(ctx.paths.storyOutline(), '{ nope')
    const added = await run('add_beats', { episodeId: episode.id, beats: ['x'] })
    expect(added.ok).toBe(false)
    expect(added.content).toContain('story/outline.json')
    expect(added.content).not.toContain(ctx.paths.root)
    const updated = await run('update_beat', { beatId: 'bt_0000000001', status: 'drawn' })
    expect(updated.ok).toBe(false)
    expect(updated.content).toContain('story/outline.json')
    // Reading still works, with no beats, and so does the bible.
    expect(json(await run('get_story', {})).beats).toEqual([])
    expect(fs.readFileSync(ctx.paths.storyOutline(), 'utf8')).toBe('{ nope')
  })
})
