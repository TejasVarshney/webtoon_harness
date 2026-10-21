import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { z } from 'zod'
import type { PanelAspect } from '@shared/types'
import { encodeSolidPng } from './png'
import type {
  ImageEditRequest,
  ImageProvider,
  ImageRequest,
  ImageResult,
  TextProvider,
  TextTurnRequest,
  TextTurnResult
} from './types'

const MockScriptSchema = z.object({
  turns: z.array(
    z.object({
      text: z.string().optional(),
      toolCalls: z.array(z.object({ name: z.string(), input: z.record(z.string(), z.unknown()) })).optional()
    })
  )
})

export type MockScript = z.infer<typeof MockScriptSchema>

export function loadMockScript(path: string): MockScript {
  try {
    return MockScriptSchema.parse(JSON.parse(readFileSync(path, 'utf8')))
  } catch (err) {
    const detail =
      err instanceof z.ZodError
        ? err.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')
        : (err as Error).message
    throw new Error(`Invalid mock script ${path}: ${detail}`)
  }
}

interface Cursor {
  script: MockScript
  turn: number
  nextCallId: number
}

/** One cursor per script path, shared by every run in the app. */
const cursors = new Map<string, Cursor>()

/** Test isolation: forget every script cursor. */
export function resetMockScripts(): void {
  cursors.clear()
}

function abortError(): Error {
  const e = new Error('The operation was aborted')
  e.name = 'AbortError'
  return e
}

function lastUserText(req: TextTurnRequest): string {
  for (let i = req.messages.length - 1; i >= 0; i--) {
    const m = req.messages[i]
    if (m.role === 'user') return m.text
  }
  return ''
}

export class MockTextProvider implements TextProvider {
  constructor(private readonly scriptPath: string | null) {}

  async runTurn(req: TextTurnRequest): Promise<TextTurnResult> {
    if (req.signal.aborted) throw abortError()
    let cursor: Cursor | undefined
    if (this.scriptPath) {
      cursor = cursors.get(this.scriptPath)
      if (!cursor) {
        cursor = { script: loadMockScript(this.scriptPath), turn: 0, nextCallId: 1 }
        cursors.set(this.scriptPath, cursor)
      }
    }
    const c = cursor
    const turn = c && c.turn < c.script.turns.length ? c.script.turns[c.turn++] : null
    const text = turn ? (turn.text ?? '') : `(mock) ${lastUserText(req)}`
    const toolCalls =
      turn && c
        ? (turn.toolCalls ?? []).map((t) => ({ id: `mock_call_${c.nextCallId++}`, name: t.name, input: t.input }))
        : []
    if (text) req.onTextDelta?.(text)
    return { text, toolCalls, stopReason: toolCalls.length > 0 ? 'tool_use' : 'end', raw: null }
  }
}

function dimensions(aspect: PanelAspect): { width: number; height: number } {
  const [w, h] = aspect.split(':').map(Number)
  return { width: w * 128, height: h * 128 }
}

export class MockImageProvider implements ImageProvider {
  generate(req: ImageRequest): Promise<ImageResult> {
    return this.render('generate', req)
  }

  edit(req: ImageEditRequest): Promise<ImageResult> {
    return this.render('edit', req)
  }

  private async render(mode: 'generate' | 'edit', req: ImageRequest): Promise<ImageResult> {
    if (req.signal.aborted) throw abortError()
    const hash = createHash('sha256').update(`${mode}|${req.references.length}|${req.prompt}`).digest()
    const { width, height } = dimensions(req.aspect)
    return { mime: 'image/png', data: encodeSolidPng(width, height, [hash[0], hash[1], hash[2]]) }
  }
}
