import { afterEach, describe, expect, it } from 'vitest'
import { testServices, type TestServices } from '../../test/test-services'
import type { HandlerMap } from './projects'
import { storyHandlers } from './story'

let s: TestServices | undefined
afterEach(async () => {
  await s?.cleanup()
  s = undefined
})

async function setup() {
  s = await testServices()
  const ctx = await s.projects.create({ title: 'Moon Diary' })
  const h = storyHandlers(s) as Required<HandlerMap>
  return { services: s, ctx, projectId: ctx.id, h }
}

describe('story IPC handlers', () => {
  it('serves the story, and filters beats by episode', async () => {
    const { services, ctx, projectId, h } = await setup()
    await services.story.addBeats(ctx, 'epi_0000000001', ['a'])
    await services.story.addBeats(ctx, 'epi_0000000002', ['b'])
    const all = await h['story:get']({ projectId })
    expect(all.mode).toBe('user')
    expect(all.bible.startsWith('# Story Bible')).toBe(true)
    expect(all.beats.map((b) => b.summary)).toEqual(['a', 'b'])
    expect((await h['story:get']({ projectId, episodeId: 'epi_0000000002' })).beats.map((b) => b.summary)).toEqual(['b'])
  })

  it('sets the mode and returns the new project meta', async () => {
    const { projectId, h } = await setup()
    const meta = await h['story:setMode']({ projectId, mode: 'ai' })
    expect(meta).toMatchObject({ id: projectId, storyMode: 'ai' })
    expect((await h['story:get']({ projectId })).mode).toBe('ai')
    await expect(h['story:setMode']({ projectId, mode: 'robot' as never })).rejects.toThrow()
    expect((await h['story:get']({ projectId })).mode).toBe('ai')
  })

  it('replaces the bible with the editor text', async () => {
    const { projectId, h } = await setup()
    await h['story:updateBible']({ projectId, markdown: '# Mine\n\n## Premise\nx\n' })
    expect((await h['story:get']({ projectId })).bible).toBe('# Mine\n\n## Premise\nx\n')
    await expect(h['story:updateBible']({ projectId, markdown: 5 as never })).rejects.toThrow()
  })

  it('updates a beat from a validated patch', async () => {
    const { services, ctx, projectId, h } = await setup()
    const [beat] = await services.story.addBeats(ctx, 'epi_0000000001', ['a'])
    const updated = await h['story:updateBeat']({ projectId, beatId: beat.id, patch: { status: 'dropped' } })
    expect(updated).toMatchObject({ id: beat.id, status: 'dropped', summary: 'a' })
    await expect(h['story:updateBeat']({ projectId, beatId: beat.id, patch: { status: 'done' as never } })).rejects.toThrow()
    await expect(h['story:updateBeat']({ projectId, beatId: 'bt_ffffffffff', patch: { status: 'drawn' } })).rejects.toThrow('Unknown beat: bt_ffffffffff')
    expect((await h['story:get']({ projectId })).beats[0].status).toBe('dropped')
  })

  it('does not open a project that does not exist', async () => {
    const { h } = await setup()
    await expect(h['story:get']({ projectId: 'prj_ffffffffff' })).rejects.toThrow('Unknown project')
  })
})
