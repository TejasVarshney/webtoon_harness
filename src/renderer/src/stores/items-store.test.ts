import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Item } from '@shared/types'
import { startEventSync } from '../events'
import { PROJECT_ID as projectId, item, usage } from '../test/item-fixtures'
import { installFakeApi } from '../test/fake-api'
import { initialAppState, useAppStore } from './app-store'
import { initialItemsState, useItemsStore } from './items-store'

let stop: (() => void) | undefined
beforeEach(() => {
  useAppStore.setState({ ...initialAppState, projectId })
  useItemsStore.setState({ ...initialItemsState })
})
afterEach(() => stop?.())

/** A promise the test settles by hand. */
function deferred<T>() {
  let resolve!: (v: T) => void
  const promise = new Promise<T>((r) => (resolve = r))
  return { promise, resolve }
}

describe('useItemsStore', () => {
  it('loads every item of the open project, archived ones included', async () => {
    const { calls } = installFakeApi({ 'items:list': () => [item(), item({ id: 'itm_0000000002', name: 'Old Pistol', archived: true })] })
    await useItemsStore.getState().load()
    expect(calls).toEqual([{ channel: 'items:list', req: { projectId, includeArchived: true } }])
    expect(useItemsStore.getState().items.map((i) => i.name)).toEqual(['Ray Pistol', 'Old Pistol'])
    expect(useItemsStore.getState()).toMatchObject({ projectId, loaded: true, error: null })
  })

  it('applies only the latest response, even when an older one lands last', async () => {
    const first = deferred<Item[]>()
    const second = deferred<Item[]>()
    const queue = [first, second]
    installFakeApi({ 'items:list': () => queue.shift()!.promise })
    const a = useItemsStore.getState().load()
    const b = useItemsStore.getState().load()
    second.resolve([item({ name: 'New' })])
    await b
    first.resolve([item({ name: 'Old' })])
    await a
    expect(useItemsStore.getState().items.map((i) => i.name)).toEqual(['New'])
  })

  it('drops a response for a project that is no longer open', async () => {
    const slow = deferred<Item[]>()
    installFakeApi({ 'items:list': () => slow.promise })
    const pending = useItemsStore.getState().load()
    useAppStore.setState({ projectId: 'prj_bbbbbbbbbb' })
    slow.resolve([item()])
    await pending
    expect(useItemsStore.getState().items).toEqual([])
  })

  it('clears the previous project when another one is loaded', async () => {
    installFakeApi({ 'items:list': () => [item()] })
    await useItemsStore.getState().load()
    useItemsStore.getState().select('itm_0000000001')
    const slow = deferred<Item[]>()
    installFakeApi({ 'items:list': () => slow.promise })
    useAppStore.setState({ projectId: 'prj_bbbbbbbbbb' })
    const pending = useItemsStore.getState().load()
    expect(useItemsStore.getState()).toMatchObject({ items: [], selectedId: null, projectId: 'prj_bbbbbbbbbb' })
    slow.resolve([])
    await pending
  })

  it('keeps the selection when the same project reloads', async () => {
    installFakeApi({ 'items:list': () => [item()] })
    await useItemsStore.getState().load()
    useItemsStore.getState().select('itm_0000000001')
    await useItemsStore.getState().load()
    expect(useItemsStore.getState().selectedId).toBe('itm_0000000001')
  })

  it('records a load failure instead of throwing, and keeps what it had', async () => {
    let fail = false
    installFakeApi({
      'items:list': () => {
        if (fail) throw new Error('disk on fire')
        return [item()]
      }
    })
    await useItemsStore.getState().load()
    fail = true
    await expect(useItemsStore.getState().load()).resolves.toBeUndefined()
    expect(useItemsStore.getState()).toMatchObject({ error: 'disk on fire' })
    expect(useItemsStore.getState().items).toHaveLength(1)
  })

  it('empties itself when no project is open', async () => {
    installFakeApi({ 'items:list': () => [item()] })
    await useItemsStore.getState().load()
    useAppStore.setState({ projectId: null })
    await useItemsStore.getState().load()
    expect(useItemsStore.getState()).toMatchObject({ items: [], projectId: null })
  })

  describe('item.changed', () => {
    it('reloads for the open project only', async () => {
      const { calls, emit } = installFakeApi({ 'items:list': () => [item()], 'projects:open': () => ({ meta: {}, problems: [] }) })
      stop = startEventSync()
      emit({ type: 'item.changed', projectId: 'prj_bbbbbbbbbb', itemId: 'itm_0000000001' })
      await new Promise((r) => setTimeout(r, 10))
      expect(calls).toEqual([])
      emit({ type: 'item.changed', projectId, itemId: 'itm_0000000001' })
      await new Promise((r) => setTimeout(r, 10))
      // The reload, then the problems it may have found (I1).
      expect(calls.map((c) => c.channel)).toEqual(['items:list', 'projects:open'])
      expect(useItemsStore.getState().items).toHaveLength(1)
    })

    it('does not leave an unhandled rejection when the reload fails', async () => {
      const { emit } = installFakeApi({
        'items:list': () => {
          throw new Error('nope')
        }
      })
      stop = startEventSync()
      emit({ type: 'item.changed', projectId, itemId: 'itm_0000000001' })
      await new Promise((r) => setTimeout(r, 10))
      expect(useItemsStore.getState().error).toBe('nope')
    })
  })

  describe('actions', () => {
    it('reloads after each mutation', async () => {
      let list: Item[] = []
      const pistol = item()
      const { calls } = installFakeApi({
        'items:list': () => list,
        'items:create': () => ((list = [pistol]), pistol),
        'items:update': () => pistol,
        'items:archive': () => undefined,
        'items:unarchive': () => undefined,
        'items:delete': () => undefined,
        'items:addUsage': () => pistol.usages[0],
        'items:generateUsage': () => pistol.usages[0],
        'items:deleteUsage': () => undefined,
        'items:uploadUsageImage': () => null
      })
      const s = useItemsStore.getState()
      const input = { name: 'Ray Pistol', appearanceLock: 'x' }
      expect(await s.create(input)).toEqual(pistol)
      await s.update(pistol.id, { name: 'R' })
      await s.archive(pistol.id)
      await s.unarchive(pistol.id)
      await s.addUsage(pistol.id, { name: 'Firing', kind: 'action', delta: 'x' })
      await s.generateUsage(pistol.id, 'use_0000000001')
      expect(await s.uploadUsageImage(pistol.id, 'use_0000000001')).toBeNull()
      await s.deleteUsage(pistol.id, 'use_0000000001')
      await s.remove(pistol.id)
      const channels = calls.map((c) => c.channel)
      // `uploadUsageImage` resolved to null (cancelled), so it does not reload.
      expect(channels.filter((c) => c === 'items:list')).toHaveLength(8)
      expect(calls.find((c) => c.channel === 'items:create')?.req).toEqual({ projectId, input, generateBase: true })
      expect(calls.find((c) => c.channel === 'items:addUsage')?.req).toMatchObject({ generate: true })
      expect(useItemsStore.getState().items).toEqual([pistol])
    })

    it('reloads after an upload that stored an image', async () => {
      const { calls } = installFakeApi({ 'items:uploadUsageImage': () => usage(), 'items:list': () => [item()] })
      await useItemsStore.getState().uploadUsageImage('itm_0000000001', 'use_0000000001')
      expect(calls.map((c) => c.channel)).toEqual(['items:uploadUsageImage', 'items:list'])
    })

    it('clears the selection when the selected item is deleted', async () => {
      installFakeApi({ 'items:delete': () => undefined, 'items:list': () => [] })
      useItemsStore.getState().select('itm_0000000001')
      await useItemsStore.getState().remove('itm_0000000001')
      expect(useItemsStore.getState().selectedId).toBeNull()
    })

    it('propagates a failing mutation to the caller', async () => {
      installFakeApi({
        'items:archive': () => {
          throw new Error('locked')
        }
      })
      await expect(useItemsStore.getState().archive('itm_0000000001')).rejects.toThrow('locked')
    })
  })
})
