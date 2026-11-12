import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Panel } from '@shared/types'
import { initialAppState, useAppStore } from '../../stores/app-store'
import { initialPanelsState, usePanelsStore } from '../../stores/panels-store'
import { PROJECT_ID as P } from '../../test/character-fixtures'
import { installFakeApi } from '../../test/fake-api'
import { EPISODE_ID, panel, panelVersion } from '../../test/panel-fixtures'
import { CropDialog } from './CropDialog'

const A = 'pnl_0000000001'
const v1 = panelVersion({ id: 'ver_00000000a1', imagePath: `panels/${A}/ver_00000000a1.png` })
let stored: Panel

beforeEach(() => {
  stored = panel({ id: A, aspect: '1:1', versions: [v1], currentVersionId: v1.id })
  useAppStore.setState({ ...initialAppState, projectId: P, activeEpisodeId: EPISODE_ID })
  usePanelsStore.setState({ ...initialPanelsState, projectId: P, episodesLoaded: true, panelsByEpisode: { [EPISODE_ID]: [stored] } })
  // jsdom lays nothing out: the picture shows 500 wide, so one screen pixel is two of the 1000 by 500 image's.
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const width = this.classList.contains('crop-frame') ? 500 : 0
    return { x: 0, y: 0, left: 0, top: 0, right: width, bottom: width / 2, width, height: width / 2, toJSON: () => ({}) } as DOMRect
  })
})
afterEach(() => vi.restoreAllMocks())

function open(onClose = vi.fn(), handlers: Parameters<typeof installFakeApi>[0] = {}, size = { width: 1000, height: 500 }) {
  const api = installFakeApi({ 'panels:list': () => [stored], 'panels:crop': () => v1, ...handlers })
  render(<CropDialog panel={stored} versionId={v1.id} imagePath={v1.imagePath!} onClose={onClose} />)
  const img = screen.getByRole('dialog', { name: 'Crop panel' }).querySelector('img')!
  Object.defineProperty(img, 'naturalWidth', { value: size.width })
  Object.defineProperty(img, 'naturalHeight', { value: size.height })
  fireEvent.load(img)
  return { ...api, onClose }
}

const box = (): HTMLElement => screen.getByTestId('crop-box')
const crops = (calls: { channel: string; req: unknown }[]) => calls.filter((c) => c.channel === 'panels:crop').map((c) => c.req)

describe('CropDialog', () => {
  it("starts with the largest box of the panel's shape, centred, over the whole picture", () => {
    open()
    expect(box().style.left).toBe('25%')
    expect(box().style.width).toBe('50%')
    expect(box().style.top).toBe('0%')
    expect(box().style.height).toBe('100%')
  })

  it('crops to where the box was dragged, as a new version, then closes', async () => {
    const { calls, onClose } = open()
    fireEvent.pointerDown(box(), { button: 0, pointerId: 1, clientX: 200, clientY: 100 })
    fireEvent.pointerMove(box(), { pointerId: 1, clientX: 150, clientY: 100 })
    fireEvent.pointerUp(box(), { pointerId: 1, clientX: 150, clientY: 100 })
    expect(box().style.left).toBe('15%')
    await userEvent.click(screen.getByRole('button', { name: 'Crop' }))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(crops(calls)).toEqual([{ projectId: P, panelId: A, versionId: v1.id, area: { x: 0.15, y: 0, width: 0.5, height: 1 } }])
  })

  it('resizes from a corner, keeping the shape', () => {
    open()
    const corner = screen.getByTestId('crop-handle-se')
    fireEvent.pointerDown(corner, { button: 0, pointerId: 1, clientX: 375, clientY: 250 })
    fireEvent.pointerMove(corner, { pointerId: 1, clientX: 325, clientY: 200 })
    expect(box().style.width).toBe('40%')
    expect(box().style.height).toBe('80%')
    expect(box().style.left).toBe('25%')
  })

  it('another shape refits the box, and the crop gives the panel that shape', async () => {
    const { calls, onClose } = open()
    expect(within(screen.getByRole('group', { name: 'Panel shape' })).getByRole('button', { name: '1:1' })).toHaveAttribute('aria-pressed', 'true')
    await userEvent.click(screen.getByRole('button', { name: '16:9' }))
    // 16:9 in a 1000 by 500 picture: the full width, 562.5 high is too tall, so 888.9 by 500.
    expect(box().style.height).toBe('100%')
    expect(parseFloat(box().style.width)).toBeCloseTo(88.89, 1)
    await userEvent.click(screen.getByRole('button', { name: 'Crop' }))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(crops(calls)).toHaveLength(1)
    expect(crops(calls)[0]).toMatchObject({ aspect: '16:9' })
  })

  it('sends no shape when the panel keeps its own', async () => {
    const { calls, onClose } = open()
    fireEvent.keyDown(box(), { key: 'ArrowLeft' })
    await userEvent.click(screen.getByRole('button', { name: 'Crop' }))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(crops(calls)[0]).not.toHaveProperty('aspect')
  })

  it('moves the box with the arrow keys, and Reset puts it back', async () => {
    open()
    fireEvent.keyDown(box(), { key: 'ArrowLeft', shiftKey: true })
    expect(box().style.left).toBe('15%')
    await userEvent.click(screen.getByRole('button', { name: 'Reset' }))
    expect(box().style.left).toBe('25%')
  })

  it('cannot crop to the whole picture, which would change nothing', () => {
    stored = panel({ id: A, aspect: '16:9', versions: [v1], currentVersionId: v1.id })
    open(vi.fn(), {}, { width: 1600, height: 900 })
    expect(box().style.width).toBe('100%')
    expect(screen.getByRole('button', { name: 'Crop' })).toBeDisabled()
    const corner = screen.getByTestId('crop-handle-se')
    fireEvent.pointerDown(corner, { button: 0, pointerId: 1, clientX: 500, clientY: 281 })
    fireEvent.pointerMove(corner, { pointerId: 1, clientX: 400, clientY: 281 })
    expect(screen.getByRole('button', { name: 'Crop' })).toBeEnabled()
  })

  it('shows a refused crop and stays open', async () => {
    const { onClose } = open(vi.fn(), {
      'panels:crop': () => {
        throw new Error("A WEBP image can't be cropped: use png or jpg")
      }
    })
    fireEvent.keyDown(box(), { key: 'ArrowLeft' })
    await userEvent.click(screen.getByRole('button', { name: 'Crop' }))
    expect(await within(screen.getByRole('dialog')).findByRole('alert')).toHaveTextContent("A WEBP image can't be cropped")
    expect(onClose).not.toHaveBeenCalled()
  })

  it('closes on Escape and on Cancel, cropping nothing', async () => {
    const { calls, onClose } = open()
    fireEvent.keyDown(box(), { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onClose).toHaveBeenCalledTimes(2)
    expect(crops(calls)).toEqual([])
  })
})
