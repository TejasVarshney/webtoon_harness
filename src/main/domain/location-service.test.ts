import fs from 'node:fs'
import { afterEach, describe, expect, it } from 'vitest'
import { ProviderError } from '../models/providers/types'
import { encodeSolidPng } from '../models/providers/png'
import { tempProject, type TempProject } from '../test/temp-project'
import type { ImageGenRequest, ImageService } from './image-service'
import { DuplicateLocationError, DuplicateStateError, LocationInUseError, LocationService, type LocationUsageLookup } from './location-service'
import { locationReferencePrompt, locationStatePrompt, sheetFixInstruction } from './prompts'
import type { CheckResult } from '@shared/types'
import type { SheetCheckInput } from './consistency-checker'
import { INTERRUPTED } from './records'

// The twin of item-service.test.ts for what locations do differently; the shared locking and recording rules are
// covered there.

const LAYOUT = 'Camera faces the back wall. Back door at frame-left; shelves at frame-right.'
const input = (name = 'Back stockroom') => ({ name, layout: LAYOUT })
const PNG = encodeSolidPng(2, 3, [1, 2, 3])

let tp: TempProject | undefined
afterEach(async () => {
  await tp?.cleanup()
  tp = undefined
})

type Gen = (req: ImageGenRequest) => Promise<{ data: Buffer; ext: 'png' | 'jpg' | 'webp' }>

async function setup(opts: { gen?: Gen; used?: string[]; replies?: (CheckResult | null)[] } = {}) {
  const t = await tempProject()
  tp = t
  const calls: ImageGenRequest[] = []
  const gen = opts.gen ?? (async () => ({ data: PNG, ext: 'png' as const }))
  const images = {
    generate: (_c: unknown, req: ImageGenRequest) => {
      calls.push(req)
      return gen(req)
    }
  } as unknown as ImageService
  const used = opts.used ?? []
  const usage: LocationUsageLookup = { panelsUsingLocation: async () => used, panelsUsingLocationState: async () => used }
  const checks: SheetCheckInput[] = []
  const replies = opts.replies
  const sheetChecker = replies && {
    checkSheet: async (_c: unknown, req: SheetCheckInput) => {
      checks.push(req)
      return replies[Math.min(checks.length - 1, replies.length - 1)]
    }
  }
  const trashed: string[] = []
  const svc = new LocationService({ bus: t.bus, images, projects: t.store, usage, trash: async (p) => void trashed.push(p), sheetChecker })
  return { svc, calls, checks, trashed, ctx: t.ctx, events: t.events, store: t.store }
}

