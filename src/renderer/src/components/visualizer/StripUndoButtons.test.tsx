import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PROJECT_ID as projectId } from '../../test/character-fixtures'
import { EPISODE_ID } from '../../test/panel-fixtures'
import { initialAppState, useAppStore } from '../../stores/app-store'
import { useStripHistoryStore, type StripStep } from '../../stores/strip-history-store'
import { StripUndoButtons } from './StripUndoButtons'
import { undoKey, useStripUndoKeys } from './use-strip-undo-keys'

const stepStrip = vi.hoisted(() => vi.fn(async () => undefined))
vi.mock('./strip-undo', () => ({ stepStrip }))

beforeEach(() => {
  useAppStore.setState({ ...initialAppState, projectId, activeEpisodeId: EPISODE_ID })
  useStripHistoryStore.getState().reset()
  stepStrip.mockClear()
})

const A = 'pnl_00000000aa'
const step = (label: StripStep['label'], y: number): StripStep => ({
  kind: 'place',
  episodeId: EPISODE_ID,
  label,
  panelIds: [A],
  before: { order: [A], placements: { [A]: null } },
  after: { order: [A], placements: { [A]: { x: 0, y, width: 200 } } }
})

const undoButton = () => screen.getByRole('button', { name: 'Undo' })
const redoButton = () => screen.getByRole('button', { name: 'Redo' })

describe('StripUndoButtons', () => {
  it('are off with nothing to undo or redo, and say so', () => {
    render(<StripUndoButtons episodeId={EPISODE_ID} />)
    expect(undoButton()).toBeDisabled()
    expect(undoButton()).toHaveAttribute('title', 'Nothing to undo')
    expect(redoButton()).toBeDisabled()
    expect(redoButton()).toHaveAttribute('title', 'Nothing to redo')
  })

  it('name the next step, and run it when clicked', () => {
    useStripHistoryStore.getState().record(step('layout', 100), 0)
    useStripHistoryStore.getState().record(step('move', 200), 10_000)
    const taken = useStripHistoryStore.getState().begin('undo', EPISODE_ID)!
    useStripHistoryStore.getState().finish('undo', taken, { kind: 'done' })
    render(<StripUndoButtons episodeId={EPISODE_ID} />)
    expect(undoButton()).toHaveAttribute('title', 'Undo layout (Ctrl+Z)')
    expect(redoButton()).toHaveAttribute('title', 'Redo move (Ctrl+Shift+Z)')
    fireEvent.click(undoButton())
    expect(stepStrip).toHaveBeenCalledWith('undo', EPISODE_ID)
    fireEvent.click(redoButton())
    expect(stepStrip).toHaveBeenCalledWith('redo', EPISODE_ID)
  })

  it('wait while a step runs and while the Background editor is open', () => {
    useStripHistoryStore.getState().record(step('move', 100), 0)
    const view = render(<StripUndoButtons episodeId={EPISODE_ID} held />)
    expect(undoButton()).toBeDisabled()
    view.rerender(<StripUndoButtons episodeId={EPISODE_ID} />)
    expect(undoButton()).toBeEnabled()
    useStripHistoryStore.setState({ busy: true })
    view.rerender(<StripUndoButtons episodeId={EPISODE_ID} />)
    expect(undoButton()).toBeDisabled()
  })

  it("show why the last step did nothing, for that episode only", () => {
    useStripHistoryStore.setState({ notice: { episodeId: EPISODE_ID, text: "Can't undo: the strip changed since." } })
    const view = render(<StripUndoButtons episodeId={EPISODE_ID} />)
    expect(screen.getByRole('status')).toHaveTextContent("Can't undo: the strip changed since.")
    view.rerender(<StripUndoButtons episodeId="epi_0000000002" />)
    expect(screen.queryByRole('status')).toBeNull()
  })
})

function Keys({ open = null }: { open?: 'modal' | 'background' | 'layout' | null }) {
  useStripUndoKeys(EPISODE_ID)
  return (
    <div>
      <input aria-label="Title" />
      <div aria-label="Bubble" contentEditable suppressContentEditableWarning>
        text
      </div>
      {open === 'modal' && <div className="modal" role="dialog" aria-label="Delete panel" />}
      {open === 'background' && <div className="tool-popover" role="dialog" aria-label="Background" />}
      {open === 'layout' && <div className="tool-popover" role="dialog" aria-label="Layout" />}
    </div>
  )
}

describe('the strip undo keys', () => {
  it('Ctrl+Z undoes, Ctrl+Shift+Z and Ctrl+Y redo, Cmd too', () => {
    render(<Keys />)
    fireEvent.keyDown(document.body, { key: 'z', ctrlKey: true })
    fireEvent.keyDown(document.body, { key: 'Z', ctrlKey: true, shiftKey: true })
    fireEvent.keyDown(document.body, { key: 'y', ctrlKey: true })
    fireEvent.keyDown(document.body, { key: 'z', metaKey: true })
    expect(stepStrip.mock.calls).toEqual([
      ['undo', EPISODE_ID],
      ['redo', EPISODE_ID],
      ['redo', EPISODE_ID],
      ['undo', EPISODE_ID]
    ])
  })

  it('are left alone in a field, a bubble being typed in, a modal, the Background editor, and focus mode', () => {
    const view = render(<Keys />)
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Title' }), { key: 'z', ctrlKey: true })
    fireEvent.keyDown(screen.getByLabelText('Bubble'), { key: 'z', ctrlKey: true })
    view.rerender(<Keys open="modal" />)
    fireEvent.keyDown(document.body, { key: 'z', ctrlKey: true })
    view.rerender(<Keys open="background" />)
    fireEvent.keyDown(document.body, { key: 'z', ctrlKey: true })
    view.rerender(<Keys />)
    useAppStore.setState({ focusedPanelId: A })
    fireEvent.keyDown(document.body, { key: 'z', ctrlKey: true })
    expect(stepStrip).not.toHaveBeenCalled()
  })

  it("are the strip's with a panel tool's popover open: a Layout click is undone where it was made", () => {
    render(<Keys open="layout" />)
    fireEvent.keyDown(document.body, { key: 'z', ctrlKey: true })
    expect(stepStrip.mock.calls).toEqual([['undo', EPISODE_ID]])
  })

  it('take only their own keys', () => {
    expect(undoKey({ key: 'z', ctrlKey: false, metaKey: false, altKey: false, shiftKey: false })).toBeNull()
    expect(undoKey({ key: 'z', ctrlKey: true, metaKey: false, altKey: true, shiftKey: false })).toBeNull()
    expect(undoKey({ key: 'y', ctrlKey: true, metaKey: false, altKey: false, shiftKey: true })).toBeNull()
    expect(undoKey({ key: 'x', ctrlKey: true, metaKey: false, altKey: false, shiftKey: false })).toBeNull()
  })
})
