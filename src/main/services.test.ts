import fs from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { testServices, type TestServices } from './test/test-services'

let s: TestServices | undefined
afterEach(async () => {
  await s?.cleanup()
  s = undefined
})

describe('createServices', () => {
  it('fails at startup when the workflow doc templates are missing', async () => {
    await expect(testServices({ templatesDir: path.join('no', 'such', 'dir') })).rejects.toThrow(/Workflow doc templates not found at/)
  })

  it('installs the agent docs on project creation', async () => {
    s = await testServices()
    const ctx = await s.projects.create({ title: 'P' })
    expect(fs.existsSync(path.join(ctx.paths.agentDocsDir(), 'AGENTS.md'))).toBe(true)
    expect(await s.docs.agentsMd(ctx)).toContain('R12 Stop when blocked')
  })

  it('is wired: services.items exists and recovers on project open', async () => {
    s = await testServices()
    let s2: TestServices | undefined
    try {
      const ctx = await s.projects.create({ title: 'P' })
      const item = await s.items.create(ctx, { name: 'Kestrel blaster', appearanceLock: 'LOCK' }, 'user')
      s2 = await testServices({ projectsRoot: s.projectsRoot })
      const reopened = await s2.projects.open(ctx.id)
      expect((await s2.items.get(reopened, item.id)).usages[0]).toMatchObject({ status: 'failed', error: 'Interrupted: the app closed during generation' })
    } finally {
      await s2?.cleanup()
    }
  })
})
