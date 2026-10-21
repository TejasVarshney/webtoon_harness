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
  opts.emit({ kind: 'run-finished', runId: opts.runId, outcome: result.outcome, error: result.error })
  return result
}

async function run(opts: AgentLoopOptions): Promise<AgentLoopResult> {
  const { runId, provider, tools, signal, emit } = opts
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
        messages: history,
        tools: tools.specs(),
        loadImage: opts.loadImage,
        signal,
        onTextDelta: (text) => emit({ kind: 'text-delta', runId, text })
      })
    } catch (err) {
      if (isAbort(err, signal)) return { outcome: 'cancelled', error: null }
      return { outcome: 'error', error: message(err) }
    }

    const assistant: ChatMessage = {
      id: newId('msg'),
      role: 'assistant',
      text: turn.text,
      toolCalls: turn.toolCalls,
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

    const results: ToolResult[] = []
    for (const call of turn.toolCalls) {
      if (signal.aborted) {
        results.push({ toolCallId: call.id, name: call.name, ok: false, content: 'Cancelled by user', images: [] })
        continue
      }
      emit({ kind: 'tool-started', runId, toolCall: call })
      results.push(await tools.execute(call, toolCtx))
    }
    const toolMsg: ChatMessage = { id: newId('msg'), role: 'tool', results, createdAt: new Date().toISOString() }
    history.push(toolMsg)
    await opts.persist([toolMsg])
    emit({ kind: 'message', runId, message: toolMsg })

    if (signal.aborted) return { outcome: 'cancelled', error: null }
  }
  return { outcome: 'max_steps', error: null }
}
