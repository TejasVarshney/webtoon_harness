import { Fragment, useEffect, useRef, useState } from 'react'
import { ArrowLeft, ChevronLeft, ChevronRight, PencilLine } from 'lucide-react'
import { Group, Panel as Column, Separator } from 'react-resizable-panels'
import { staleVisualFields } from '@shared/visual-fields'
import { useAppStore } from '../../stores/app-store'
import { usePanelsStore } from '../../stores/panels-store'
import { errorText } from '../characters/controls'
import { PanelThread } from '../panel-chat/PanelThread'
import { VersionSwitcher } from '../panel-chat/VersionSwitcher'
import { PanelCheckBadge } from '../visualizer/PanelCheckBadge'
import { layoutStrip, rowShares } from '@shared/strip-layout'
import { PanelInspector } from './PanelInspector'
import { whenSaved } from './panel-save-queue'
import { PanelStage, type StylePreview } from './PanelStage'
import { SketchStage } from './SketchStage'
import { staleNotice } from './stale-notice'

export interface PanelWorkspaceProps {
  panelId: string
}

/**
 * Leaves focus mode for the strip, and focuses again the card of the panel that was open. The selection stays. The
 * strip is inert until the overlay is gone, so the focus waits a frame.
 */
function backToStrip(): void {
  const id = useAppStore.getState().focusedPanelId
  useAppStore.getState().focusPanel(null)
  if (id !== null) requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-panel-id="${id}"]`)?.focus())
}

/**
 * Focus mode: one panel over the whole sheet, the panel and its controls on the left and its chat on the right. The
 * strip's tools on a selected panel cover most edits in place; this is for the larger stage, the zoom and the chat.
 * The stage shows the panel, or in sketch mode (Sketch, a panel never drawn, or the strip's Sketch tool) a canvas for a
 * rough layout sketch that the next generation follows.
 * The panel comes from the open episode's strip, so the agent's edits show here as they land. A panel that leaves the
 * episode keeps the frame and the way back: nothing closes by itself, and nothing is saved for it.
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
  // The selected line, by index: a bubble on the stage or a row of Lines, each following the other. It belongs to the
  // panel it was chosen on, so stepping to another panel starts with none.
  const [lineSelection, setLineSelection] = useState<{ panelId: string; index: number | null } | null>(null)
  // A style picked in Lines and not saved yet, which the stage draws meanwhile. It too belongs to the panel it was picked on.
  const [previewState, setPreviewState] = useState<{ panelId: string; preview: StylePreview | null } | null>(null)
  // Sketch mode, as the user last chose it for this panel. Until they choose, a panel that was never drawn opens on its
  // sketch, and one with an attempt (pending, failed or ready) shows that attempt. The strip's Sketch tool chooses it
  // for the panel it opens (see `focusSketch`).
  const [sketchChoice, setSketchChoice] = useState<{ panelId: string; on: boolean } | null>(() => (useAppStore.getState().focusSketch ? { panelId, on: true } : null))
  // The stage's zoom, relative to the fit: one per open panel, kept when the stage switches between picture and sketch.
  const [zoomState, setZoomState] = useState<{ panelId: string; zoom: number } | null>(null)

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
  const selectedLine = lineSelection?.panelId === panelId ? lineSelection.index : null
  const stylePreview = previewState?.panelId === panelId ? previewState.preview : null
  const zoom = zoomState?.panelId === panelId ? zoomState.zoom : 1
  const setZoom = (next: number): void => setZoomState({ panelId, zoom: next })
  const sketching = panel !== undefined && (sketchChoice?.panelId === panelId ? sketchChoice.on : panel.versions.length === 0)
  // Laid out as in the strip: its share of its row, and the way it leans there.
  const row = panel === undefined ? undefined : layoutStrip(panels ?? []).find((r) => r.panels.some((p) => p.id === panel.id))
  const share = panel === undefined || row === undefined ? 1 : rowShares(row.panels)[panel.id]
  const slant = panel === undefined ? undefined : row?.slants[panel.id]

  // Opening the editor takes the focus from the card, which goes inert under it: Back has it, so the next Tab stays in
  // the editor. Stepping with ‹ › keeps the same workspace, so it leaves the focus where the user put it.
  const back = useRef<HTMLButtonElement>(null)
  useEffect(() => back.current?.focus(), [])

  // The request is used up by opening, so a later plain Focus opens on the picture.
  useEffect(() => {
    if (useAppStore.getState().focusSketch) useAppStore.setState({ focusSketch: false })
  }, [])

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

  /**
   * Runs `task` for the panel once its saves have settled, so a redraw or an upload never works from fields still being
   * saved. A refused save stops it, and is said here as well as by its field.
   */
  function run(id: string, task: () => Promise<unknown>): void {
    setAction({ panelId: id, busy: true, error: null })
    const settle = (error: string | null): void => setAction((a) => (a?.panelId === id ? { panelId: id, busy: false, error } : a))
    whenSaved(id)
      .then(task)
      .then(
        () => settle(null),
        (e: unknown) => settle(errorText(e))
      )
  }

  // Drawing shows the attempt it starts, whichever mode the stage was in.
  const regenerate = (id: string): void => {
    setSketchChoice(null)
    run(id, () => usePanelsStore.getState().generatePanel(id))
  }
  const select = (id: string): void => useAppStore.getState().focusPanel(id)
  const selectLine = (index: number | null): void => setLineSelection({ panelId, index })
  const previewStyle = (preview: StylePreview | null): void => setPreviewState({ panelId, preview })

  return (
    <section className="panel-workspace" data-testid="panel-workspace" aria-label="Focus mode">
      <Group orientation="horizontal" className="editing-columns">
        <Column id="workspace-editor" defaultSize="64%" minSize="40%">
          <div className="editing-main">
            <header className="editing-header" data-testid="workspace-header">
              <button ref={back} type="button" className="editing-back" aria-label="Back to the strip" onClick={backToStrip}>
                <ArrowLeft size={16} aria-hidden="true" />
                Back to the strip
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
                    {/* Keyed, so a revert that failed or is still running stays with the panel it ran for. */}
                    <VersionSwitcher key={panel.id} panel={panel} />
                    <PanelCheckBadge panel={panel} />
                    <button type="button" aria-pressed={sketching} title="Scribble the scene as a layout guide for the image" onClick={() => setSketchChoice({ panelId: panel.id, on: !sketching })}>
                      <PencilLine size={14} aria-hidden="true" />
                      Sketch
                    </button>
                    <button type="button" disabled={busy} onClick={() => run(panel.id, () => usePanelsStore.getState().uploadPanelImage(panel.id))}>
                      Upload image…
                    </button>
                    <button type="button" className="btn-primary" disabled={busy || generating} onClick={() => regenerate(panel.id)}>
                      {panel.versions.length === 0 ? 'Generate' : 'Regenerate'}
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
              <div className="stale-notice-row">
                <p className="stale-notice" data-testid="stale-notice">
                  {notice}
                  <button type="button" disabled={busy || generating} onClick={() => regenerate(panel.id)}>
                    Regenerate
                  </button>
                </p>
              </div>
            )}
            <div className="editing-body">
              {panel !== undefined ? (
                // Each panel gets its own stage and tabs, keyed together, so nothing of one panel's editing carries to the
                // next, and what is still waiting to save is saved when the user steps away or goes back.
                <Fragment key={panel.id}>
                  {sketching ? (
                    <SketchStage panel={panel} share={share} slant={slant} zoom={zoom} onZoom={setZoom} />
                  ) : (
                    <PanelStage panel={panel} share={share} slant={slant} selectedLine={selectedLine} onSelectLine={selectLine} zoom={zoom} onZoom={setZoom} stylePreview={stylePreview} />
                  )}
                  <PanelInspector panel={panel} selectedLine={selectedLine} onSelectLine={selectLine} onPreviewStyle={previewStyle} />
                </Fragment>
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
