import { describe, expect, it } from 'vitest'
import { ID_PREFIXES, newId } from '@shared/ids'

describe('newId', () => {
  it('formats ids', () => {
    expect(newId('chr')).toMatch(/^chr_[0-9a-f]{10}$/)
    expect(new Set(Array.from({ length: 1000 }, () => newId('pnl'))).size).toBe(1000)
  })

  it('knows every prefix from the spec', () => {
    expect([...ID_PREFIXES]).toEqual(['prj', 'ses', 'chr', 'var', 'epi', 'pnl', 'ver', 'msg', 'run', 'end', 'mdl', 'bt', 'dlg', 'upl'])
    for (const prefix of ID_PREFIXES) expect(newId(prefix)).toMatch(new RegExp(`^${prefix}_[0-9a-f]{10}$`))
  })
})
