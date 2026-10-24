import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { CorruptFileError } from '../domain/errors'
import { readJson, writeFileAtomic, writeJsonAtomic } from './atomic'

let dir: string
let p: string

beforeEach(async () => {
  dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'wt-atomic-'))
  p = path.join(dir, 'file.json')
})

afterEach(async () => {
  await fs.promises.rm(dir, { recursive: true, force: true })
})

const errno = (code: string): Error => Object.assign(new Error(code), { code })
const leftovers = async (): Promise<string[]> => (await fs.promises.readdir(dir)).filter((f) => f.includes('.tmp-'))
const escapeRegExp = (s: string): string => s.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&')

describe('writeJsonAtomic / readJson', () => {
  it('round-trips JSON with schema', async () => {
    await writeJsonAtomic(p, { a: 1 })
    expect(await readJson(p, z.object({ a: z.number() }))).toEqual({ a: 1 })
  })

  it('writes 2-space JSON with a trailing newline', async () => {
    await writeJsonAtomic(p, { a: 1, b: [2] })
    expect(await fs.promises.readFile(p, 'utf8')).toBe('{\n  "a": 1,\n  "b": [\n    2\n  ]\n}\n')
  })

  it('rejects values JSON cannot represent instead of writing garbage', async () => {
    await expect(writeJsonAtomic(p, undefined)).rejects.toThrow(TypeError)
    expect(fs.existsSync(p)).toBe(false)
    expect(await leftovers()).toEqual([])
  })

  it('lets ENOENT propagate', async () => {
    await expect(readJson(path.join(dir, 'missing.json'), z.any())).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('throws CorruptFileError on bad JSON', async () => {
    await fs.promises.writeFile(p, '{oops')
    await expect(readJson(p, z.any())).rejects.toBeInstanceOf(CorruptFileError)
    await expect(readJson(p, z.any())).rejects.toMatchObject({ path: p })
  })

  it('throws CorruptFileError on a schema mismatch', async () => {
    await fs.promises.writeFile(p, '{"a":"not a number"}')
    const err = await readJson(p, z.object({ a: z.number() })).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(CorruptFileError)
    expect((err as CorruptFileError).path).toBe(p)
  })

  it('tolerates a UTF-8 BOM from a hand edit', async () => {
    await fs.promises.writeFile(p, '﻿{"a":1}')
    expect(await readJson(p, z.object({ a: z.number() }))).toEqual({ a: 1 })
  })
})

describe('writeFileAtomic', () => {
  it('keeps the original when rename fails, calls rename once for a non-retryable code, and removes the temp file', async () => {
    await writeJsonAtomic(p, { v: 1 })
    const rename = vi.fn<typeof fs.promises.rename>().mockRejectedValue(errno('EIO'))
    const failing = { ...fs.promises, rename }
    await expect(writeFileAtomic(p, '{"v":2}', failing)).rejects.toThrow('EIO')
    expect(rename).toHaveBeenCalledTimes(1)
    expect(JSON.parse(await fs.promises.readFile(p, 'utf8'))).toEqual({ v: 1 })
    expect(await leftovers()).toEqual([])
  })

  it('retries rename on EPERM', async () => {
    const rename = vi
      .fn<typeof fs.promises.rename>()
      .mockRejectedValueOnce(errno('EPERM'))
      .mockRejectedValueOnce(errno('EPERM'))
      .mockImplementation((from, to) => fs.promises.rename(from, to))
    await expect(writeFileAtomic(p, 'hello', { ...fs.promises, rename })).resolves.toBeUndefined()
    expect(rename).toHaveBeenCalledTimes(3)
    expect(await fs.promises.readFile(p, 'utf8')).toBe('hello')
    expect(await leftovers()).toEqual([])
  })

  it('retries rename on EBUSY', async () => {
    const rename = vi
      .fn<typeof fs.promises.rename>()
      .mockRejectedValueOnce(errno('EBUSY'))
      .mockImplementation((from, to) => fs.promises.rename(from, to))
    await writeFileAtomic(p, 'hello', { ...fs.promises, rename })
    expect(rename).toHaveBeenCalledTimes(2)
    expect(await fs.promises.readFile(p, 'utf8')).toBe('hello')
  })

  it('gives up after 5 retries (6 attempts), keeps the original and removes the temp file', async () => {
    await writeJsonAtomic(p, { v: 1 })
    const rename = vi.fn<typeof fs.promises.rename>().mockRejectedValue(errno('EPERM'))
    await expect(writeFileAtomic(p, '{"v":2}', { ...fs.promises, rename })).rejects.toMatchObject({ code: 'EPERM' })
    expect(rename).toHaveBeenCalledTimes(6)
    expect(JSON.parse(await fs.promises.readFile(p, 'utf8'))).toEqual({ v: 1 })
    expect(await leftovers()).toEqual([])
  })

  it('surfaces the rename error even if temp-file cleanup also fails', async () => {
    const rename = vi.fn<typeof fs.promises.rename>().mockRejectedValue(errno('EIO'))
    const rm = vi.fn<typeof fs.promises.rm>().mockRejectedValue(errno('EACCES'))
    await expect(writeFileAtomic(p, 'x', { ...fs.promises, rename, rm })).rejects.toMatchObject({ code: 'EIO' })
    expect(rm).toHaveBeenCalledTimes(1)
  })

  it('removes the temp file when the write itself fails', async () => {
    const writeFile = vi.fn<typeof fs.promises.writeFile>().mockRejectedValue(errno('ENOSPC'))
    const rm = vi.fn<typeof fs.promises.rm>().mockResolvedValue(undefined)
    await expect(writeFileAtomic(p, 'x', { ...fs.promises, writeFile, rm })).rejects.toMatchObject({ code: 'ENOSPC' })
    expect(rm).toHaveBeenCalledTimes(1)
  })

  it('writes to <path>.tmp-<hex> first, then renames it over the target', async () => {
    const writeFile = vi.fn<typeof fs.promises.writeFile>((file, data, options) => fs.promises.writeFile(file, data, options))
    await writeFileAtomic(p, 'hello', { ...fs.promises, writeFile })
    const tmp = String(writeFile.mock.calls[0]![0])
    expect(tmp).toMatch(new RegExp(`^${escapeRegExp(p)}\\.tmp-[0-9a-f]+$`))
    expect(fs.existsSync(tmp)).toBe(false)
    expect(await fs.promises.readFile(p, 'utf8')).toBe('hello')
  })

  it('creates the parent directory', async () => {
    const nested = path.join(dir, 'a', 'b', 'c.txt')
    await writeFileAtomic(nested, 'deep')
    expect(await fs.promises.readFile(nested, 'utf8')).toBe('deep')
  })

  it('writes binary data byte for byte', async () => {
    const bytes = new Uint8Array([0, 255, 10, 13, 128])
    const bin = path.join(dir, 'img.bin')
    await writeFileAtomic(bin, bytes)
    expect(new Uint8Array(await fs.promises.readFile(bin))).toEqual(bytes)
  })

  it('overwrites an existing file', async () => {
    await writeFileAtomic(p, 'one')
    await writeFileAtomic(p, 'two')
    expect(await fs.promises.readFile(p, 'utf8')).toBe('two')
    expect(await leftovers()).toEqual([])
  })
})