describe('LocationService', () => {
  it('creates a location with a pending Default state and draws it from the layout alone, as a landscape', async () => {
    const { svc, calls, ctx, events, store } = await setup()
    events.length = 0
    const location = await svc.create(ctx, input(), 'user')
    expect(location.id).toMatch(/^loc_[0-9a-f]{10}$/)
    expect(location.states).toMatchObject([{ kind: 'base', name: 'Default', delta: '', status: 'pending', imagePath: null, locationId: location.id }])
    expect(location.states[0].id).toMatch(/^lst_[0-9a-f]{10}$/)
    expect(events).toContainEqual({ type: 'location.changed', projectId: ctx.id, locationId: location.id })

    const base = await svc.generateStateImage(ctx, location.id, location.states[0].id)
    expect(base.status).toBe('ready')
    expect(base.imagePath).toMatch(new RegExp(`^locations/${location.id}/${location.states[0].id}_[0-9a-f]{6}\\.png$`))
    expect(fs.existsSync(ctx.paths.resolveAsset(base.imagePath!))).toBe(true)
    expect(calls[0]).toMatchObject({ prompt: locationReferencePrompt(location, (await store.getMeta(ctx)).stylePreset), references: [], aspect: '4:3' })
  })

  it('adds a state without a picture by default, and draws one from the base picture when asked', async () => {
    const { svc, calls, ctx, store } = await setup()
    const location = await svc.create(ctx, input(), 'user')
    const base = await svc.generateStateImage(ctx, location.id, location.states[0].id)
    const night = await svc.addState(ctx, location.id, { name: 'Night', delta: 'only embers glowing' }, 'ai', { generate: false })
    expect(night).toMatchObject({ kind: 'state', status: 'failed', error: 'No image yet: upload one or regenerate' })
    const drawn = await svc.generateStateImage(ctx, location.id, night.id)
    expect(drawn.status).toBe('ready')
    const stored = await svc.get(ctx, location.id)
    expect(calls[1].prompt).toBe(locationStatePrompt(stored, night, (await store.getMeta(ctx)).stylePreset))
    expect(calls[1].references).toEqual([{ relPath: base.imagePath, label: 'location base picture' }])
  })

  it('refuses to draw a state while the base picture is not ready', async () => {
    const { svc, calls, ctx } = await setup()
    const location = await svc.create(ctx, input(), 'user', { generate: false })
    const night = await svc.addState(ctx, location.id, { name: 'Night', delta: 'dark' }, 'ai', { generate: false })
    expect(await svc.generateStateImage(ctx, location.id, night.id)).toMatchObject({ status: 'failed', error: 'Base picture is not ready' })
    expect(calls).toEqual([])
  })

  it('keeps names unique: a second location or a second state of one name is refused and names the one to reuse', async () => {
    const { svc, ctx } = await setup()
    const location = await svc.create(ctx, input(), 'user', { generate: false })
    await expect(svc.create(ctx, input(' back STOCKROOM '), 'ai')).rejects.toBeInstanceOf(DuplicateLocationError)
    await svc.addState(ctx, location.id, { name: 'Night', delta: 'dark' }, 'ai', { generate: false })
    await expect(svc.addState(ctx, location.id, { name: 'night', delta: 'darker' }, 'ai')).rejects.toThrow(new DuplicateStateError('Back stockroom', 'Night').message)
  })

  it('says when an update changes the layout, so the pictures can be redrawn', async () => {
    const { svc, ctx } = await setup()
    const location = await svc.create(ctx, input(), 'user', { generate: false })
    expect((await svc.update(ctx, location.id, { notes: 'Where they hid.' })).layoutChanged).toBe(false)
    const { location: next, layoutChanged } = await svc.update(ctx, location.id, { layout: 'Back door at frame-right.' })
    expect(layoutChanged).toBe(true)
    expect(next).toMatchObject({ notes: 'Where they hid.', layout: 'Back door at frame-right.' })
  })

  it('redraws a picture whose check failed, with the issues, and records the last check', async () => {
    const failed: CheckResult = { passed: false, issues: ['the door is on the right'], skipped: false }
    const passed: CheckResult = { passed: true, issues: [], skipped: false }
    const { svc, calls, checks, ctx } = await setup({ replies: [failed, passed] })
    const location = await svc.create(ctx, input(), 'user')
    const base = await svc.generateStateImage(ctx, location.id, location.states[0].id)
    expect(base).toMatchObject({ status: 'ready', check: passed })
    expect(calls[1].prompt.endsWith(` ${sheetFixInstruction(failed.issues)}`)).toBe(true)
    expect(checks[0]).toMatchObject({ subject: { kind: 'location', state: { kind: 'base' } }, baseImageRelPath: null })
  })

  it('keeps the old picture when a redraw fails', async () => {
    let fail = false
    const { svc, ctx } = await setup({
      gen: async () => {
        if (fail) throw new ProviderError('unknown', 'boom')
        return { data: PNG, ext: 'png' }
      }
    })
    const location = await svc.create(ctx, input(), 'user')
    const first = await svc.generateStateImage(ctx, location.id, location.states[0].id)
    fail = true
    expect(await svc.generateStateImage(ctx, location.id, location.states[0].id)).toMatchObject({ status: 'failed', imagePath: first.imagePath })
  })

  it('refuses to delete a location or a state a panel uses, and never deletes the base state', async () => {
    const used = await setup({ used: ['pnl_0000000001'] })
    const location = await used.svc.create(used.ctx, input(), 'user', { generate: false })
    await expect(used.svc.delete(used.ctx, location.id)).rejects.toBeInstanceOf(LocationInUseError)
    await expect(used.svc.deleteState(used.ctx, location.id, location.states[0].id)).rejects.toThrow('The base state cannot be deleted')
    const night = await used.svc.addState(used.ctx, location.id, { name: 'Night', delta: 'dark' }, 'user', { generate: false })
    await expect(used.svc.deleteState(used.ctx, location.id, night.id)).rejects.toThrow('This state is used by 1 panel(s): pnl_0000000001. Archive it instead.')
  })

  it('trashes a location nobody uses, with its pictures', async () => {
    const { svc, ctx, trashed } = await setup()
    const location = await svc.create(ctx, input(), 'user')
    await svc.generateStateImage(ctx, location.id, location.states[0].id)
    await svc.delete(ctx, location.id)
    expect(trashed).toEqual([ctx.paths.locationFile(location.id), ctx.paths.locationDir(location.id)])
  })

  it('archives out of the list and back, and stores an uploaded picture as ready and unchecked', async () => {
    const { svc, ctx } = await setup()
    const location = await svc.create(ctx, input(), 'user', { generate: false })
    await svc.archive(ctx, location.id)
    expect(await svc.list(ctx)).toEqual([])
    expect((await svc.list(ctx, { includeArchived: true })).map((l) => l.id)).toEqual([location.id])
    await svc.unarchive(ctx, location.id)
    const uploaded = await svc.uploadStateImage(ctx, location.id, location.states[0].id, PNG, 'png')
    expect(uploaded).toMatchObject({ status: 'ready', error: null, check: null })
    expect((await svc.list(ctx))[0].states[0].imagePath).toBe(uploaded.imagePath)
  })

  it('fails a picture left pending when the app closed', async () => {
    const { svc, ctx } = await setup()
    const location = await svc.create(ctx, input(), 'user')
    await svc.recoverInterrupted(ctx)
    expect((await svc.get(ctx, location.id)).states[0]).toMatchObject({ status: 'failed', error: INTERRUPTED })
  })
})
