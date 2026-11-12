import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Crop, History, LayoutTemplate, Maximize2, MessageSquare, PencilLine, RefreshCw, Trash2, Upload, type LucideIcon } from 'lucide-react'
import type { BubbleShape, Panel } from '@shared/types'
import { useAppStore } from '../../stores/app-store'
import { usePanelsStore } from '../../stores/panels-store'
import { errorText } from '../characters/controls'
import { AddBubbleMenu } from '../panel-editor/AddBubbleMenu'
import { PanelInspector, type InspectorTab } from '../panel-editor/PanelInspector'
import { whenSaved } from '../panel-editor/panel-save-queue'
import { VersionSwitcher } from '../panel-chat/VersionSwitcher'
import { croppable, CropDialog } from './CropDialog'
import { PanelLayout } from './PanelLayout'
import { ToolPopover, type Rect } from './ToolPopover'

type Tool = Extract<InspectorTab, 'lines'> | 'versions' | 'layout'

/** The tools that open a popover, in the order of the bar. */
const POPOVER_TOOLS: { id: Tool; label: string; Icon: LucideIcon }[] = [{ id: 'lines', label: 'Lines', Icon: MessageSquare }]

export interface PanelToolsProps {
  panel: Panel
  /** The line whose bubble is selected on the strip, which Lines opens on. */
  selectedLine: number | null
  onSelectLine(i: number | null): void
  /** A click on a bubble (new each time) opens Lines on its line; a drag of it does not. */
  linesRequest: { index: number } | null
  /** The Add bubble menu's choice, and whether a new bubble is being typed (the menu waits for it). */
  onAddBubble(shape: BubbleShape): void
  addingBubble: boolean
}

/**
 * The tools on a selected panel, so most edits happen where the panel sits: the lines in a popover, a crop, the
 * versions, the layout (arranging panels, shape and width), an upload, a redraw, the sketch, focus mode and delete. Lines is focus mode's Lines tab, and saves the same way;
 * the cast, items and scene are in focus mode's other tabs. Sketch and Focus open focus mode, whose stage is larger.
 * Clicking a bubble on the strip opens Lines on its line, and Add bubble adds one to the panel.
 * Nothing here is a press on the card: clicks, double clicks and presses stop at it, popovers and dialog included, so
 * they neither select, open, drag nor clear the selection on the strip.
 */
