import { describe, expect, it } from 'vitest'
import { ProjectMetaSchema } from '@shared/schemas'
import { BUILTIN_STYLES } from './style-presets'
import { normalizeStyleName, normalizeStyleText } from './style-text'

const T = '2026-01-01T00:00:00.000Z'

describe('BUILTIN_STYLES', () => {
  it('has the ten built-ins in order', () =>
    expect(BUILTIN_STYLES.map((s) => s.id)).toEqual([
      'korean-webtoon',
      'soft-romance',
      'action-manhwa',
      'dark-fantasy',
      'ink-noir',
      'screentone-manga',
      'watercolor',
      'flat-slice-of-life',
      'retro-comic',
      'semi-realistic'
    ]))

  it('korean-webtoon is the project default, character for character', () =>
    expect(BUILTIN_STYLES[0].text).toBe(ProjectMetaSchema.parse({ id: 'prj_0000000000', title: 'T', createdAt: T, updatedAt: T }).stylePreset))

  it('every built-in passes the text rules unchanged', () => {
    for (const s of BUILTIN_STYLES) {
      expect(normalizeStyleText(s.text)).toBe(s.text)
      expect(normalizeStyleName(s.name)).toBe(s.name)
    }
  })

  it('names are unique', () => expect(new Set(BUILTIN_STYLES.map((s) => s.name.toLowerCase())).size).toBe(10))
})
