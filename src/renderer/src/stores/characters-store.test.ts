import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Character } from '@shared/types'
import { startEventSync } from '../events'
import { PROJECT_ID as projectId, character } from '../test/character-fixtures'
import { installFakeApi } from '../test/fake-api'
import { initialAppState, useAppStore } from './app-store'
import { initialCharactersState, useCharactersStore } from './characters-store'

let stop: (() => void) | undefined
beforeEach(() => {
  useAppStore.setState({ ...initialAppState, projectId })
  useCharactersStore.setState({ ...initialCharactersState })
})
afterEach(() => stop?.())

/** A promise the test settles by hand. */
function deferred<T>() {
  let resolve!: (v: T) => void
  const promise = new Promise<T>((r) => (resolve = r))
  return { promise, resolve }
}

describe('useCharactersStore', () => {
  it('loads every character of the open project, archived ones included', async () => {
    const { calls } = installFakeApi({ 'characters:list': () => [character(), character({ id: 'chr_0000000002', name: 'Jun', archived: true })] })
    await useCharactersStore.getState().load()
    expect(calls).toEqual([{ channel: 'characters:list', req: { projectId, includeArchived: true } }])
    expect(useCharactersStore.getState().characters.map((c) => c.name)).toEqual(['Mina', 'Jun'])
    expect(useCharactersStore.getState()).toMatchObject({ projectId, loaded: true, error: null })
  })

  it('applies only the latest response, even when an older one lands last', async () => {
    const first = deferred<Character[]>()
    const second = deferred<Character[]>()
    const queue = [first, second]
    installFakeApi({ 'characters:list': () => queue.shift()!.promise })
    const a = useCharactersStore.getState().load()
    const b = useCharactersStore.getState().load()
    second.resolve([character({ name: 'New' })])
    await b
    first.resolve([character({ name: 'Old' })])
    await a
    expect(useCharactersStore.getState().characters.map((c) => c.name)).toEqual(['New'])
  })

  it('drops a response for a project that is no longer open', async () => {
    const slow = deferred<Character[]>()
    installFakeApi({ 'characters:list': () => slow.promise })
    const pending = useCharactersStore.getState().load()
    useAppStore.setState({ projectId: 'prj_bbbbbbbbbb' })
    slow.resolve([character()])
    await pending
    expect(useCharactersStore.getState().characters).toEqual([])
  })

  it('clears the previous project when another one is loaded', async () => {
    installFakeApi({ 'characters:list': () => [character()] })
    await useCharactersStore.getState().load()
    useCharactersStore.getState().select('chr_0000000001')
    const slow = deferred<Character[]>()
    installFakeApi({ 'characters:list': () => slow.promise })
    useAppStore.setState({ projectId: 'prj_bbbbbbbbbb' })
    const pending = useCharactersStore.getState().load()
    expect(useCharactersStore.getState()).toMatchObject({ characters: [], selectedId: null, projectId: 'prj_bbbbbbbbbb' })
    slow.resolve([])
    await pending
  })

  it('keeps the selection when the same project reloads', async () => {
    installFakeApi({ 'characters:list': () => [character()] })
    await useCharactersStore.getState().load()
    useCharactersStore.getState().select('chr_0000000001')
    await useCharactersStore.getState().load()
    expect(useCharactersStore.getState().selectedId).toBe('chr_0000000001')
  })

  it('records a load failure instead of throwing, and keeps what it had', async () => {
    let fail = false
    installFakeApi({
      'characters:list': () => {
        if (fail) throw new Error('disk on fire')
        return [character()]
      }
    })
    await useCharactersStore.getState().load()
    fail = true
    await expect(useCharactersStore.getState().load()).resolves.toBeUndefined()
    expect(useCharactersStore.getState()).toMatchObject({ error: 'disk on fire' })
    expect(useCharactersStore.getState().characters).toHaveLength(1)
  })

  it('empties itself when no project is open', async () => {
    installFakeApi({ 'characters:list': () => [character()] })
    await useCharactersStore.getState().load()
    useAppStore.setState({ projectId: null })
    await useCharactersStore.getState().load()
    expect(useCharactersStore.getState()).toMatchObject({ characters: [], projectId: null })
  })

  describe('character.changed', () => {
    it('reloads for the open project only', async () => {
      const { calls, emit } = installFakeApi({ 'characters:list': () => [character()] })
      stop = startEventSync()
      emit({ type: 'character.changed', projectId: 'prj_bbbbbbbbbb', characterId: 'chr_0000000001' })
      await new Promise((r) => setTimeout(r, 10))
      expect(calls).toEqual([])
      emit({ type: 'character.changed', projectId, characterId: 'chr_0000000001' })
      await new Promise((r) => setTimeout(r, 10))
      expect(calls.map((c) => c.channel)).toEqual(['characters:list'])
      expect(useCharactersStore.getState().characters).toHaveLength(1)
    })

    it('does not leave an unhandled rejection when the reload fails', async () => {
      const { emit } = installFakeApi({
        'characters:list': () => {
          throw new Error('nope')
        }
      })
      stop = startEventSync()
      emit({ type: 'character.changed', projectId, characterId: 'chr_0000000001' })
      await new Promise((r) => setTimeout(r, 10))
      expect(useCharactersStore.getState().error).toBe('nope')
    })
  })

  describe('actions', () => {
    it('reloads after each mutation', async () => {
      let list: Character[] = []
      const mina = character()
      const { calls } = installFakeApi({
        'characters:list': () => list,
        'characters:create': () => ((list = [mina]), mina),
        'characters:update': () => mina,
        'characters:archive': () => undefined,
        'characters:unarchive': () => undefined,
        'characters:delete': () => undefined,
        'characters:addVariation': () => mina.variations[0],
        'characters:generateVariation': () => mina.variations[0],
        'characters:deleteVariation': () => undefined,
        'characters:uploadVariationImage': () => null
      })
      const s = useCharactersStore.getState()
      const input = { name: 'Mina', role: 'protagonist' as const, appearanceLock: 'x' }
      expect(await s.create(input)).toEqual(mina)
      await s.update(mina.id, { name: 'M' })
      await s.archive(mina.id)
      await s.unarchive(mina.id)
      await s.addVariation(mina.id, { name: 'O', kind: 'outfit', delta: 'x' })
      await s.generateVariation(mina.id, 'var_0000000001')
      expect(await s.uploadVariationImage(mina.id, 'var_0000000001')).toBeNull()
      await s.deleteVariation(mina.id, 'var_0000000001')
      await s.remove(mina.id)
      const channels = calls.map((c) => c.channel)
      expect(channels.filter((c) => c === 'characters:list')).toHaveLength(8)
      expect(calls.find((c) => c.channel === 'characters:create')?.req).toEqual({ projectId, input, generateBase: true })
      expect(calls.find((c) => c.channel === 'characters:addVariation')?.req).toMatchObject({ generate: true })
      expect(useCharactersStore.getState().characters).toEqual([mina])
    })

    it('propagates a failing mutation to the caller', async () => {
      installFakeApi({
        'characters:archive': () => {
          throw new Error('locked')
        }
      })
      await expect(useCharactersStore.getState().archive('chr_0000000001')).rejects.toThrow('locked')
    })
  })
})
