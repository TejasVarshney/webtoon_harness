import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { Location } from '@shared/types'
import { encodeSolidPng } from '../../models/providers/png'
import { testServices, type TestServices } from '../../test/test-services'
import { locationsHandlers } from './locations'
import type { HandlerMap } from './projects'
import type { PickFiles } from './uploads'

let s: TestServices | undefined
let tmp: string | undefined
afterEach(async () => {
  await s?.cleanup()
  if (tmp) await fs.promises.rm(tmp, { recursive: true, force: true })
  s = undefined
  tmp = undefined
})

const PNG = encodeSolidPng(2, 3, [9, 9, 9])
const stockroom = { name: 'Back stockroom', layout: 'Back door at frame-left.' }

async function setup(pickFiles?: PickFiles) {
  s = await testServices()
  const ctx = await s.projects.create({ title: 'A new World' })
  // The first open runs the onOpen hooks (interrupted-generation recovery), so do it before any test data exists.
  await s.projects.open(ctx.id)
  const h: Required<HandlerMap> = locationsHandlers(s, { pickFiles }) as Required<HandlerMap>
  const services = s
  /** Fire-and-forget generation must finish before cleanup removes the project folder. */
  async function settled(id: string, stateId: string): Promise<Location> {
    const t0 = Date.now()
    for (;;) {
      const l = await services.locations.get(ctx, id)
      if (l.states.find((st) => st.id === stateId)?.status !== 'pending') return l
      if (Date.now() - t0 > 5000) throw new Error('timeout waiting for generation')
      await new Promise((r) => setTimeout(r, 40))
    }
  }
  return { ctx, h, projectId: ctx.id, settled }
}

describe('locations handlers', () => {
  it('create returns at once with a pending base, and the picture follows', async () => {
    const { h, projectId, settled } = await setup()
    const created = (await h['locations:create']({ projectId, input: stockroom, generateBase: true }, undefined as never)) as Location
    expect(created.states[0].status).toBe('pending')
    expect((await settled(created.id, created.states[0].id)).states[0].status).toBe('ready')
    expect(((await h['locations:list']({ projectId }, undefined as never)) as Location[]).map((l) => l.id)).toEqual([created.id])
  })

  it('validates its input', async () => {
    const { h, projectId } = await setup()
    await expect(h['locations:create']({ projectId, input: { name: 'No layout' } as never, generateBase: false }, undefined as never)).rejects.toThrow('Invalid input: layout:')
  })

  it('adds a state, starts its picture only when asked, and refuses to delete the base', async () => {
    const { h, projectId, settled } = await setup()
    const created = (await h['locations:create']({ projectId, input: stockroom, generateBase: true }, undefined as never)) as Location
    await settled(created.id, created.states[0].id)
    const night = (await h['locations:addState']({ projectId, locationId: created.id, input: { name: 'Night', delta: 'dark' }, generate: false }, undefined as never)) as Location['states'][number]
    expect(night.status).toBe('failed')
    const started = (await h['locations:generateState']({ projectId, locationId: created.id, stateId: night.id }, undefined as never)) as Location['states'][number]
    expect(started.status).toBe('pending')
    // The state was failed (no picture yet) before the background draw marked it pending, so wait for the picture itself.
    const t0 = Date.now()
    while ((await s!.locations.get(await s!.projects.open(projectId), created.id)).states[1].status !== 'ready') {
      if (Date.now() - t0 > 5000) throw new Error('timeout waiting for the state picture')
      await new Promise((r) => setTimeout(r, 40))
    }
    await expect(h['locations:deleteState']({ projectId, locationId: created.id, stateId: created.states[0].id }, undefined as never)).rejects.toThrow('The base state cannot be deleted')
  })

  it('uploads the chosen picture, and a cancelled dialog changes nothing', async () => {
    tmp = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'loc-upload-'))
    const file = path.join(tmp, 'room.png')
    await fs.promises.writeFile(file, PNG)
    let chosen: string[] = []
    const { h, projectId } = await setup(async () => chosen)
    const created = (await h['locations:create']({ projectId, input: stockroom, generateBase: false }, undefined as never)) as Location
    const req = { projectId, locationId: created.id, stateId: created.states[0].id }
    expect(await h['locations:uploadStateImage'](req, undefined as never)).toBeNull()
    chosen = [file]
    expect(await h['locations:uploadStateImage'](req, undefined as never)).toMatchObject({ status: 'ready', check: null })
  })
})
