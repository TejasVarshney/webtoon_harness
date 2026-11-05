import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FileSink } from './file-sink'

let dir: string
beforeEach(async () => {
  dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'file sink '))
})
afterEach(async () => {
  await fs.promises.rm(dir, { recursive: true, force: true })
})

describe('FileSink', () => {
  it('tracks the position and writes the bytes in order', async () => {
    const file = path.join(dir, 'a.bin')
    const sink = await FileSink.open(file)
    expect(sink.offset).toBe(0)
    await sink.write(Buffer.from('abc'))
    await sink.write(Buffer.alloc(0))
    expect(sink.offset).toBe(3)
    await sink.write(Buffer.from('de'))
    expect(sink.offset).toBe(5)
    await sink.close()
    expect((await fs.promises.readFile(file)).toString()).toBe('abcde')
  })

  it('abort removes the file, and can be called twice', async () => {
    const file = path.join(dir, 'a.bin')
    const sink = await FileSink.open(file)
    await sink.write(Buffer.from('x'))
    await sink.abort()
    await expect(fs.promises.stat(file)).rejects.toThrow()
    await expect(sink.abort()).resolves.toBeUndefined()
  })

  it('a failed open leaves no file behind', async () => {
    const file = path.join(dir, 'a.bin')
    await expect(
      FileSink.openWith(file, async (sink) => {
        await sink.write(Buffer.from('x'))
        throw new Error('init failed')
      })
    ).rejects.toThrow('init failed')
    await expect(fs.promises.stat(file)).rejects.toThrow()
  })

  it('openWith returns the sink when init succeeds', async () => {
    const file = path.join(dir, 'a.bin')
    const sink = await FileSink.openWith(file, (s) => s.write(Buffer.from('hi')))
    expect(sink.offset).toBe(2)
    await sink.close()
    expect((await fs.promises.readFile(file)).toString()).toBe('hi')
  })
})
