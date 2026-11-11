import fs from 'node:fs'
import type { Panel, PanelDraft, PanelPatch } from '@shared/types'
import type { ProjectContext } from '../storage/project-store'
import { tryReadPanel } from './panel-files'

// How the user's per-panel choices (panels as references, a style, a prompt) reach a draw. Their own file to keep
// `panel-service.ts` under the size limit.

/** The choices a new panel starts with, each referenced panel once; the schema fills what the draft leaves out. */
export function drawChoicesOf(draft: PanelDraft): Pick<Panel, 'referencePanelIds' | 'styleOverride' | 'promptOverride'> {
  return { referencePanelIds: [...new Set(draft.referencePanelIds ?? [])], styleOverride: draft.styleOverride ?? null, promptOverride: draft.promptOverride ?? null }
}

/**
 * The choices after a patch: a field the patch leaves out keeps its stored value. The panel never lists itself, and
 * a panel is listed once.
 */
export function mergeDrawChoices(patch: PanelPatch, current: Panel): Pick<Panel, 'referencePanelIds' | 'styleOverride' | 'promptOverride'> {
  const ids = patch.referencePanelIds ?? current.referencePanelIds
  return {
    referencePanelIds: [...new Set(ids)].filter((id) => id !== current.id),
    styleOverride: patch.styleOverride === undefined ? current.styleOverride : patch.styleOverride,
    promptOverride: patch.promptOverride === undefined ? current.promptOverride : patch.promptOverride
  }
}

/**
 * The current pictures of the panels the user chose, in their order, each once. A panel that is gone, has no ready picture, or
 * whose file is missing is left out: the draw goes on without it.
 */
export async function readReferencePanels(ctx: ProjectContext, panel: Pick<Panel, 'id' | 'referencePanelIds'>): Promise<{ panelId: string; imagePath: string }[]> {
  const found: { panelId: string; imagePath: string }[] = []
  for (const id of new Set(panel.referencePanelIds)) {
    if (id === panel.id) continue
    const chosen = await tryReadPanel(ctx, id)
    const current = chosen?.versions.find((v) => v.id === chosen.currentVersionId)
    if (!chosen || current?.status !== 'ready' || !current.imagePath) continue
    if (fs.existsSync(ctx.paths.resolveAsset(current.imagePath))) found.push({ panelId: id, imagePath: current.imagePath })
  }
  return found
}

/** The style this panel is drawn in: its own, or the project's. A blank own style is none. */
export function styleOf(panel: Pick<Panel, 'styleOverride'>, projectStyle: string): string {
  return panel.styleOverride?.trim() || projectStyle
}

/** What a draw sends: the user's own prompt in place of the composed one (a blank one is none), and either way the fix line after a failed check. */
export function drawPrompt(composed: string, panel: Pick<Panel, 'promptOverride'>, fix: string | undefined): string {
  const own = panel.promptOverride?.trim()
  const base = own || composed
  return fix && fix.trim() ? `${base}\n[FIX] ${fix}` : base
}
