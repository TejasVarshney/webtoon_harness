import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { z } from 'zod'
import { appendJsonl, readJsonl } from './jsonl'

let dir: string
let f: string
const N = z.object({ n: z.number() })

beforeEach(async () => {
  dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'wt-jsonl-'))
  f = path.join(dir, 'log.jsonl')
})

afterEach(async () => {
  await fs.promises.rm(dir, { recursive: true, force: true })
})

describe('appendJsonl / readJsonl', () => {
  it('round-trips records, one line each', async () => {
    await appendJsonl(f, [{ n: 1 }, { n: 2 }])
    await appendJsonl(f, [{ n: 3 }])
    expect(await fs.promises.readFile(f, 'utf8')).toBe('{"n":1}\n{"n":2}\n{"n":3}\n')
    expect(await readJsonl(f, N)).toEqual({ records: [{ n: 1 }, { n: 2 }, { n: 3 }], skipped: 0 })
  })

  it('creates the parent directory', async () => {
    const nested = path.join(dir, 'a', 'b', 'log.jsonl')
    await appendJsonl(nested, [{ n: 1 }])
    expect((await readJsonl(nested, N)).records).toEqual([{ n: 1 }])
  })

  it('appending nothing does not create the file', async () => {
    await appendJsonl(f, [])
    expect(fs.existsSync(f)).toBe(false)
  })

  it('keeps newlines inside strings escaped so a record stays on one line', async () => {
    const S = z.object({ s: z.string() })
    await appendJsonl(f, [{ s: 'a\nb\r\nc' }])
    expect((await fs.promises.readFile(f, 'utf8')).split('\n')).toHaveLength(2)
    expect((await readJsonl(f, S)).records).toEqual([{ s: 'a\nb\r\nc' }])
  })

  it('skips an unparsable trailing JSONL line', async () => {
    await appendJsonl(f, [{ n: 1 }, { n: 2 }])
    await fs.promises.appendFile(f, '{"n":3')
    expect(await readJsonl(f, z.object({ n: z.number() }))).toEqual({ records: [{ n: 1 }, { n: 2 }], skipped: 1 })
  })

  it('does not glue the next append onto a truncated last line', async () => {
    await appendJsonl(f, [{ n: 1 }])
    await fs.promises.appendFile(f, '{"n":2')
    await appendJsonl(f, [{ n: 3 }])
    expect(await readJsonl(f, N)).toEqual({ records: [{ n: 1 }, { n: 3 }], skipped: 1 })
  })

  it('skips lines that parse but fail the schema', async () => {
    await fs.promises.writeFile(f, '{"n":1}\n{"n":"x"}\n[]\n{"n":2}\n')
    expect(await readJsonl(f, N)).toEqual({ records: [{ n: 1 }, { n: 2 }], skipped: 2 })
  })

  it('does not count blank lines, CRLF endings or a BOM as skipped', async () => {
    await fs.promises.writeFile(f, '﻿{"n":1}\r\n\r\n   \n{"n":2}\r\n')
    expect(await readJsonl(f, N)).toEqual({ records: [{ n: 1 }, { n: 2 }], skipped: 0 })
  })

  it('reads an empty file as no records', async () => {
    await fs.promises.writeFile(f, '')
    expect(await readJsonl(f, N)).toEqual({ records: [], skipped: 0 })
  })

  it('lets ENOENT propagate, as readJson does', async () => {
    await expect(readJsonl(f, N)).rejects.toMatchObject({ code: 'ENOENT' })
  })
})
