import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ExportInspection, ExportProgress } from '@shared/types'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { initialAppState, useAppStore } from '../../stores/app-store'
import { initialPanelsState, usePanelsStore } from '../../stores/panels-store'
import { PROJECT_ID as projectId } from '../../test/character-fixtures'
import { installFakeApi } from '../../test/fake-api'
import { EPISODE_ID, episode } from '../../test/panel-fixtures'
import { ExportDialog } from './ExportDialog'

const EP2 = 'epi_0000000002'

type Entry = ExportInspection['episodes'][number]
function entry(episodeId: string, number: number, o: Partial<Entry> = {}): Entry {
  return { episodeId, number, title: `Episode ${number}`, panelCount: 3, finishedCount: 3, unfinished: [], ...o }
}

let inspections: Record<string, Entry>

beforeEach(() => {
  useAppStore.setState({ ...initialAppState, projectId, activeEpisodeId: EPISODE_ID })
  usePanelsStore.setState({
    ...initialPanelsState,
    projectId,
    episodes: [episode({ id: EPISODE_ID, number: 1, title: 'Episode 1' }), episode({ id: EP2, number: 2, title: 'Episode 2' })]
  })
  inspections = { [EPISODE_ID]: entry(EPISODE_ID, 1), [EP2]: entry(EP2, 2) }
})

function progress(o: Partial<ExportProgress> = {}): { type: 'export.progress'; projectId: string; progress: ExportProgress } {
  return {
    type: 'export.progress',
    projectId,
    progress: { jobId: 'job_1', stage: 'capturing', episodeIndex: 0, episodeCount: 1, slice: 1, sliceCount: 3, message: null, outputs: [], ...o }
  }
}

function setup(extra: Parameters<typeof installFakeApi>[0] = {}) {
  const api = installFakeApi({
    'export:inspect': ((req: { episodeIds: string[] }) => ({ episodes: req.episodeIds.map((id) => inspections[id]) })) as never,
    'export:start': (() => ({ jobId: 'job_1' })) as never,
    'export:cancel': (() => undefined) as never,
    'export:reveal': (() => undefined) as never,
    ...extra
  })
  render(<ExportDialog onClose={() => {}} />)
  return api
}

const startCalls = (calls: { channel: string; req: unknown }[]) => calls.filter((c) => c.channel === 'export:start')

async function ready(): Promise<ReturnType<typeof userEvent.setup>> {
  const user = userEvent.setup()
  await waitFor(() => expect(screen.getByTestId('export-start')).toBeEnabled())
  return user
}

