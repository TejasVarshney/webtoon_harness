import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { EntityNotFoundError } from '../domain/errors'
import { tempProject, type TempProject } from '../test/temp-project'
import { WorkflowDocs } from './workflow-docs'

let tp: TempProject | undefined
let tmpl: string | undefined
afterEach(async () => {
  await tp?.cleanup()
  if (tmpl) await fs.promises.rm(tmpl, { recursive: true, force: true })
  tp = undefined
  tmpl = undefined
})

async function templates(): Promise<string> {
  tmpl = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'webtoon templates '))
  await fs.promises.mkdir(path.join(tmpl, 'workflows'))
  await fs.promises.writeFile(path.join(tmpl, 'AGENTS.md'), '# Webtoon Agent\n\n## Mission\nDraw.\n')
  await fs.promises.writeFile(path.join(tmpl, 'workflows', 'a.md'), 'intro\n# A\n\nbody\n')
  return tmpl
}

describe('WorkflowDocs', () => {
  it('installs missing docs only and lists them', async () => {
    tp = await tempProject()
    const docs = new WorkflowDocs(await templates())
    const agentFile = path.join(tp.ctx.paths.agentDocsDir(), 'AGENTS.md')
    await fs.promises.writeFile(agentFile, '# My edit\n')
    await docs.install(tp.ctx)
    expect(await docs.agentsMd(tp.ctx)).toBe('# My edit\n')
    expect(await docs.list(tp.ctx)).toEqual([{ name: 'workflows/a', title: 'A' }])
    expect(await docs.read(tp.ctx, 'workflows/a')).toContain('body')
  })

  it('reset overwrites edited files', async () => {
    tp = await tempProject()
    const docs = new WorkflowDocs(await templates())
    await docs.install(tp.ctx)
    await fs.promises.writeFile(path.join(tp.ctx.paths.agentDocsDir(), 'AGENTS.md'), 'edited')
    await docs.reset(tp.ctx)
    expect(await docs.agentsMd(tp.ctx)).toContain('# Webtoon Agent')
  })

  it('blocks traversal and reports unknown docs', async () => {
    tp = await tempProject()
    const docs = new WorkflowDocs(await templates())
    await docs.install(tp.ctx)
    await fs.promises.writeFile(path.join(tp.ctx.paths.root, 'x.md'), 'secret')
    await expect(docs.read(tp.ctx, '../x')).rejects.toThrow()
    await expect(docs.read(tp.ctx, 'nope')).rejects.toBeInstanceOf(EntityNotFoundError)
  })

  it('lists nothing before install', async () => {
    tp = await tempProject()
    const docs = new WorkflowDocs(await templates())
    expect(await docs.list(tp.ctx)).toEqual([])
  })
})
