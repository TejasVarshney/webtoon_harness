import { describe, expect, it } from 'vitest'
import { locateClaude } from './locate-claude'

const APP_DATA = 'C:\\Users\\me\\AppData\\Roaming'
const BASE = `${APP_DATA}\\Claude\\claude-code`

const lookup = (opts: { configured?: string; onPath?: string | null; files?: string[]; dirs?: Record<string, string[]> }) => {
  const files = new Set(opts.files ?? [])
  const dirs = opts.dirs ?? {}
  return locateClaude({
    configured: opts.configured ?? '',
    pathLookup: () => opts.onPath ?? null,
    appData: APP_DATA,
    exists: (p) => files.has(p),
    listDir: (p) => dirs[p] ?? []
  })
}

describe('locateClaude', () => {
  it('prefers the configured path when it exists', () => {
    const configured = 'D:\\tools\\claude.exe'
    expect(lookup({ configured, files: [configured], onPath: 'C:\\bin\\claude.exe' })).toBe(configured)
  })

  it('falls through a configured path that does not exist, to PATH', () => {
    expect(lookup({ configured: 'D:\\gone\\claude.exe', onPath: 'C:\\bin\\claude.exe' })).toBe('C:\\bin\\claude.exe')
  })

  it('uses PATH before the app data install', () => {
    const dirs = { [BASE]: ['2.1.309'], [`${BASE}\\2.1.309`]: ['abc'] }
    expect(lookup({ onPath: 'C:\\bin\\claude.exe', files: [`${BASE}\\2.1.309\\abc\\claude.exe`], dirs })).toBe('C:\\bin\\claude.exe')
  })

  it('picks the newest version folder numerically (2.1.309 beats 2.1.99)', () => {
    const dirs = {
      [BASE]: ['2.1.99', '2.1.309', '2.0.1000', 'junk'],
      [`${BASE}\\2.1.99`]: ['h1'],
      [`${BASE}\\2.1.309`]: ['h2'],
      [`${BASE}\\2.0.1000`]: ['h3']
    }
    const files = ['2.1.99\\h1', '2.1.309\\h2', '2.0.1000\\h3'].map((p) => `${BASE}\\${p}\\claude.exe`)
    expect(lookup({ files, dirs })).toBe(`${BASE}\\2.1.309\\h2\\claude.exe`)
  })

  it('skips a newer version folder that has no claude.exe', () => {
    const dirs = { [BASE]: ['2.1.309', '2.1.99'], [`${BASE}\\2.1.309`]: ['h2'], [`${BASE}\\2.1.99`]: ['h1'] }
    expect(lookup({ files: [`${BASE}\\2.1.99\\h1\\claude.exe`], dirs })).toBe(`${BASE}\\2.1.99\\h1\\claude.exe`)
  })

  it('returns null when nothing is found', () => {
    expect(lookup({})).toBeNull()
    expect(lookup({ dirs: { [BASE]: ['2.1.309'] } })).toBeNull()
  })
})
