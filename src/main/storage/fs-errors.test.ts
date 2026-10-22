import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { isNotFound } from './fs-errors'

const withCode = (code: string): Error => Object.assign(new Error(code), { code })

describe('isNotFound', () => {
  it('is true for a missing file or folder, and for a path through something that is not a folder', () => {
    expect(isNotFound(withCode('ENOENT'))).toBe(true)
    expect(isNotFound(withCode('ENOTDIR'))).toBe(true)
  })

  it('is false for every other failure', () => {
    for (const code of ['EACCES', 'EPERM', 'EBUSY', 'EISDIR']) expect(isNotFound(withCode(code)), code).toBe(false)
    expect(isNotFound(new Error('no code'))).toBe(false)
    expect(isNotFound(null)).toBe(false)
    expect(isNotFound(undefined)).toBe(false)
    expect(isNotFound('ENOENT')).toBe(false)
  })

  it('recognizes what the file system really throws', async () => {
    const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'fs-errors-'))
    try {
      await expect(fs.promises.readFile(path.join(dir, 'missing.json'))).rejects.toSatisfy(isNotFound)
      await fs.promises.writeFile(path.join(dir, 'file'), 'x')
      await expect(fs.promises.readFile(path.join(dir, 'file', 'inside.json'))).rejects.toSatisfy(isNotFound)
      await expect(fs.promises.readFile(dir)).rejects.not.toSatisfy(isNotFound)
    } finally {
      await fs.promises.rm(dir, { recursive: true, force: true })
    }
  })
})
