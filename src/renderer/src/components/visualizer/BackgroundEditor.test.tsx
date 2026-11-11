import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resolveStrip } from '@shared/strip-canvas'
import type { Episode, StripBackground } from '@shared/types'
import { initialAppState, useAppStore } from '../../stores/app-store'
import { initialPanelsState, usePanelsStore } from '../../stores/panels-store'
import { PROJECT_ID as P } from '../../test/character-fixtures'
import { installFakeApi } from '../../test/fake-api'
import { EPISODE_ID, episode, panel } from '../../test/panel-fixtures'
import { BackgroundEditor } from './BackgroundEditor'
import { StripCanvas } from './StripCanvas'

const stops = [
  { color: '#000000', at: 0 },
  { color: '#ffffff', at: 1 }
]
const linear: StripBackground = { kind: 'linear', angle: 180, repeatEvery: null, stops }
const IMAGE = `episode-backgrounds/${EPISODE_ID}/a.png`

let anchor: HTMLButtonElement

beforeEach(() => {
  vi.useFakeTimers()
  anchor = document.body.appendChild(document.createElement('button'))
  useAppStore.setState({ ...initialAppState, projectId: P, activeEpisodeId: EPISODE_ID })
  usePanelsStore.setState({ ...initialPanelsState, projectId: P, episodesLoaded: true })
})

afterEach(() => {
  vi.useRealTimers()
  anchor.remove()
})

/** The editor on an episode, with every save answered; `saved` lists the backgrounds sent. */
function mount(o: Partial<Episode> = {}, handlers: Parameters<typeof installFakeApi>[0] = {}) {
  const ep = episode(o)
  const saved: (StripBackground | null)[] = []
  const api = installFakeApi({
    'episodes:setBackground': (req: { background: StripBackground | null }) => {
      saved.push(req.background)
      return { ...ep, background: req.background }
    },
    'episodes:list': () => [ep],
    'panels:list': () => [],
    ...handlers
  } as never)
  const onClose = vi.fn()
  const above = vi.fn()
  const view = render(
    <div onClick={above}>
      <BackgroundEditor episode={ep} placed={resolveStrip([])} anchor={anchor} onClose={onClose} />
    </div>
  )
  return { ...api, saved, onClose, above, view }
}

async function settle(ms = 300): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
}

const change = (label: string, value: string): boolean => fireEvent.change(screen.getByLabelText(label), { target: { value } })

