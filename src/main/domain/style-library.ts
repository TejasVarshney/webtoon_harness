import fs from 'node:fs'
import path from 'node:path'
import { z } from 'zod'
import type { StyleEntry } from '@shared/ipc'
import { newId } from '@shared/ids'
import { CorruptFileError } from './errors'
import { BUILTIN_STYLES } from './style-presets'
import { normalizeStyleName, normalizeStyleText, StyleRejectedError } from './style-text'
import { readJson, writeJsonAtomic } from '../storage/atomic'
import { isNotFound } from '../storage/fs-errors'
import { KeyedMutex } from '../storage/mutex'

const Words = z.object({ name: z.string(), text: z.string() })
const StylesFileSchema = z.object({
  custom: z.array(Words.extend({ id: z.string() })).default([]),
  overrides: z.record(z.string(), Words).default({})
})
type StylesFile = z.infer<typeof StylesFileSchema>

const emptyFile = (): StylesFile => ({ custom: [], overrides: {} })

/**
 * The catalog of art styles: the built-ins, the user's edits to them and the user's own styles (`styles.json` in user
 * data). A project copies a style's text, so nothing here ever changes a project. A corrupt file is reported by
 * `loadError()`, leaves the built-ins as shipped, and is never overwritten: saves are refused until it is fixed.
 */
export class StyleLibrary {
  private readonly mutex = new KeyedMutex()
  private state: StylesFile = emptyFile()
  private corrupt: string | null = null

  constructor(private readonly file: string) {}

  async load(): Promise<void> {
    await this.mutex.run(this.file, async () => {
      try {
        this.state = await readJson(this.file, StylesFileSchema)
        this.corrupt = null
      } catch (error) {
        this.state = emptyFile()
        if (error instanceof CorruptFileError) this.corrupt = error.message
        else if (!isNotFound(error)) throw error
      }
    })
  }

  /** The message about a corrupt `styles.json`, or null. */
  loadError(): string | null {
    return this.corrupt
  }

  /** The built-ins in their shipped order, each with the user's edit applied, then the user's own in creation order. */
  list(): StyleEntry[] {
    return listFrom(this.state)
  }

  get(id: string): StyleEntry | undefined {
    return this.list().find((s) => s.id === id)
  }

  async create(input: { name: string; text: string }): Promise<StyleEntry> {
    const name = normalizeStyleName(input.name)
    const text = normalizeStyleText(input.text)
    const id = newId('sty')
    return this.save((draft) => {
      requireFreeName(draft, name, id)
      draft.custom.push({ id, name, text })
      return id
    })
  }

  /** Edits a custom style in place, or saves the user's version of a built-in. */
  async update(id: string, patch: { name?: string; text?: string }): Promise<StyleEntry> {
    const name = patch.name === undefined ? undefined : normalizeStyleName(patch.name)
    const text = patch.text === undefined ? undefined : normalizeStyleText(patch.text)
    return this.save((draft) => {
      const current = requireStyle(draft, id)
      const next = { name: name ?? current.name, text: text ?? current.text }
      requireFreeName(draft, next.name, id)
      if (current.builtin) draft.overrides[id] = next
      else Object.assign(draft.custom.find((s) => s.id === id)!, next)
      return id
    })
  }

  /** Puts a built-in back as shipped. */
  reset(id: string): Promise<StyleEntry> {
    return this.save((draft) => {
      if (!requireStyle(draft, id).builtin) throw new StyleRejectedError('Only a built-in style can be reset.')
      delete draft.overrides[id]
      return id
    })
  }

  async delete(id: string): Promise<void> {
    await this.save((draft) => {
      if (requireStyle(draft, id).builtin) throw new StyleRejectedError('A built-in style cannot be deleted.')
      draft.custom = draft.custom.filter((s) => s.id !== id)
      return null
    })
  }

  /** Changes a copy, writes it and only then adopts it, so a refused or failed save leaves the library as it was. */
  private save(change: (draft: StylesFile) => string): Promise<StyleEntry>
  private save(change: (draft: StylesFile) => null): Promise<null>
  private save(change: (draft: StylesFile) => string | null): Promise<StyleEntry | null> {
    return this.mutex.run(this.file, async () => {
      if (this.corrupt !== null) throw new StyleRejectedError('styles.json is unreadable and was left untouched, so nothing was saved. Repair or remove it.')
      const draft: StylesFile = structuredClone(this.state)
      const id = change(draft)
      await fs.promises.mkdir(path.dirname(this.file), { recursive: true })
      await writeJsonAtomic(this.file, draft)
      this.state = draft
      return id === null ? null : requireStyle(draft, id)
    })
  }
}

function listFrom(file: StylesFile): StyleEntry[] {
  return [
    ...BUILTIN_STYLES.map((s) => {
      const edit = Object.hasOwn(file.overrides, s.id) ? file.overrides[s.id] : undefined
      return { id: s.id, name: edit?.name ?? s.name, text: edit?.text ?? s.text, builtin: true, edited: edit !== undefined }
    }),
    ...file.custom.map((s) => ({ ...s, builtin: false, edited: false }))
  ]
}

function requireStyle(file: StylesFile, id: string): StyleEntry {
  const style = listFrom(file).find((s) => s.id === id)
  if (!style) throw new StyleRejectedError(`Unknown style: ${id}`)
  return style
}

function requireFreeName(file: StylesFile, name: string, ownId: string): void {
  const lower = name.toLowerCase()
  if (listFrom(file).some((s) => s.id !== ownId && s.name.toLowerCase() === lower)) throw new StyleRejectedError(`There is already a style named ${name}.`)
}