export function PanelTools({ panel, selectedLine, onSelectLine, linesRequest, onAddBubble, addingBubble }: PanelToolsProps) {
  const [open, setOpen] = useState<{ tool: Tool; anchor: HTMLElement; quiet?: boolean } | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [cropping, setCropping] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const root = useRef<HTMLDivElement>(null)
  const linesButton = useRef<HTMLButtonElement>(null)
  // Where its bar sits along the card: centred under it, kept inside the strip so a narrow panel at an edge keeps its tools in reach.
  const [shift, setShift] = useState(0)
  const generating = panel.versions.at(-1)?.status === 'pending'
  const current = panel.versions.find((v) => v.id === panel.currentVersionId)
  const picture = current?.status === 'ready' && current.imagePath !== null ? { versionId: current.id, imagePath: current.imagePath } : null
  const canCrop = picture !== null && croppable(picture.imagePath)

  useLayoutEffect(() => {
    const bar = root.current
    const card = bar?.parentElement
    const canvas = card?.closest('.strip-canvas')
    if (!bar || !card || !canvas) return
    const canvasRect = canvas.getBoundingClientRect()
    const scale = canvasRect.width > 0 && canvas instanceof HTMLElement && canvas.offsetWidth > 0 ? canvasRect.width / canvas.offsetWidth : 0
    if (scale === 0) return
    const cardRect = card.getBoundingClientRect()
    const width = bar.getBoundingClientRect().width
    const wanted = Math.max(canvasRect.left, Math.min(cardRect.left + cardRect.width / 2 - width / 2, canvasRect.right - width))
    const next = Math.round((wanted - cardRect.left) / scale)
    setShift((now) => (now === next ? now : next))
  })

  /** Runs `task` once the panel's saves have settled, so a redraw or an upload never works from fields still being saved. */
  function run(task: () => Promise<unknown>): void {
    setBusy(true)
    setError(null)
    whenSaved(panel.id)
      .then(task)
      .then(
        () => setBusy(false),
        (e: unknown) => {
          setError(errorText(e))
          setBusy(false)
        }
      )
  }

  // Clicking a bubble opens Lines on its line, once the press is over: a drag never opens it, so it cannot cover where the
  // bubble is going. It keeps the focus on the bubble, so its arrow keys, Enter and Delete work.
  useEffect(() => {
    if (linesRequest === null) return
    setOpen((now) => (now?.tool === 'lines' || linesButton.current === null ? now : { tool: 'lines', anchor: linesButton.current, quiet: true }))
  }, [linesRequest])

  /** The selected bubble's box, for a popover to keep clear of. */
  const selectedBubble = (): Rect | null => root.current?.closest('.strip-bubbles')?.querySelector('.bubble[data-selected="true"]')?.getBoundingClientRect() ?? null

  function toggle(tool: Tool, anchor: HTMLElement): void {
    // A line chosen in an earlier popover must not send this one to Lines.
    if (tool !== 'lines') onSelectLine(null)
    setOpen((now) => (now?.tool === tool ? null : { tool, anchor }))
  }

  function close(focusBack: boolean): void {
    const anchor = open?.anchor
    setOpen(null)
    if (focusBack) anchor?.focus()
  }

  const pressed = (tool: Tool): boolean => open?.tool === tool

  return (
    // Stopped here, in the React tree, which the popovers and the dialog (portals) share with the bar.
    <div
      ref={root}
      className="panel-tools"
      style={{ left: shift }}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div className="panel-tools-bar" role="toolbar" aria-label="Panel tools">
        {POPOVER_TOOLS.map(({ id, label, Icon }) => (
          <button key={id} ref={id === 'lines' ? linesButton : undefined} type="button" className="icon-button" aria-label={label} title={label} aria-haspopup="dialog" aria-expanded={pressed(id)} onClick={(e) => toggle(id, e.currentTarget)}>
            <Icon size={15} aria-hidden="true" />
          </button>
        ))}
        <button
          type="button"
          className="icon-button"
          aria-label="Crop"
          title={picture === null ? 'Crop (the panel has no picture yet)' : canCrop ? 'Crop' : "Crop (a WebP or GIF picture can't be cropped)"}
          disabled={busy || generating || !canCrop}
          onClick={() => setCropping(true)}
        >
          <Crop size={15} aria-hidden="true" />
        </button>
        <button type="button" className="icon-button" aria-label="Versions" title="Versions" aria-haspopup="dialog" aria-expanded={pressed('versions')} onClick={(e) => toggle('versions', e.currentTarget)}>
          <History size={15} aria-hidden="true" />
        </button>
        <button type="button" className="icon-button" aria-label="Layout" title="Layout: arrange panels, shape and width" aria-haspopup="dialog" aria-expanded={pressed('layout')} onClick={(e) => toggle('layout', e.currentTarget)}>
          <LayoutTemplate size={15} aria-hidden="true" />
        </button>
        <AddBubbleMenu disabled={addingBubble} onAdd={onAddBubble} />
        <span className="panel-tools-divider" aria-hidden="true" />
        <button type="button" className="icon-button" aria-label="Upload image" title="Upload image" disabled={busy} onClick={() => run(() => usePanelsStore.getState().uploadPanelImage(panel.id))}>
          <Upload size={15} aria-hidden="true" />
        </button>
        <button type="button" className="icon-button" aria-label="Redraw" title="Redraw" disabled={busy || generating} onClick={() => run(() => usePanelsStore.getState().generatePanel(panel.id))}>
          <RefreshCw size={15} aria-hidden="true" />
        </button>
        <button type="button" className="icon-button" aria-label="Sketch" title="Sketch a layout for the next image, in focus mode" onClick={() => useAppStore.getState().focusPanel(panel.id, { sketch: true })}>
          <PencilLine size={15} aria-hidden="true" />
        </button>
        <button type="button" className="icon-button" aria-label="Focus" title="Focus mode" onClick={() => useAppStore.getState().focusPanel(panel.id)}>
          <Maximize2 size={15} aria-hidden="true" />
        </button>
        <span className="panel-tools-divider" aria-hidden="true" />
        <button type="button" className="icon-button icon-button-danger" aria-label="Delete" title="Delete panel" disabled={busy} onClick={() => setConfirming(true)}>
          <Trash2 size={15} aria-hidden="true" />
        </button>
      </div>
      {error !== null && (
        <p role="alert" className="error panel-tools-error">
          {error}
        </p>
      )}

      {open !== null && (
        <ToolPopover key={open.tool} label={open.tool === 'lines' ? 'Lines' : open.tool === 'layout' ? 'Layout' : 'Versions'} anchor={open.anchor} onClose={close} quiet={open.quiet} avoid={selectedBubble}>
          {open.tool === 'versions' ? (
            <VersionSwitcher panel={panel} />
          ) : open.tool === 'layout' ? (
            <PanelLayout panel={panel} />
          ) : (
            <PanelInspector panel={panel} only="lines" selectedLine={selectedLine} onSelectLine={onSelectLine} />
          )}
        </ToolPopover>
      )}

      {cropping && picture !== null && <CropDialog panel={panel} versionId={picture.versionId} imagePath={picture.imagePath} onClose={() => setCropping(false)} />}

      {confirming &&
        createPortal(
          <div className="modal-backdrop" onClick={(e) => e.stopPropagation()}>
            <div className="modal" role="dialog" aria-label="Delete panel">
              <p>Delete this panel? It moves to the trash.</p>
              <div className="modal-actions">
                <button type="button" onClick={() => setConfirming(false)}>
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn-danger"
                  onClick={() => {
                    setConfirming(false)
                    run(() => usePanelsStore.getState().deletePanel(panel.id))
                  }}
                >
                  Delete panel
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}
    </div>
  )
}
