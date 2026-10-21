import { newId } from '@shared/ids'
import type { AgentEvent, ChatMessage, LoopOutcome, ToolResult } from '@shared/types'
import type { ImageLoader, TextProvider } from '../models/providers/types'
import type { ToolContext, ToolRegistry } from './tools/registry'

export interface AgentLoopOptions {
  runId: string
  provider: TextProvider
  system: string
  /** Already ends with the new user message. */
  history: ChatMessage[]
  tools: ToolRegistry
  toolCtx: Omit<ToolContext, 'signal'>
  model: { endpointId: string; modelId: string }
  loadImage: ImageLoader
  signal: AbortSignal
  maxSteps?: number
  persist(msgs: ChatMessage[]): Promise<void>
  emit(e: AgentEvent): void
}

export interface AgentLoopResult {
  outcome: LoopOutcome
  error: string | null
}

const DEFAULT_MAX_STEPS = 24
const REFUSAL_MESSAGE = 'The model declined this request.'

function isAbort(err: unknown, signal: AbortSignal): boolean {
  const name = err instanceof Error ? err.name : ''
  return name === 'AbortError' || name === 'APIUserAbortError' || signal.aborted
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/**
 * Provider-agnostic agent loop. Invariant (Review Focus 1): every persisted assistant `tool_use`
 * is followed by a tool message holding a result for each of its calls, even when the run is
 * cancelled halfway through them.
 */
export async function runAgentLoop(opts: AgentLoopOptions): Promise<AgentLoopResult> {
  let result: AgentLoopResult
  try {
    result = await run(opts)
  } catch (err) {
    // persist (or anything unexpected) failed: the run still ends with a single run-finished.
    result = { outcome: 'error', error: message(err) }
  }
  safeEmit(opts.emit, { kind: 'run-finished', runId: opts.runId, outcome: result.outcome, error: result.error })
  return result
}

/** emit is webContents.send in production and throws once the window is gone; it must never break the loop. */
function safeEmit(emit: (e: AgentEvent) => void, e: AgentEvent): void {
  try {
    emit(e)
  } catch (err) {
    console.error('agent event emit failed:', err)
  }
}

const INTERRUPTED = 'Interrupted before this tool ran'

/**
 * Pure. Returns a history in which every assistant tool call has a result: missing ids get an
 * ok:false result (merged into the following tool message, or a new one inserted). Covers a kill
 * between persisting an assistant message and its tool message, which would 400 Anthropic forever.
 */
export function repairToolHistory(history: ChatMessage[]): ChatMessage[] {
  const out: ChatMessage[] = []
  for (let i = 0; i < history.length; i++) {
    const m = history[i]
    out.push(m)
    if (m.role !== 'assistant' || m.toolCalls.length === 0) continue
    const next = history[i + 1]
    const existing = next && next.role === 'tool' ? next : null
    const have = new Set(existing ? existing.results.map((r) => r.toolCallId) : [])
    const missing = m.toolCalls
      .filter((c) => !have.has(c.id))
      .map((c): ToolResult => ({ toolCallId: c.id, name: c.name, ok: false, content: INTERRUPTED, images: [] }))
    if (missing.length === 0) continue
    if (existing) {
      out.push({ ...existing, results: [...existing.results, ...missing] })
      i++
    } else {
      out.push({ id: newId('msg'), role: 'tool', results: missing, createdAt: new Date().toISOString() })
    }
  }
  return out
}

async function run(opts: AgentLoopOptions): Promise<AgentLoopResult> {
  const { runId, provider, tools, signal } = opts
  const emit = (e: AgentEvent): void => safeEmit(opts.emit, e)
  const maxSteps = opts.maxSteps ?? DEFAULT_MAX_STEPS
  const history = [...opts.history]
  const toolCtx: ToolContext = { ...opts.toolCtx, signal }

  emit({ kind: 'run-started', runId })

  for (let step = 0; step < maxSteps; step++) {
    if (signal.aborted) return { outcome: 'cancelled', error: null }

    let turn
    try {
      turn = await provider.runTurn({
        system: opts.system,
        messages: repairToolHistory(history),
        tools: tools.specs(),
        loadImage: opts.loadImage,
        signal,
        onTextDelta: (text) => emit({ kind: 'text-delta', runId, text })
      })
    } catch (err) {
      if (isAbort(err, signal)) return { outcome: 'cancelled', error: null }
      return { outcome: 'error', error: message(err) }
    }

    // Defensive: a refused or truncated turn must never leave unanswerable tool calls behind.
    const dropCalls = turn.stopReason === 'refusal' || turn.stopReason === 'max_tokens'
    const assistant: ChatMessage = {
      id: newId('msg'),
      role: 'assistant',
      text: turn.text,
      toolCalls: dropCalls ? [] : turn.toolCalls,
      stopReason: turn.stopReason,
      model: opts.model,
      raw: turn.raw,
      createdAt: new Date().toISOString()
    }
    history.push(assistant)
    await opts.persist([assistant])
    emit({ kind: 'message', runId, message: assistant })

    if (turn.stopReason === 'refusal') return { outcome: 'refusal', error: REFUSAL_MESSAGE }
    if (turn.stopReason === 'max_tokens') return { outcome: 'max_tokens', error: null }
    if (turn.toolCalls.length === 0) return { outcome: 'end', error: null }

    // From here the assistant tool_use is persisted, so a tool message covering every call id is
    // guaranteed in `finally`, whatever goes wrong while the tools run.
    const results = new Map<string, ToolResult>()
    let failure: unknown = null
    try {
      for (const call of turn.toolCalls) {
        if (signal.aborted) {
          results.set(call.id, { toolCallId: call.id, name: call.name, ok: false, content: 'Cancelled by user', images: [] })
          continue
        }
        emit({ kind: 'tool-started', runId, toolCall: call })
        results.set(call.id, await tools.execute(call, toolCtx))
      }
    } catch (err) {
      failure = err
    } finally {
      const content = signal.aborted ? 'Cancelled by user' : failure ? message(failure) : 'Tool did not run'
      const toolMsg: ChatMessage = {
        id: newId('msg'),
        role: 'tool',
        results: turn.toolCalls.map(
          (c) => results.get(c.id) ?? { toolCallId: c.id, name: c.name, ok: false, content, images: [] }
        ),
        createdAt: new Date().toISOString()
      }
      history.push(toolMsg)
      await opts.persist([toolMsg])
      emit({ kind: 'message', runId, message: toolMsg })
    }
    if (failure) return { outcome: 'error', error: message(failure) }

    if (signal.aborted) return { outcome: 'cancelled', error: null }
  }
  return { outcome: 'max_steps', error: null }
}
