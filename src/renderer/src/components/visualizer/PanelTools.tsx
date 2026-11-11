import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { History, Maximize2, MessageSquare, MapPin, Package, PencilLine, RefreshCw, Trash2, Upload, Users, type LucideIcon } from 'lucide-react'
import type { BubbleShape, Panel } from '@shared/types'
import { useAppStore } from '../../stores/app-store'
import { usePanelsStore } from '../../stores/panels-store'
import { errorText } from '../characters/controls'
import { AddBubbleMenu } from '../panel-editor/AddBubbleMenu'
import { PanelInspector, type InspectorTab } from '../panel-editor/PanelInspector'
import { whenSaved } from '../panel-editor/panel-save-queue'
import { VersionSwitcher } from '../panel-chat/VersionSwitcher'

type Tool = InspectorTab | 'versions'

/** The tools that open a popover, in the order of the bar. */
const POPOVER_TOOLS: { id: Tool; label: string; Icon: LucideIcon }[] = [
  { id: 'lines', label: 'Lines', Icon: MessageSquare },
  { id: 'cast', label: 'Cast', Icon: Users },
  { id: 'items', label: 'Items', Icon: Package },
  { id: 'scene', label: 'Scene', Icon: MapPin }
]

const POPOVER_WIDTH = 340
const POPOVER_MARGIN = 8
/** The room under or over a button that is enough to open there, before the side with more room is taken. */
const POPOVER_COMFORT = 280
const MIN_POPOVER_HEIGHT = 120

/** Where a popover sits for the button it opens from: fixed to the window, so neither the strip nor the pane can clip it. */
function spotFor(button: Element): { left: number; top?: number; bottom?: number; maxHeight: number; width: number } {
  const rect = button.getBoundingClientRect()
  const width = Math.min(POPOVER_WIDTH, window.innerWidth - 2 * POPOVER_MARGIN)
  const left = Math.max(POPOVER_MARGIN, Math.min(rect.left + rect.width / 2 - width / 2, window.innerWidth - width - POPOVER_MARGIN))
  const below = window.innerHeight - rect.bottom - POPOVER_MARGIN - 4
  const above = rect.top - POPOVER_MARGIN - 4
  // A button scrolled out of the window keeps the popover inside it, at the edge it left by.
  const room = (edge: number): number => Math.max(POPOVER_MARGIN, Math.min(edge, window.innerHeight - MIN_POPOVER_HEIGHT - POPOVER_MARGIN))
  const topEdge = room(rect.bottom + 4)
  const bottomEdge = room(window.innerHeight - rect.top + 4)
  return below >= POPOVER_COMFORT || below >= above
    ? { left, width, top: topEdge, maxHeight: Math.max(window.innerHeight - topEdge - POPOVER_MARGIN, MIN_POPOVER_HEIGHT) }
    : { left, width, bottom: bottomEdge, maxHeight: Math.max(window.innerHeight - bottomEdge - POPOVER_MARGIN, MIN_POPOVER_HEIGHT) }
}

interface ToolPopoverProps {
  label: string
  anchor: Element
  /** Where its button's card is along the strip, so it is placed again when the bar moves. */
  shift: number
  /** Closes it, and `focusBack` says the focus should return to the button that opened it. */
  onClose(focusBack: boolean): void
  /** Opened by selecting a bubble, which keeps the focus for its keys: the popover does not take it. */
  quiet?: boolean
  children: ReactNode
}

