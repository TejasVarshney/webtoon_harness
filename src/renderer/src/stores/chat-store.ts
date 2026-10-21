import { create } from 'zustand'
import type { AgentEvent, ChatMessage } from '@shared/types'

/** A local, non-persisted message shown in the thread (a failed run or a rejected send). */
export interface ChatNotice {
  id: string
  text: string
}

export interface ChatData {
  /** Thread key (a session id, or `panel:<panelId>`) to its messages. */
  messages: Record<string, ChatMessage[]>
  /** Thread key to the assistant text streamed so far in the current step. */
  streaming: Record<string, string>
  notices: Record<string, ChatNotice[]>
}

export interface ChatActions {
  /** Replaces a thread with whatever `loader` returns (the persisted transcript). */
  load(threadKey: string, loader: () => Promise<ChatMessage[]>): Promise<void>
  applyAgentEvent(threadKey: string, e: AgentEvent): void
  /** Appends a message unless one with the same id is already there. */
  addMessage(threadKey: string, message: ChatMessage): void
  addNotice(threadKey: string, text: string): void
  clearNotices(threadKey: string): void
}

let noticeCounter = 0

export const useChatStore = create<ChatData & ChatActions>()((set, get) => ({
  messages: {},
  streaming: {},
  notices: {},

  async load(threadKey, loader) {
    const loaded = await loader()
    set((s) => ({
      messages: { ...s.messages, [threadKey]: loaded },
      streaming: { ...s.streaming, [threadKey]: '' },
      notices: { ...s.notices, [threadKey]: [] }
    }))
  },

  applyAgentEvent(threadKey, e) {
    switch (e.kind) {
      case 'text-delta':
        set((s) => ({ streaming: { ...s.streaming, [threadKey]: (s.streaming[threadKey] ?? '') + e.text } }))
        break
      case 'message':
        get().addMessage(threadKey, e.message)
        set((s) => ({ streaming: { ...s.streaming, [threadKey]: '' } }))
        break
      case 'run-finished':
        set((s) => ({ streaming: { ...s.streaming, [threadKey]: '' } }))
        if (e.error !== null) get().addNotice(threadKey, e.error)
        break
      default:
        break
    }
  },

  addMessage(threadKey, message) {
    set((s) => {
      const existing = s.messages[threadKey] ?? []
      if (existing.some((m) => m.id === message.id)) return s
      return { messages: { ...s.messages, [threadKey]: [...existing, message] } }
    })
  },

  addNotice(threadKey, text) {
    set((s) => ({ notices: { ...s.notices, [threadKey]: [...(s.notices[threadKey] ?? []), { id: `notice_${++noticeCounter}`, text }] } }))
  },

  clearNotices(threadKey) {
    set((s) => ({ notices: { ...s.notices, [threadKey]: [] } }))
  }
}))
