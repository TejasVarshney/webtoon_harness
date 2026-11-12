import type { Panel, PanelPatch, StripBackground, StripLayout } from '@shared/types'
import { api } from '../../api'
import { useAppStore } from '../../stores/app-store'
import { usePanelsStore } from '../../stores/panels-store'
import { canonical, flushPendingEdits, useStripHistoryStore, whenTracked, type Direction, type StepOutcome, type StripFields, type StripStep } from '../../stores/strip-history-store'
import { errorText } from '../characters/controls'
import { toDrafts } from '../panel-editor/dialogue-edits'
import { queuePanelRestore, whenAllSaved } from '../panel-editor/panel-save-queue'

// Applying a step of the strip's history. Every write here goes through a path that records nothing, and every step is
// first checked against the strip as main has it now: what it touches must still be as the step left it.

type Applied = 'done' | 'stale'

const same = (a: unknown, b: unknown): boolean => canonical(a) === canonical(b)

/** The panel's values of the fields a step holds. */
function fieldsOf(panel: Panel, like: StripFields): StripFields {
  return Object.fromEntries(Object.keys(like).map((field) => [field, panel[field as keyof StripFields]]))
}

/** A patch that stores `fields` exactly: a dialogue line's placement, style and tail are sent even when null, so none is inherited. */
function patchOf(fields: StripFields): PanelPatch {
  const { dialogue, ...rest } = fields
  return dialogue === undefined ? rest : { ...rest, dialogue: toDrafts(dialogue) }
}

async function applyPlace(projectId: string, episodeId: string, expected: StripLayout, target: StripLayout): Promise<Applied> {
  const episode = (await api.invoke('episodes:list', { projectId })).find((e) => e.id === episodeId)
  if (episode === undefined) return 'stale'
  const panels = await api.invoke('panels:list', { projectId, episodeId })
  const now: StripLayout = { order: episode.panelIds, placements: Object.fromEntries(panels.map((p) => [p.id, p.placement])) }
  if (!same(now, expected)) return 'stale'
  await api.invoke('panels:restoreLayout', { projectId, episodeId, layout: target })
  await usePanelsStore.getState().load(episodeId)
  return 'done'
}

async function applyFields(projectId: string, panelId: string, expected: StripFields, target: StripFields): Promise<Applied> {
  const applied = await queuePanelRestore(panelId, async () => {
    const panel = await api.invoke('panels:get', { projectId, panelId })
    if (!same(fieldsOf(panel, expected), expected)) return { result: 'stale' as const, panel: null }
    const updated = await usePanelsStore.getState().updatePanel(panelId, patchOf(target))
    return { result: 'done' as const, panel: updated.panel }
  })
  return applied ?? 'stale'
}

async function applyPicture(projectId: string, panelId: string, expected: { versionId: string; aspect: Panel['aspect'] }, target: typeof expected): Promise<Applied> {
  const applied = await queuePanelRestore(panelId, async () => {
    const panel = await api.invoke('panels:get', { projectId, panelId })
    if (panel.currentVersionId !== expected.versionId || panel.aspect !== expected.aspect) return { result: 'stale' as const, panel: null }
    let now = await api.invoke('panels:revert', { projectId, panelId, versionId: target.versionId })
    // A crop changed the shape in the same save, so its undo puts the shape back too.
    if (now.aspect !== target.aspect) now = (await api.invoke('panels:update', { projectId, panelId, patch: { aspect: target.aspect } })).panel
    await usePanelsStore.getState().load(now.episodeId)
    return { result: 'done' as const, panel: now }
  })
  return applied ?? 'stale'
}

async function applyBackground(projectId: string, episodeId: string, expected: StripBackground | null, target: StripBackground | null): Promise<Applied> {
  const episode = (await api.invoke('episodes:list', { projectId })).find((e) => e.id === episodeId)
  if (episode === undefined || !same(episode.background, expected)) return 'stale'
  await api.invoke('episodes:setBackground', { projectId, episodeId, background: target })
  await usePanelsStore.getState().loadEpisodes()
  return 'done'
}

/** Puts the strip from what `step` left (`from`) to its other side (`to`). */
function apply(projectId: string, step: StripStep, direction: Direction): Promise<Applied> {
  const [from, to] = direction === 'undo' ? (['after', 'before'] as const) : (['before', 'after'] as const)
  switch (step.kind) {
    case 'place':
      return applyPlace(projectId, step.episodeId, step[from], step[to])
    case 'fields':
      return applyFields(projectId, step.panelId, step[from], step[to])
    case 'picture':
      return applyPicture(projectId, step.panelId, step[from], step[to])
    case 'background':
      return applyBackground(projectId, step.episodeId, step[from], step[to])
  }
}

/** Brings the panel a step changed into view when it is off screen; the selection stays as it is. */
function reveal(step: StripStep): void {
  const panelId = step.kind === 'place' ? step.panelIds[0] : step.kind === 'background' ? undefined : step.panelId
  if (panelId === undefined) return
  requestAnimationFrame(() => {
    document.querySelector(`[data-testid="panel-card"][data-panel-id="${panelId}"]`)?.scrollIntoView?.({ block: 'nearest' })
  })
}

/**
 * Undoes or redoes the episode's next step. It first waits for the saves still on their way, then runs alone: while it
 * does, another call does nothing. A step whose strip changed since empties the episode's history; one the service
 * refuses stays, and the bar shows why.
 */
export async function stepStrip(direction: Direction, episodeId: string): Promise<void> {
  const projectId = useAppStore.getState().projectId
  if (projectId === null || useStripHistoryStore.getState().busy) return
  // Busy before the wait, so a second press while saves land is not a second step. The step is taken only after the
  // wait: a change whose save is still on its way is recorded when it lands, and it is the one to undo.
  useStripHistoryStore.setState({ busy: true })
  flushPendingEdits()
  await Promise.all([whenAllSaved(), whenTracked()])
  useStripHistoryStore.setState({ busy: false })
  // The project closed meanwhile: its history is gone, and so is the step.
  if (useAppStore.getState().projectId !== projectId) return
  const step = useStripHistoryStore.getState().begin(direction, episodeId)
  if (step === null) return
  let outcome: StepOutcome
  try {
    outcome = { kind: await apply(projectId, step, direction) }
  } catch (e) {
    outcome = { kind: 'refused', error: errorText(e) }
  }
  useStripHistoryStore.getState().finish(direction, step, outcome)
  if (outcome.kind === 'done') reveal(step)
}
