import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { testServices, type TestServices } from '../../test/test-services'
import { uploadsHandlers } from './uploads'

let services: TestServices | undefined
let tmp: string | undefined
afterEach(async () => {
  await services?.cleanup()
  if (tmp) await fs.promises.rm(tmp, { recursive: true, force: true })
  services = undefined
  tmp = undefined
})

describe('uploads:pickImages', () => {
  it('copies picked images into uploads/ and returns project-relative POSIX paths', async () => {
    services = await testServices()
    tmp = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'pick src '))
    const png = path.join(tmp, 'My Photo.PNG')
    const jpeg = path.join(tmp, 'b.jpeg')
    const txt = path.join(tmp, 'notes.txt')
    await fs.promises.writeFile(png, Buffer.from([1, 2, 3]))
    await fs.promises.writeFile(jpeg, Buffer.from([4, 5]))
    await fs.promises.writeFile(txt, 'x')
    const ctx = await services.projects.create({ title: 'P' })

    const h = uploadsHandlers(services, { pickFiles: async () => [png, jpeg, txt] })
    const { paths } = await h['uploads:pickImages']!({ projectId: ctx.id })

    expect(paths).toHaveLength(2)
    expect(paths[0]).toMatch(/^uploads\/upl_[0-9a-f]{10}\.png$/)
    expect(paths[1]).toMatch(/^uploads\/upl_[0-9a-f]{10}\.jpg$/)
    expect([...fs.readFileSync(ctx.paths.resolveAsset(paths[0]))]).toEqual([1, 2, 3])
    expect([...fs.readFileSync(ctx.paths.resolveAsset(paths[1]))]).toEqual([4, 5])
  })

  it('returns no paths when the dialog is cancelled', async () => {
    services = await testServices()
    const { id } = await services.projects.create({ title: 'P' })
    const h = uploadsHandlers(services, { pickFiles: async () => [] })
    expect(await h['uploads:pickImages']!({ projectId: id })).toEqual({ paths: [] })
  })
})
