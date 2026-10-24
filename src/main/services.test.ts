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
})
