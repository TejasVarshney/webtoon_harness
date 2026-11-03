import { useEffect, useState } from 'react'
import { ArrowLeft, ChevronLeft, ChevronRight } from 'lucide-react'
import { Group, Panel as Column, Separator } from 'react-resizable-panels'
import { staleVisualFields } from '@shared/visual-fields'
import { useAppStore } from '../../stores/app-store'
import { usePanelsStore } from '../../stores/panels-store'
import { errorText } from '../characters/controls'
import { PanelThread } from '../panel-chat/PanelThread'
import { VersionSwitcher } from '../panel-chat/VersionSwitcher'
import { PanelArt } from '../visualizer/PanelArt'
import { staleNotice } from './stale-notice'

export interface PanelWorkspaceProps {
  panelId: string
}

/**
 * Leaves editing mode for the strip, and focuses again the card of the panel that was open (R4). The strip is inert
 * until the overlay is gone, so the focus waits a frame.
 */
function backToStrip(): void {
  const id = useAppStore.getState().selectedPanelId
  useAppStore.getState().selectPanel(null)
  if (id !== null) requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-panel-id="${id}"]`)?.focus())
}

/**
 * Editing mode: one panel over the whole sheet, the panel and its controls on the left and its chat on the right.
 * The panel comes from the open episode's strip, so the agent's edits show here as they land. A panel that leaves the
 * episode keeps the frame and the way back (R2): nothing closes by itself, and nothing is saved for it.
 * Back, or Escape, returns to the strip.
 */
export function PanelWorkspace({ panelId }: PanelWorkspaceProps) {
  const projectId = useAppStore((s) => s.projectId)
  const activeEpisodeId = useAppStore((s) => s.activeEpisodeId)
  const storeProjectId = usePanelsStore((s) => s.projectId)
  const episodesLoaded = usePanelsStore((s) => s.episodesLoaded)
  const loadError = usePanelsStore((s) => s.error)
  const panels = usePanelsStore((s) => (activeEpisodeId === null ? undefined : s.panelsByEpisode[activeEpisodeId]))
  // Upload and Regenerate belong to the panel they ran for: stepping to the next panel leaves their failure behind.
  const [action, setAction] = useState<{ panelId: string; busy: boolean; error: string | null } | null>(null)

  // Panels of another project must never show here, whatever the store still holds.
  const loaded = storeProjectId === projectId && episodesLoaded && (activeEpisodeId === null || panels !== undefined)
  const index = loaded && panels !== undefined ? panels.findIndex((p) => p.id === panelId) : -1
  const panel = index === -1 ? undefined : panels?.[index]
  const previous = index > 0 ? panels?.[index - 1] : undefined
  const next = index === -1 ? undefined : panels?.[index + 1]
  const generating = panel?.versions.at(-1)?.status === 'pending'
  const notice = panel === undefined ? null : staleNotice(staleVisualFields(panel))
  const busy = action?.panelId === panelId && action.busy
  const error = action?.panelId === panelId ? action.error : null

  // A panel opened from a chat thumbnail can arrive before the Webtoon tab ever loaded the strip.
  useEffect(() => {
    if (projectId !== null && !loaded) void usePanelsStore.getState().loadEpisodes()
  }, [projectId, loaded])

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent): void {
      if (e.key !== 'Escape' || e.defaultPrevented || e.isComposing) return
      // A dialog (settings, a confirmation) owns Escape while it is open, and so does any field with focus: the
      // composer, a bubble's text, a rename box.
      if (document.querySelector('[role="dialog"]') !== null) return
      const target = e.target
      if (target instanceof Element && target.closest('input, select, textarea, [contenteditable]') !== null) return
      backToStrip()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [])

  function run(id: string, task: Promise<unknown>): void {
    setAction({ panelId: id, busy: true, error: null })
    const settle = (error: string | null): void => setAction((a) => (a?.panelId === id ? { panelId: id, busy: false, error } : a))
    task.then(
      () => settle(null),
      (e: unknown) => settle(errorText(e))
    )
  }

  const regenerate = (id: string): void => run(id, usePanelsStore.getState().generatePanel(id))
  const select = (id: string): void => useAppStore.getState().selectPanel(id)

  return (
    <section className="panel-workspace" data-testid="panel-workspace" aria-label="Panel editor">
      <Group orientation="horizontal" className="editing-columns">
        <Column id="workspace-editor" defaultSize="64%" minSize="40%">
          <div className="editing-main">
            <header className="editing-header" data-testid="workspace-header">
              <button type="button" className="editing-back" aria-label="Back to the strip" onClick={backToStrip}>
                <ArrowLeft size={16} aria-hidden="true" />
                Strip
              </button>
              {panel !== undefined && panels !== undefined && (
                <>
                  <h1>{`Panel ${index + 1} of ${panels.length}`}</h1>
                  <div className="editing-steps" role="group" aria-label="Panels">
                    <button type="button" className="icon-button" aria-label="Previous panel" disabled={previous === undefined} onClick={() => previous !== undefined && select(previous.id)}>
                      <ChevronLeft size={16} aria-hidden="true" />
                    </button>
                    <button type="button" className="icon-button" aria-label="Next panel" disabled={next === undefined} onClick={() => next !== undefined && select(next.id)}>
                      <ChevronRight size={16} aria-hidden="true" />
                    </button>
                  </div>
                  <div className="editing-actions">
                    <VersionSwitcher panel={panel} />
                    <button type="button" disabled={busy} onClick={() => run(panel.id, usePanelsStore.getState().uploadPanelImage(panel.id))}>
                      Upload image…
                    </button>
                    <button type="button" className="btn-primary" disabled={busy || generating} onClick={() => regenerate(panel.id)}>
                      Regenerate
                    </button>
                  </div>
                </>
              )}
            </header>
            {error !== null && (
              <p role="alert" className="error editing-error">
                {error}
              </p>
            )}
            {panel !== undefined && notice !== null && (
              <p className="stale-notice" data-testid="stale-notice">
                {notice}
                <button type="button" disabled={busy || generating} onClick={() => regenerate(panel.id)}>
                  Regenerate
                </button>
              </p>
            )}
            <div className="editing-body">
              {panel !== undefined ? (
                <>
                  {/* The stage. Each panel gets its own, so nothing of one panel's editing carries to the next. */}
                  <div className="panel-stage" key={panel.id}>
                    <PanelArt panel={panel} />
                  </div>
                  {/* The inspector (Lines, Cast, Items, Scene) goes here, under the stage. */}
                </>
              ) : loaded ? (
                <p className="placeholder">Panel not in the current episode</p>
              ) : loadError !== null ? (
                <p role="alert" className="error">
                  {loadError}
                </p>
              ) : (
                <p className="placeholder">Loading panel…</p>
              )}
            </div>
          </div>
        </Column>
        <Separator className="pane-separator pane-separator-sheet" />
        <Column id="workspace-chat" defaultSize="36%" minSize="26%">
          <section className="editing-chat" aria-label="Panel chat">
            <header className="editing-chat-header">
              <h2>Panel chat</h2>
            </header>
            {/* Keyed so each panel starts with its own composer text and thread. */}
            {panel !== undefined && projectId !== null && <PanelThread key={panel.id} projectId={projectId} panelId={panel.id} />}
          </section>
        </Column>
      </Group>
    </section>
  )
}
