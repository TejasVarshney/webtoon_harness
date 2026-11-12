import { create } from 'zustand'
import type { Character, Item } from '@shared/types'
import { canDraw, emptyDraft, isDraftDirty, newCastMember, newItemUse, toPanelDraft, type GenerateDraft, type GenerateRequest } from '../components/generate/generate-draft'
import { useAppStore } from './app-store'
import { usePanelsStore } from './panels-store'

export interface GenerateData {
  /** Set while the Generate page is open; the page replaces the workspace. */
  request: GenerateRequest | null
  draft: GenerateDraft
  /** True from the click on Generate until the panel is made or refused, so one click makes one panel. */
  submitting: boolean
  /** A panel just made: the strip scrolls to it once it shows again, then forgets it. */
  revealPanelId: string | null
}

export interface GenerateActions {
  /** Opens the page with an empty draft in the project's default aspect. */
  open(request: GenerateRequest): void
  close(): void
  patch(p: Partial<GenerateDraft>): void
  /** Adds the character in its default look, or takes it out when it is already cast. */
  toggleCharacter(c: Character): void
  /** The twin of `toggleCharacter`. */
  toggleItem(i: Item): void
  /** Takes a chosen panel out of the references. */
  removeReference(panelId: string): void
  isDirty(): boolean
  /**
   * Makes the panel, drawing it when `draw` is set, then closes the page and selects the new panel. Rejects when
   * main refuses or there is nothing to draw from; the page stays open then.
   */
  submit(draw: boolean): Promise<void>
  clearReveal(): void
}

export const initialGenerateState: GenerateData = { request: null, draft: emptyDraft('2:3'), submitting: false, revealPanelId: null }

/** Counts opens and closes, so a create that returns after the page was left (and maybe reopened) can tell. */
let pageSeq = 0

export const useGenerateStore = create<GenerateData & GenerateActions>()((set, get) => ({
  ...initialGenerateState,

  open(request) {
    const { projectId, projects } = useAppStore.getState()
    const aspect = projects.find((p) => p.id === projectId)?.defaultAspect ?? '2:3'
    pageSeq++
    set({ request, draft: emptyDraft(aspect), submitting: false })
  },

  close() {
    pageSeq++
    set({ request: null, draft: emptyDraft('2:3'), submitting: false })
  },

  patch(p) {
    set((s) => ({ draft: { ...s.draft, ...p } }))
  },

  toggleCharacter(c) {
    set((s) => ({
      draft: { ...s.draft, characters: s.draft.characters.some((m) => m.characterId === c.id) ? s.draft.characters.filter((m) => m.characterId !== c.id) : [...s.draft.characters, newCastMember(c)] }
    }))
  },

  toggleItem(i) {
    set((s) => ({ draft: { ...s.draft, items: s.draft.items.some((u) => u.itemId === i.id) ? s.draft.items.filter((u) => u.itemId !== i.id) : [...s.draft.items, newItemUse(i)] } }))
  },

  removeReference(panelId) {
    set((s) => (s.request === null ? s : { request: { ...s.request, referencePanelIds: s.request.referencePanelIds.filter((id) => id !== panelId) } }))
  },

  isDirty() {
    return isDraftDirty(get().draft)
  },

  async submit(draw) {
    const { request, draft, submitting } = get()
    if (request === null || submitting) return
    if (draw && !canDraw(draft)) throw new Error('Describe the panel or write a prompt to generate it')
    const seq = pageSeq
    const projectId = useAppStore.getState().projectId
    set({ submitting: true })
    try {
      const { panel } = await usePanelsStore.getState().createPanel(toPanelDraft(request, draft), draw, draft.sketchPng ?? undefined)
      // The user may have left the page, or the project, while main made the panel: then it just exists on the strip.
      if (seq !== pageSeq || useAppStore.getState().projectId !== projectId) return
      set({ ...initialGenerateState, revealPanelId: panel.id })
      useAppStore.getState().selectPanel(panel.id)
    } catch (e) {
      if (seq === pageSeq) set({ submitting: false })
      throw e
    }
  },

  clearReveal() {
    set({ revealPanelId: null })
  }
}))