describe('BackgroundEditor', () => {
  it('picks any colour by hex', async () => {
    const { saved } = mount({ background: { kind: 'solid', color: '#ffffff' } })
    change('Colour hex', '#12ab9f')
    await settle()
    expect(saved).toEqual([{ kind: 'solid', color: '#12ab9f' }])
    expect((screen.getByLabelText('Colour') as HTMLInputElement).value).toBe('#12ab9f')
  })

  it('refuses a malformed hex with a message', async () => {
    const { saved } = mount({ background: { kind: 'solid', color: '#ffffff' } })
    change('Colour hex', '#12zz')
    expect(screen.getByText('Enter a colour as #rrggbb')).toBeTruthy()
    await settle(1000)
    expect(saved).toEqual([])
  })

  it('offers Color, Linear, Radial, Conic and Image', () => {
    mount({ background: linear })
    expect(screen.getAllByRole('radio').map((r) => r.getAttribute('aria-label'))).toEqual(['Color', 'Linear', 'Radial', 'Conic', 'Image'])
    expect(screen.getByRole('radio', { name: 'Linear' }).getAttribute('aria-checked')).toBe('true')
  })

  it('adds and removes gradient stops but keeps at least two', async () => {
    const { saved } = mount({ background: linear })
    expect((screen.getByLabelText('Remove stop 1') as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Add stop' }))
    expect(screen.getByLabelText('Stop 3 hex')).toBeTruthy()
    fireEvent.click(screen.getByLabelText('Remove stop 1'))
    expect(screen.queryByLabelText('Stop 3 hex')).toBeNull()
    expect((screen.getByLabelText('Remove stop 1') as HTMLButtonElement).disabled).toBe(true)
    await settle()
    expect(saved).toHaveLength(1)
    expect((saved[0] as { stops: unknown[] }).stops).toHaveLength(2)
  })

  it('changes a stop position and colour', async () => {
    const { saved } = mount({ background: linear })
    change('Stop 1 position', '25')
    change('Stop 2 hex', '#ff0000')
    await settle()
    expect(saved).toEqual([{ ...linear, stops: [{ color: '#000000', at: 0.25 }, { color: '#ff0000', at: 1 }] }])
  })

  it('changes the angle', async () => {
    const { saved } = mount({ background: linear })
    change('Angle', '45')
    await settle()
    expect(saved).toEqual([{ ...linear, angle: 45 }])
  })

  it('sets repeat length', async () => {
    const { saved } = mount({ background: linear })
    change('Repeat every (px)', '600')
    await settle()
    expect(saved).toEqual([{ ...linear, repeatEvery: 600 }])
    change('Repeat every (px)', '')
    await settle()
    expect(saved[1]).toEqual({ ...linear, repeatEvery: null })
  })

  it('applies a preset gradient', async () => {
    const { saved } = mount({ background: linear })
    fireEvent.click(screen.getByRole('button', { name: 'Dusk' }))
    await settle()
    expect(saved[0]).toMatchObject({ kind: 'linear', stops: [{ color: '#1e1b4b' }, { color: '#7c3aed' }, { color: '#f472b6' }] })
  })

  it('keeps the stops when the kind changes between gradients', async () => {
    const { saved } = mount({ background: linear })
    fireEvent.click(screen.getByRole('radio', { name: 'Conic' }))
    await settle()
    expect(saved).toEqual([{ kind: 'conic', angle: 180, repeatEvery: null, stops }])
  })

  it('asks for an image when there is none, then sets its fit and opacity', async () => {
    const withImage = episode({ background: { kind: 'image', path: IMAGE, fit: 'width', opacity: 1, color: '#ffffff' }, backgroundImage: IMAGE })
    const { saved, calls } = mount({ background: { kind: 'solid', color: '#ffffff' } }, { 'episodes:pickBackgroundImage': () => withImage })
    fireEvent.click(screen.getByRole('radio', { name: 'Image' }))
    await settle(0)
    expect(calls.some((c) => c.channel === 'episodes:pickBackgroundImage')).toBe(true)
    expect(screen.getByRole('radio', { name: 'Image' }).getAttribute('aria-checked')).toBe('true')
    fireEvent.change(screen.getByLabelText('Fit'), { target: { value: 'tile' } })
    change('Opacity', '40')
    await settle()
    expect(saved).toEqual([{ kind: 'image', path: IMAGE, fit: 'tile', opacity: 0.4, color: '#ffffff' }])
  })

  it('stays on its kind when the image dialog is cancelled', async () => {
    mount({ background: linear }, { 'episodes:pickBackgroundImage': () => null })
    fireEvent.click(screen.getByRole('radio', { name: 'Image' }))
    await settle(0)
    expect(screen.getByRole('radio', { name: 'Linear' }).getAttribute('aria-checked')).toBe('true')
  })

  it('reuses the last picked image without a new pick', async () => {
    const { saved, calls } = mount({ background: linear, backgroundImage: IMAGE })
    fireEvent.click(screen.getByRole('radio', { name: 'Image' }))
    await settle()
    expect(calls.some((c) => c.channel === 'episodes:pickBackgroundImage')).toBe(false)
    expect(saved).toEqual([{ kind: 'image', path: IMAGE, fit: 'width', opacity: 1, color: '#ffffff' }])
  })

  it('saves once 300 ms after the last change', async () => {
    const { saved } = mount({ background: linear })
    change('Angle', '10')
    await settle(200)
    change('Angle', '20')
    await settle(200)
    expect(saved).toEqual([])
    await settle(100)
    expect(saved).toEqual([{ ...linear, angle: 20 }])
  })

  it('the strip shows the change before it saves, and goes back to what is stored once it is saved', async () => {
    const a = panel({ id: 'pnl_00000000aa' })
    const { saved } = mount({ background: { kind: 'solid', color: '#ffffff' } })
    const strip = render(<StripCanvas episodeId={EPISODE_ID} panels={[a]} />)
    const canvas = (): HTMLElement => strip.container.querySelector<HTMLElement>('.strip-canvas') as HTMLElement
    change('Colour hex', '#12ab9f')
    expect(canvas().style.backgroundColor).toBe('rgb(18, 171, 159)')
    expect(saved).toEqual([])
    await settle()
    expect(saved).toHaveLength(1)
    expect(usePanelsStore.getState().backgroundPreview).toBeNull()
  })

  it('a save that fails shows its message and the strip keeps the draft until it changes again', async () => {
    mount({ background: linear }, { 'episodes:setBackground': () => Promise.reject(new Error('Disk full')) })
    change('Angle', '90')
    await settle()
    expect(screen.getByRole('alert').textContent).toContain('Disk full')
    expect(usePanelsStore.getState().backgroundPreview?.background).toMatchObject({ angle: 90 })
    change('Angle', '91')
    expect(screen.queryByText(/Disk full/)).toBeNull()
  })

  it('clears the preview when it closes, and saves a change still waiting', async () => {
    const { view, saved } = mount({ background: linear })
    change('Angle', '30')
    expect(usePanelsStore.getState().backgroundPreview).not.toBeNull()
    view.unmount()
    await settle(0)
    expect(saved).toEqual([{ ...linear, angle: 30 }])
    expect(usePanelsStore.getState().backgroundPreview).toBeNull()
  })

  it('a click inside does not reach what is under it', () => {
    const { above } = mount({ background: linear })
    fireEvent.click(screen.getByRole('dialog', { name: 'Background' }))
    fireEvent.click(screen.getByRole('radio', { name: 'Radial' }))
    expect(above).not.toHaveBeenCalled()
  })
})
