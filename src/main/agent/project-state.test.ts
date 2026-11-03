import { afterEach, describe, expect, it } from 'vitest'
import { testServices, type TestServices } from '../test/test-services'
import { projectStateText } from './project-state'

let s: TestServices | undefined
afterEach(async () => {
  await s?.cleanup()
  s = undefined
})

async function setup() {
  s = await testServices()
  const ctx = await s.projects.create({ title: 'Moon Diary' })
  await s.characters.create(ctx, { name: 'Mina', role: 'protagonist', appearanceLock: 'LOCK' }, 'user')
  const first = await s.episodes.create(ctx, { title: 'Pilot' })
  const second = await s.episodes.create(ctx, { title: 'Finale' })
  return { s, ctx, first, second }
}

describe('projectStateText', () => {
  it('lists the project, its characters and the first episode when no episode is active', async () => {
    const { s, ctx, first } = await setup()
    const text = await projectStateText(s, ctx, null)
    expect(text).toContain('<project_state>')
    expect(text).toContain('Mina')
    expect(text).toContain(`current_episode: ${first.id} "Pilot"`)
  })

  it('falls back to the first episode when the active id no longer exists', async () => {
    const { s, ctx, first } = await setup()
    expect(await projectStateText(s, ctx, 'ep_gone')).toContain(`current_episode: ${first.id} "Pilot"`)
  })

  it('uses the named episode when it exists', async () => {
    const { s, ctx, second } = await setup()
    expect(await projectStateText(s, ctx, second.id)).toContain(`current_episode: ${second.id} "Finale"`)
  })
})
