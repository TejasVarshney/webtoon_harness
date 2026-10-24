import fs from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { testServices, type TestServices } from '../../test/test-services'
import { docsHandlers } from './docs'
import type { HandlerMap } from './projects'

let s: TestServices | undefined
afterEach(async () => {
  await s?.cleanup()
  s = undefined
})

async function setup(openResult = '') {
  s = await testServices()
  const ctx = await s.projects.create({ title: 'Moon Diary' })
  const opened: string[] = []
  const h = docsHandlers(s, {
    openPath: async (absPath) => {
      opened.push(absPath)
      return openResult
    }
  }) as Required<HandlerMap>
  const docFile = (...parts: string[]) => path.join(ctx.paths.agentDocsDir(), ...parts)
  return { ctx, projectId: ctx.id, h, opened, docFile }
}

describe('docs IPC handlers', () => {
  it('lists AGENTS first, then every other doc, with the titles of their first heading', async () => {
    const { projectId, h } = await setup()
    const docs = await h['docs:list']({ projectId })
    expect(docs.map((d) => d.name)).toEqual([
      'AGENTS',
      'reference/consistency-checklist',
      'reference/prompt-templates',
      'reference/webtoon-style-guide',
      'workflows/character-creation',
      'workflows/panel-editing',
      'workflows/panel-generation',
      'workflows/story-direction'
    ])
    expect(docs[0].title).toBe('Webtoon Agent')
    expect(docs.every((d) => d.title !== '' && d.title !== d.name)).toBe(true)
  })

  it('opens a doc of the project with the injected opener', async () => {
    const { projectId, h, opened, docFile } = await setup()
    await h['docs:open']({ projectId, name: 'workflows/panel-editing' })
    await h['docs:open']({ projectId, name: 'AGENTS' })
    expect(opened).toEqual([docFile('workflows', 'panel-editing.md'), docFile('AGENTS.md')])
  })

  it('opens nothing for a name that is not one of the listed docs', async () => {
    const { ctx, projectId, h, opened } = await setup()
    await fs.promises.writeFile(path.join(ctx.paths.root, 'secret.md'), 'secret')
    for (const name of ['nope', '../secret', 'workflows/../../secret', 'C:/secret']) {
      await expect(h['docs:open']({ projectId, name })).rejects.toThrow(`Unknown doc: ${name}`)
    }
    expect(opened).toEqual([])
  })

  it('reports the opener failure', async () => {
    const { projectId, h } = await setup('No application is associated with the file')
    await expect(h['docs:open']({ projectId, name: 'AGENTS' })).rejects.toThrow('Could not open AGENTS.md: No application is associated with the file')
  })

  it('reset restores edited and deleted docs to the shipped templates', async () => {
    const { projectId, h, docFile } = await setup()
    await fs.promises.writeFile(docFile('AGENTS.md'), '# Mine\n')
    await fs.promises.rm(docFile('workflows', 'panel-generation.md'))
    await h['docs:reset']({ projectId })
    const shipped = (...parts: string[]) => fs.readFileSync(path.resolve('resources', 'agent-docs', ...parts), 'utf8')
    expect(fs.readFileSync(docFile('AGENTS.md'), 'utf8')).toBe(shipped('AGENTS.md'))
    expect(fs.readFileSync(docFile('workflows', 'panel-generation.md'), 'utf8')).toBe(shipped('workflows', 'panel-generation.md'))
  })

  it('does not open a project that does not exist', async () => {
    const { h } = await setup()
    await expect(h['docs:list']({ projectId: 'prj_ffffffffff' })).rejects.toThrow('Unknown project')
  })
})
