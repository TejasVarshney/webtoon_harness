import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { StyleLibrary } from './style-library'
import { BUILTIN_STYLES } from './style-presets'

const CORRUPT = 'styles.json is unreadable and was left untouched, so nothing was saved. Repair or remove it.'
const WATERCOLOR = BUILTIN_STYLES.find((s) => s.id === 'watercolor')!

let dir: string | undefined
afterEach(async () => {
  if (dir) await fs.promises.rm(dir, { recursive: true, force: true, maxRetries: 5 })
  dir = undefined
})

/** A library on a file whose parent folder does not exist yet, as on the first run of a test user-data folder. */
async function setup(): Promise<{ file: string; library: StyleLibrary }> {
  dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'webtoon styles '))
  const file = path.join(dir, 'user data', 'styles.json')
  const library = new StyleLibrary(file)
  await library.load()
  return { file, library }
}

describe('StyleLibrary', () => {
  it('lists the built-ins when there is no file', async () => {
    const { library } = await setup()
    expect(library.list()).toHaveLength(10)
    expect(library.list().every((s) => s.builtin && !s.edited)).toBe(true)
    expect(library.loadError()).toBeNull()
  })

  it('creates a custom style after the built-ins, normalized', async () => {
    const { library } = await setup()
    const created = await library.create({ name: ' Mine ', text: 'Ink wash.' })
    expect(created.id).toMatch(/^sty_[0-9a-f]{10}$/)
    expect(created).toMatchObject({ name: 'Mine', text: 'Ink wash', builtin: false, edited: false })
    expect(library.list().at(-1)).toEqual(created)
    expect(library.get(created.id)).toEqual(created)
  })

  it('persists across a reload', async () => {
    const { file, library } = await setup()
    const created = await library.create({ name: 'Mine', text: 'Ink wash' })
    const again = new StyleLibrary(file)
    await again.load()
    expect(again.get(created.id)).toEqual(created)
  })

  it('rejects a name clash, ignoring case, including built-ins', async () => {
    const { library } = await setup()
    await expect(library.create({ name: 'WATERCOLOR', text: 'Ink wash' })).rejects.toThrow('There is already a style named WATERCOLOR.')
  })

  it('rejects renaming a style to another style\'s name', async () => {
    const { library } = await setup()
    const created = await library.create({ name: 'Mine', text: 'Ink wash' })
    await expect(library.update(created.id, { name: 'watercolor' })).rejects.toThrow('There is already a style named watercolor.')
  })

  it('allows renaming a style with only a case change', async () => {
    const { library } = await setup()
    const created = await library.create({ name: 'Mine', text: 'Ink wash' })
    expect((await library.update(created.id, { name: 'MINE' })).name).toBe('MINE')
  })

  it('edits a custom style in place', async () => {
    const { library } = await setup()
    const created = await library.create({ name: 'Mine', text: 'Ink wash' })
    const updated = await library.update(created.id, { text: 'New look.' })
    expect(updated).toEqual({ ...created, text: 'New look' })
  })

  it('checks the text rules when editing', async () => {
    const { library } = await setup()
    await expect(library.update('watercolor', { text: 'x' })).rejects.toThrow('A style description needs 3 to 400 characters.')
    expect(library.get('watercolor')?.edited).toBe(false)
  })

  it('overrides a built-in and marks it edited', async () => {
    const { file, library } = await setup()
    expect(await library.update('watercolor', { text: 'Wet wash' })).toEqual({ id: 'watercolor', name: 'Watercolor', text: 'Wet wash', builtin: true, edited: true })
    const again = new StyleLibrary(file)
    await again.load()
    expect(again.get('watercolor')?.text).toBe('Wet wash')
  })

  it('reset restores a built-in', async () => {
    const { file, library } = await setup()
    await library.update('watercolor', { text: 'Wet wash' })
    expect(await library.reset('watercolor')).toEqual({ ...WATERCOLOR, builtin: true, edited: false })
    expect(JSON.parse(await fs.promises.readFile(file, 'utf8')).overrides).toEqual({})
  })

  it('refuses to reset a custom style', async () => {
    const { library } = await setup()
    const created = await library.create({ name: 'Mine', text: 'Ink wash' })
    await expect(library.reset(created.id)).rejects.toThrow('Only a built-in style can be reset.')
  })

  it('refuses to delete a built-in', async () => {
    const { library } = await setup()
    await expect(library.delete('watercolor')).rejects.toThrow('A built-in style cannot be deleted.')
  })

  it('deletes a custom style', async () => {
    const { library } = await setup()
    const created = await library.create({ name: 'Mine', text: 'Ink wash' })
    await library.delete(created.id)
    expect(library.get(created.id)).toBeUndefined()
    expect(library.list()).toHaveLength(10)
  })

  it('reports an unknown id', async () => {
    const { library } = await setup()
    await expect(library.update('nope', { name: 'X' })).rejects.toThrow('Unknown style: nope')
    await expect(library.delete('nope')).rejects.toThrow('Unknown style: nope')
    await expect(library.reset('nope')).rejects.toThrow('Unknown style: nope')
  })

  it('a corrupt file leaves the built-ins and refuses saves without overwriting', async () => {
    const { file } = await setup()
    await fs.promises.mkdir(path.dirname(file), { recursive: true })
    await fs.promises.writeFile(file, '{"custom": oops')
    const library = new StyleLibrary(file)
    await library.load()
    expect(library.loadError()).not.toBeNull()
    expect(library.list()).toHaveLength(10)
    expect(library.list().some((s) => s.edited)).toBe(false)
    await expect(library.create({ name: 'Mine', text: 'Ink wash' })).rejects.toThrow(CORRUPT)
    await expect(library.update('watercolor', { text: 'Wet wash' })).rejects.toThrow(CORRUPT)
    expect(await fs.promises.readFile(file, 'utf8')).toBe('{"custom": oops')
  })

  it('refuses a reset that would clash with a style now using the built-in name', async () => {
    const { library } = await setup()
    await library.update('watercolor', { name: 'Aqua' })
    await library.create({ name: 'Watercolor', text: 'Ink wash' })
    await expect(library.reset('watercolor')).rejects.toThrow('There is already a style named Watercolor.')
    expect(library.get('watercolor')?.name).toBe('Aqua')
  })

  it('recovers on the next save once a corrupt file is removed', async () => {
    const { file } = await setup()
    await fs.promises.mkdir(path.dirname(file), { recursive: true })
    await fs.promises.writeFile(file, '{"custom": oops')
    const library = new StyleLibrary(file)
    await library.load()
    await fs.promises.rm(file)
    await library.create({ name: 'Mine', text: 'Ink wash' })
    expect(library.loadError()).toBeNull()
    expect(library.list()).toHaveLength(11)
  })

  it('keeps what a repaired file holds on the next save', async () => {
    const { file } = await setup()
    await fs.promises.mkdir(path.dirname(file), { recursive: true })
    await fs.promises.writeFile(file, '{"custom": oops')
    const library = new StyleLibrary(file)
    await library.load()
    await fs.promises.writeFile(file, JSON.stringify({ custom: [{ id: 'sty_0000000001', name: 'Kept', text: 'Old wash' }] }))
    await library.create({ name: 'Mine', text: 'Ink wash' })
    expect(library.list().map((s) => s.name)).toEqual(expect.arrayContaining(['Kept', 'Mine']))
  })

  it('runs simultaneous creates without losing one', async () => {
    const { file, library } = await setup()
    await Promise.all([1, 2, 3, 4, 5].map((n) => library.create({ name: `Style ${n}`, text: 'Ink wash' })))
    const again = new StyleLibrary(file)
    await again.load()
    expect(again.list()).toHaveLength(15)
  })

  it('a failed name check inside simultaneous creates loses nothing else', async () => {
    const { library } = await setup()
    const results = await Promise.allSettled([library.create({ name: 'Same', text: 'Ink wash' }), library.create({ name: 'same', text: 'Ink wash' })])
    expect(results.map((r) => r.status)).toEqual(['fulfilled', 'rejected'])
    expect(library.list()).toHaveLength(11)
  })
})