describe('ExportDialog', () => {
  it('ticks the active episode', async () => {
    setup()
    expect(await screen.findByTestId(`export-episode-${EPISODE_ID}`)).toBeChecked()
    expect(screen.getByTestId(`export-episode-${EP2}`)).not.toBeChecked()
  })

  it('shows the unfinished warning and needs Export anyway before starting', async () => {
    inspections[EPISODE_ID] = entry(EPISODE_ID, 2, {
      unfinished: [
        { panelId: 'a', position: 4, reason: 'none' },
        { panelId: 'b', position: 7, reason: 'failed' },
        { panelId: 'c', position: 9, reason: 'generating' }
      ]
    })
    const { calls } = setup()
    const user = await ready()
    await user.click(screen.getByTestId('export-start'))
    expect(screen.getByText('Episode 2: panels 4, 7 (failed), 9 (generating) have no finished image and will be left out.')).toBeInTheDocument()
    expect(startCalls(calls)).toHaveLength(0)
    await user.click(screen.getByTestId('export-anyway'))
    await waitFor(() => expect(startCalls(calls)).toHaveLength(1))
  })

  it('starts at once when nothing is unfinished', async () => {
    const { calls } = setup()
    const user = await ready()
    await user.click(screen.getByTestId('export-start'))
    await waitFor(() => expect(startCalls(calls)).toHaveLength(1))
    expect(screen.queryByTestId('export-anyway')).toBeNull()
  })

  it('inspects again when the ticked set changes', async () => {
    const { calls } = setup()
    const user = await ready()
    await user.click(screen.getByTestId(`export-episode-${EP2}`))
    await waitFor(() => {
      const last = calls.filter((c) => c.channel === 'export:inspect').at(-1)
      expect([...(last?.req as { episodeIds: string[] }).episodeIds].sort()).toEqual([EPISODE_ID, EP2].sort())
    })
  })

  it('disables Export when no ticked episode has a finished panel', async () => {
    inspections[EPISODE_ID] = entry(EPISODE_ID, 1, { finishedCount: 0, unfinished: [{ panelId: 'a', position: 1, reason: 'none' }] })
    setup()
    expect(await screen.findByText('No ticked episode has a finished panel.')).toBeInTheDocument()
    expect(screen.getByTestId('export-start')).toBeDisabled()
  })

  it('sends the request with the chosen preset and options', async () => {
    const { calls } = setup()
    const user = await ready()
    await user.click(screen.getByTestId(`export-episode-${EP2}`))
    await user.selectOptions(screen.getByTestId('export-preset'), 'pdf-print')
    await user.selectOptions(screen.getByLabelText('Paper'), 'letter')
    await user.click(await screen.findByLabelText('Combine into one file'))
    await user.click(screen.getByLabelText('Without lettering'))
    await waitFor(() => expect(screen.getByTestId('export-start')).toBeEnabled())
    await user.click(screen.getByTestId('export-start'))
    await waitFor(() => expect(startCalls(calls)).toHaveLength(1))
    const req = startCalls(calls)[0].req as { episodeIds: string[] }
    expect({ ...req, episodeIds: [...req.episodeIds].sort() }).toEqual({
      projectId,
      episodeIds: [EPISODE_ID, EP2].sort(),
      preset: 'pdf-print',
      imageType: 'jpeg',
      paper: 'letter',
      resolution: 'standard',
      combine: true,
      lettering: false
    })
  })

  it('shows progress from export.progress events for its job only', async () => {
    const { emit } = setup()
    const user = await ready()
    await user.click(screen.getByTestId('export-start'))
    await screen.findByTestId('export-progress')
    act(() => emit(progress({ jobId: 'other', episodeIndex: 0, episodeCount: 9, slice: 5, sliceCount: 6 })))
    expect(screen.getByTestId('export-progress')).not.toHaveTextContent('of 9')
    act(() => emit(progress({ episodeIndex: 1, episodeCount: 3, slice: 14, sliceCount: 31 })))
    expect(screen.getByTestId('export-progress')).toHaveTextContent('Episode 2 of 3, slice 14 of 31')
  })

  it('applies a done event that arrived before export:start resolved', async () => {
    let resolveStart: (v: { jobId: string }) => void = () => {}
    const start = new Promise<{ jobId: string }>((r) => (resolveStart = r))
    const { emit } = setup({ 'export:start': (() => start) as never })
    const user = await ready()
    await user.click(screen.getByTestId('export-start'))
    act(() => emit(progress({ stage: 'done', outputs: ['C:/out/a.pdf'] })))
    expect(screen.queryByText('Exported.')).toBeNull()
    await act(async () => resolveStart({ jobId: 'job_1' }))
    expect(await screen.findByText('Exported.')).toBeInTheDocument()
  })

  it('Cancel sends export:cancel', async () => {
    const { calls } = setup()
    const user = await ready()
    await user.click(screen.getByTestId('export-start'))
    await user.click(await screen.findByTestId('export-cancel'))
    expect(calls.filter((c) => c.channel === 'export:cancel').map((c) => c.req)).toEqual([{ jobId: 'job_1' }])
  })

  it('shows Export cancelled. on a cancelled event', async () => {
    const { emit } = setup()
    const user = await ready()
    await user.click(screen.getByTestId('export-start'))
    await screen.findByTestId('export-cancel')
    act(() => emit(progress({ stage: 'cancelled' })))
    expect(await screen.findByText('Export cancelled.')).toBeInTheDocument()
  })

  it('Show in folder sends export:reveal', async () => {
    const { calls, emit } = setup()
    const user = await ready()
    await user.click(screen.getByTestId('export-start'))
    await screen.findByTestId('export-cancel')
    act(() => emit(progress({ stage: 'done', outputs: ['C:/out/a.pdf'] })))
    await user.click(await screen.findByTestId('export-reveal'))
    expect(calls.filter((c) => c.channel === 'export:reveal').map((c) => c.req)).toEqual([{ jobId: 'job_1' }])
  })

  it('keeps the dialog open with the error on failed', async () => {
    const { emit } = setup()
    const user = await ready()
    await user.click(screen.getByTestId('export-start'))
    await screen.findByTestId('export-cancel')
    act(() => emit(progress({ stage: 'failed', message: 'Disk full' })))
    expect(await screen.findByRole('alert')).toHaveTextContent('Disk full')
    expect(screen.getByTestId('export-dialog')).toBeInTheDocument()
    expect(screen.queryByTestId('export-reveal')).toBeNull()
  })

  it('offers Show in folder when a failed export still wrote files', async () => {
    const { emit } = setup()
    const user = await ready()
    await user.click(screen.getByTestId('export-start'))
    await screen.findByTestId('export-cancel')
    act(() => emit(progress({ stage: 'failed', message: 'Disk full', outputs: ['C:/out/a.pdf'] })))
    expect(await screen.findByRole('alert')).toHaveTextContent('Disk full')
    expect(screen.getByTestId('export-reveal')).toBeInTheDocument()
  })

  it('a dismissed save dialog ({cancelled:true}) returns to the form', async () => {
    setup({ 'export:start': (() => ({ cancelled: true })) as never })
    const user = await ready()
    await user.click(screen.getByTestId('export-start'))
    await waitFor(() => expect(screen.getByTestId('export-start')).toBeEnabled())
    expect(screen.queryByTestId('export-progress')).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('shows a rejected start as the error and keeps the form usable', async () => {
    setup({ 'export:start': vi.fn().mockRejectedValue(new Error('An export is already running')) as never })
    const user = await ready()
    await user.click(screen.getByTestId('export-start'))
    expect(await screen.findByRole('alert')).toHaveTextContent('An export is already running')
    expect(screen.getByTestId('export-start')).toBeEnabled()
  })
})
