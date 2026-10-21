import fs from 'node:fs'
import path from 'node:path'
import type { z } from 'zod'
import { stripBom } from './atomic'

/** True when the file exists, is non-empty and its last byte is not a newline (a crash cut the last append short). */
async function endsMidLine(absPath: string): Promise<boolean> {
  let handle: fs.promises.FileHandle
  try {
    handle = await fs.promises.open(absPath, 'r')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
  try {
    const { size } = await handle.stat()
    if (size === 0) return false
    const last = Buffer.alloc(1)
    await handle.read(last, 0, 1, size - 1)
    return last[0] !== 0x0a
  } finally {
    await handle.close()
  }
}

/**
 * Appends one JSON line per record. This is a plain append, not an atomic rewrite (ruling P4):
 * callers run it inside the project's `KeyedMutex`, and `readJsonl` tolerates a line a crash cut
 * short. If the file ends mid-line, a newline is written first so the new records are not glued
 * onto the truncated one.
 */
export async function appendJsonl(absPath: string, records: unknown[]): Promise<void> {
  if (records.length === 0) return
  const lines = records.map((record) => {
    const line = JSON.stringify(record) as string | undefined
    if (line === undefined) throw new TypeError(`Cannot serialize ${typeof record} value to JSON for ${absPath}`)
    return line
  })
  await fs.promises.mkdir(path.dirname(absPath), { recursive: true })
  const separator = (await endsMidLine(absPath)) ? '\n' : ''
  await fs.promises.appendFile(absPath, `${separator}${lines.join('\n')}\n`, 'utf8')
}

/**
 * Reads every valid record. Blank lines are ignored; a line that is not valid JSON, or does not
 * match `schema` (typically a truncated last line after a crash), is counted in `skipped`.
 * ENOENT propagates, as with `readJson`.
 */
export async function readJsonl<T>(absPath: string, schema: z.ZodType<T>): Promise<{ records: T[]; skipped: number }> {
  const text = stripBom(await fs.promises.readFile(absPath, 'utf8'))
  const records: T[] = []
  let skipped = 0
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim()
    if (line === '') continue
    let parsed: unknown
    try {
      parsed = JSON.parse(line)
    } catch {
      skipped++
      continue
    }
    const result = schema.safeParse(parsed)
    if (result.success) records.push(result.data)
    else skipped++
  }
  return { records, skipped }
}
