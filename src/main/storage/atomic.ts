import { randomBytes } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import type { z } from 'zod'
import { CorruptFileError } from '../domain/errors'

type AtomicFs = Pick<typeof fs.promises, 'writeFile' | 'rename' | 'rm' | 'mkdir'>

/** Antivirus scanners and indexers briefly lock freshly written files on Windows. */
const RETRYABLE_CODES = new Set(['EPERM', 'EBUSY'])
const RENAME_RETRIES = 5
const RENAME_BACKOFF_MS = 25

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

function errorCode(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'code' in error ? String((error as { code: unknown }).code) : undefined
}

async function renameWithRetry(fsImpl: AtomicFs, from: string, to: string): Promise<void> {
  for (let retry = 0; ; retry++) {
    try {
      await fsImpl.rename(from, to)
      return
    } catch (error) {
      const code = errorCode(error)
      if (retry >= RENAME_RETRIES || code === undefined || !RETRYABLE_CODES.has(code)) throw error
      await sleep(RENAME_BACKOFF_MS)
    }
  }
}

/**
 * Writes `data` to a sibling temp file and renames it over `absPath`, so a crash or a failed
 * write leaves the previous contents intact. Creates the parent directory. The temp file is
 * removed on failure; the original error is what propagates.
 */
export async function writeFileAtomic(absPath: string, data: string | Uint8Array, fsImpl: AtomicFs = fs.promises): Promise<void> {
  await fsImpl.mkdir(path.dirname(absPath), { recursive: true })
  const tmp = `${absPath}.tmp-${randomBytes(6).toString('hex')}`
  try {
    await fsImpl.writeFile(tmp, data)
    await renameWithRetry(fsImpl, tmp, absPath)
  } catch (error) {
    await fsImpl.rm(tmp, { force: true }).catch(() => undefined)
    throw error
  }
}

export async function writeJsonAtomic(absPath: string, value: unknown): Promise<void> {
  const json = JSON.stringify(value, null, 2) as string | undefined
  if (json === undefined) throw new TypeError(`Cannot serialize ${typeof value} value to JSON for ${absPath}`)
  await writeFileAtomic(absPath, `${json}\n`)
}

/** Strips the UTF-8 byte order mark that some Windows editors add to hand-edited files. */
export function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
}

/** Reads and validates a JSON file. ENOENT propagates; unparsable or mismatching content is a CorruptFileError. */
export async function readJson<T>(absPath: string, schema: z.ZodType<T>): Promise<T> {
  const text = stripBom(await fs.promises.readFile(absPath, 'utf8'))
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (error) {
    throw new CorruptFileError(absPath, `invalid JSON (${error instanceof Error ? error.message : String(error)})`)
  }
  const result = schema.safeParse(parsed)
  if (!result.success) {
    const summary = result.error.issues
      .slice(0, 3)
      .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('; ')
    throw new CorruptFileError(absPath, `does not match its schema (${summary})`)
  }
  return result.data
}
