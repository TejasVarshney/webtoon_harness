import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import zlib from 'node:zlib'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readZip } from '../test/read-zip'
import { ZipWriter } from './zip-writer'

let dir: string
beforeEach(async () => {
  dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'zip writer '))
})
afterEach(async () => {
  await fs.promises.rm(dir, { recursive: true, force: true })
})

describe('ZipWriter', () => {
  it('round-trips entries in order with their bytes', async () => {
    const file = path.join(dir, 'a.cbz')
    const zip = await ZipWriter.open(file)
    await zip.add('002.png', Buffer.from([1, 2, 3]))
    await zip.add('001.png', Buffer.alloc(100_000, 7))
    await zip.add('empty.txt', Buffer.alloc(0))
    await zip.close()
    const entries = readZip(await fs.promises.readFile(file))
    expect(entries.map((e) => e.name)).toEqual(['002.png', '001.png', 'empty.txt'])
    expect(entries[0].data).toEqual(Buffer.from([1, 2, 3]))
    expect(entries[1].data).toEqual(Buffer.alloc(100_000, 7))
    expect(entries[2].data.length).toBe(0)
  })

  it('writes the CRC zlib.crc32 computes', async () => {
    const file = path.join(dir, 'a.cbz')
    const data = Buffer.from('some page bytes')
    const zip = await ZipWriter.open(file)
    await zip.add('p.png', data)
    await zip.close()
    expect(readZip(await fs.promises.readFile(file))[0].crc).toBe(zlib.crc32(data))
  })

  it('marks names UTF-8 (flag bit 11) and keeps a non-ASCII name', async () => {
    const file = path.join(dir, 'a.cbz')
    const name = '第1話.png'
    const zip = await ZipWriter.open(file)
    await zip.add(name, Buffer.from('x'))
    await zip.close()
    const [entry] = readZip(await fs.promises.readFile(file))
    expect(entry.name).toBe(name)
    expect(entry.flags & 0x0800).toBe(0x0800)
  })

  it('abort deletes the file', async () => {
    const file = path.join(dir, 'a.cbz')
    const zip = await ZipWriter.open(file)
    await zip.add('p.png', Buffer.from('x'))
    await zip.abort()
    await expect(fs.promises.stat(file)).rejects.toThrow()
    await expect(zip.abort()).resolves.toBeUndefined()
  })
})