/** A panel of controls beside a tool's button, in the window's own layer. A press elsewhere or Escape closes it. */
function ToolPopover({ label, anchor, shift, onClose, quiet = false, children }: ToolPopoverProps) {
  const ref = useRef<HTMLDivElement>(null)
  const [spot, setSpot] = useState(() => spotFor(anchor))

  // The first focus goes in, so the next Tab is in the controls: the popover is at the end of the page, not by its button.
  useEffect(() => {
    if (!quiet) ref.current?.focus({ preventScroll: true })
  }, [quiet])
  // The bar slides along the card when the card is moved or the strip is resized: the button is somewhere else now.
  useLayoutEffect(() => setSpot(spotFor(anchor)), [anchor, shift])

  useEffect(() => {
    function onPress(e: PointerEvent): void {
      const target = e.target
      // The panel's own bubbles are not outside it: pressing one is choosing the line it shows.
      if (target instanceof Node && (ref.current?.contains(target) || anchor.closest('.strip-bubbles')?.contains(target))) return
      onClose(false)
    }
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape' && !e.defaultPrevented && !e.isComposing) onClose(true)
    }
    // It follows its button when the strip scrolls or the window is resized. Its own list scrolling is not the strip's.
    const follow = (e: Event): void => {
      if (e.target instanceof Node && ref.current?.contains(e.target)) return
      setSpot(spotFor(anchor))
    }
    document.addEventListener('pointerdown', onPress, true)
    document.addEventListener('keydown', onKey)
    window.addEventListener('scroll', follow, true)
    window.addEventListener('resize', follow)
    return () => {
      document.removeEventListener('pointerdown', onPress, true)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('scroll', follow, true)
      window.removeEventListener('resize', follow)
    }
  }, [anchor, onClose])

  const { left, top, bottom, maxHeight, width } = spot
  return createPortal(
    <div ref={ref} className="tool-popover" role="dialog" aria-label={label} tabIndex={-1} style={{ left, top, bottom, width, maxHeight }}>
      {children}
    </div>,
    document.body
  )
}

export interface PanelToolsProps {
  panel: Panel
  /** The line whose bubble is selected on the strip, which Lines opens on. */
  selectedLine: number | null
  onSelectLine(i: number | null): void
  /** The Add bubble menu's choice, and whether a new bubble is being typed (the menu waits for it). */
  onAddBubble(shape: BubbleShape): void
  addingBubble: boolean
}

/**
 * The tools on a selected panel, so most edits happen where the panel sits: the lines, cast, items and scene in a
 * popover each, the versions, an upload, a redraw, the sketch, focus mode and delete. Lines, Cast, Items and Scene are
 * the same controls as focus mode's tabs, and save the same way. Sketch and Focus open focus mode, whose stage is larger.
 * Selecting a bubble on the strip opens Lines on its line, and Add bubble adds one to the panel.
 * Nothing here is a press on the card: clicks, double clicks and presses stop at it, popovers and dialog included, so
 * they neither select, open, drag nor clear the selection on the strip.
 */
export function PanelTools({ panel, selectedLine, onSelectLine, onAddBubble, addingBubble }: PanelToolsProps) {
  const [open, setOpen] = useState<{ tool: Tool; anchor: HTMLElement; quiet?: boolean } | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const root = useRef<HTMLDivElement>(null)
  const linesButton = useRef<HTMLButtonElement>(null)
  // Where its bar sits along the card: centred under it, kept inside the strip so a narrow panel at an edge keeps its tools in reach.
  const [shift, setShift] = useState(0)
  const generating = panel.versions.at(-1)?.status === 'pending'

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

  // Selecting a bubble opens Lines on its line. It keeps the focus on the bubble, so its arrow keys, Enter and Delete work.
  useEffect(() => {
    if (selectedLine === null) return
    setOpen((now) => (now?.tool === 'lines' || linesButton.current === null ? now : { tool: 'lines', anchor: linesButton.current, quiet: true }))
  }, [selectedLine])

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
        <button type="button" className="icon-button" aria-label="Versions" title="Versions" aria-haspopup="dialog" aria-expanded={pressed('versions')} onClick={(e) => toggle('versions', e.currentTarget)}>
          <History size={15} aria-hidden="true" />
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
        <ToolPopover key={open.tool} label={POPOVER_TOOLS.find((t) => t.id === open.tool)?.label ?? 'Versions'} anchor={open.anchor} shift={shift} onClose={close} quiet={open.quiet}>
          {open.tool === 'versions' ? (
            <VersionSwitcher panel={panel} />
          ) : (
            <PanelInspector panel={panel} initialTab={open.tool} selectedLine={selectedLine} onSelectLine={onSelectLine} />
          )}
        </ToolPopover>
      )}

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
