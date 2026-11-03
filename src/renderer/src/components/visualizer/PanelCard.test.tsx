import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { assetUrl } from '@shared/asset-url'
import type { Panel } from '@shared/types'
import { initialAppState, useAppStore } from '../../stores/app-store'
import { initialCharactersState, useCharactersStore } from '../../stores/characters-store'
import { initialPanelsState, usePanelsStore } from '../../stores/panels-store'
import { PROJECT_ID as projectId, character } from '../../test/character-fixtures'
import { installFakeApi } from '../../test/fake-api'
import { EPISODE_ID, panel, panelVersion } from '../../test/panel-fixtures'
import { PanelCard } from './PanelCard'

const mina = character()

beforeEach(() => {
  useAppStore.setState({ ...initialAppState, projectId, activeEpisodeId: EPISODE_ID })
  usePanelsStore.setState({ ...initialPanelsState, projectId })
  useCharactersStore.setState({ ...initialCharactersState, projectId, characters: [mina], loaded: true })
})

/** The strip a card sits in, so Move up/down know the panel's place. */
function strip(...panels: Panel[]): void {
  usePanelsStore.setState({ panelsByEpisode: { [EPISODE_ID]: panels } })
}

/** For the tests that do not click Edit. */
const noEdit = (): void => {}

const status = (): HTMLElement => screen.getByTestId('panel-status')

describe('PanelCard', () => {
  it('renders the current version through the asset protocol', () => {
    installFakeApi({})
    const p = panel()
    render(<PanelCard panel={p} selected={false} onEdit={noEdit} />)
    const images = within(screen.getByTestId('panel-card')).getAllByRole('img')
    expect(images).toHaveLength(1)
    expect(images[0]).toHaveAttribute('src', assetUrl(projectId, 'panels/pnl_0000000001/ver_0000000001.png'))
    expect(images[0].getAttribute('src')).toMatch(/^webtoon-asset:\/\/prj_aaaaaaaaaa\/panels\/pnl_0000000001\/ver_0000000001\.png$/)
    expect(screen.queryByTestId('panel-status')).toBeNull()
  })

  it('shows the version the panel points at, not the newest one', () => {
    installFakeApi({})
    const older = panelVersion({ id: 'ver_0000000001' })
    const newer = panelVersion({ id: 'ver_0000000002' })
    render(<PanelCard panel={panel({ versions: [older, newer], currentVersionId: older.id })} selected={false} onEdit={noEdit} />)
    expect(screen.getByRole('img')).toHaveAttribute('src', assetUrl(projectId, 'panels/pnl_0000000001/ver_0000000001.png'))
  })

  it('shows pending and failed states with retry', async () => {
    const { calls } = installFakeApi({ 'panels:generate': () => undefined, 'panels:list': () => [] })
    const pending = panelVersion({ status: 'pending', imagePath: null })
    const { rerender } = render(<PanelCard panel={panel({ versions: [pending], currentVersionId: null })} selected={false} onEdit={noEdit} />)
    expect(status()).toHaveTextContent('Generating…')
    // The first generation has no image yet: no <img> at all, so a card with an image can be told apart.
    expect(screen.queryByRole('img')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull()

    const failed = panelVersion({ status: 'failed', imagePath: null, error: 'boom' })
    rerender(<PanelCard panel={panel({ versions: [failed], currentVersionId: null })} selected={false} onEdit={noEdit} />)
    expect(status()).toHaveTextContent('Failed: boom')
    await userEvent.click(within(status()).getByRole('button', { name: 'Retry' }))
    expect(calls.find((c) => c.channel === 'panels:generate')?.req).toEqual({ projectId, panelId: 'pnl_0000000001' })
  })

  it('keeps the previous image when a regeneration is pending or has failed', () => {
    installFakeApi({})
    const good = panelVersion({ id: 'ver_0000000001' })
    const pending = panelVersion({ id: 'ver_0000000002', status: 'pending', imagePath: null })
    const { rerender } = render(<PanelCard panel={panel({ versions: [good, pending], currentVersionId: good.id })} selected={false} onEdit={noEdit} />)
    expect(screen.getByRole('img')).toHaveAttribute('src', assetUrl(projectId, 'panels/pnl_0000000001/ver_0000000001.png'))
    expect(status()).toHaveTextContent('Generating…')

    const failed = panelVersion({ id: 'ver_0000000002', status: 'failed', imagePath: null, error: 'timeout' })
    rerender(<PanelCard panel={panel({ versions: [good, failed], currentVersionId: good.id })} selected={false} onEdit={noEdit} />)
    expect(screen.getByRole('img')).toHaveAttribute('src', assetUrl(projectId, 'panels/pnl_0000000001/ver_0000000001.png'))
    expect(status()).toHaveTextContent('Failed: timeout')
    expect(within(status()).getByRole('button', { name: 'Retry' })).toBeEnabled()
  })

  it('hides a failed regeneration once the user reverts, and shows the next failure again', () => {
    installFakeApi({})
    const v1 = panelVersion({ id: 'ver_0000000001' })
    const v2 = panelVersion({ id: 'ver_0000000002' })
    const failed = panelVersion({ id: 'ver_0000000003', status: 'failed', imagePath: null, error: 'timeout' })
    const { rerender } = render(<PanelCard panel={panel({ versions: [v1, v2, failed], currentVersionId: v2.id })} selected={false} onEdit={noEdit} />)
    expect(status()).toHaveTextContent('Failed: timeout')

    // A revert (here, or by the agent in the side chat) is the user's choice of image: the old failure is no news.
    rerender(<PanelCard panel={panel({ versions: [v1, v2, failed], currentVersionId: v1.id })} selected={false} onEdit={noEdit} />)
    expect(screen.queryByTestId('panel-status')).toBeNull()
    expect(screen.getByRole('img')).toHaveAttribute('src', assetUrl(projectId, 'panels/pnl_0000000001/ver_0000000001.png'))

    const again = panelVersion({ id: 'ver_0000000004', status: 'failed', imagePath: null, error: 'rate limited' })
    rerender(<PanelCard panel={panel({ versions: [v1, v2, failed, again], currentVersionId: v1.id })} selected={false} onEdit={noEdit} />)
    expect(status()).toHaveTextContent('Failed: rate limited')
  })

  it('says so when a panel has no image yet', () => {
    installFakeApi({})
    render(<PanelCard panel={panel({ versions: [], currentVersionId: null })} selected={false} onEdit={noEdit} />)
    expect(screen.queryByRole('img')).toBeNull()
    expect(screen.getByText('No image yet')).toBeInTheDocument()
  })

  describe('shape', () => {
    it('marks the frame, slant and layout on the card', () => {
      installFakeApi({})
      render(<PanelCard panel={panel({ frame: 'slanted', beside: true, gapAfter: 'long', gutter: 'black' })} selected={false} slant="right" onEdit={noEdit} />)
      const card = screen.getByTestId('panel-card')
      expect(card).toHaveAttribute('data-frame', 'slanted')
      expect(card).toHaveAttribute('data-slant', 'right')
      expect(card).toHaveAttribute('data-beside', 'true')
      expect(card).toHaveAttribute('data-gap', 'long')
      expect(card).toHaveAttribute('data-gutter', 'black')
    })

    it('has no slant unless given one', () => {
      installFakeApi({})
      render(<PanelCard panel={panel()} selected={false} onEdit={noEdit} />)
      const card = screen.getByTestId('panel-card')
      expect(card).toHaveAttribute('data-frame', 'bordered')
      expect(card).not.toHaveAttribute('data-slant')
    })

    it('fades a tall panel whatever its frame, at its own aspect', () => {
      installFakeApi({})
      render(<PanelCard panel={panel({ aspect: '1:3', frame: 'bordered' })} selected={false} onEdit={noEdit} />)
      const card = screen.getByTestId('panel-card')
      expect(card).toHaveAttribute('data-frame', 'fade')
      const media = card.querySelector<HTMLElement>('.panel-media')
      expect(media?.style.aspectRatio).toBe('1 / 3')
      // The card's share of its row's width, so the panels of a row are one height.
      expect(card.style.getPropertyValue('--ar')).toBe(String(1 / 3))
    })

    it('passes its share of the row to the lettering, the whole row when alone', () => {
      installFakeApi({})
      const { rerender } = render(<PanelCard panel={panel()} selected={false} onEdit={noEdit} />)
      expect(screen.getByTestId('panel-card').style.getPropertyValue('--share')).toBe('1')
      rerender(<PanelCard panel={panel()} selected={false} share={0.25} onEdit={noEdit} />)
      expect(screen.getByTestId('panel-card').style.getPropertyValue('--share')).toBe('0.25')
    })
  })

  it('renders dialogue as overlay, not image text', () => {
    installFakeApi({})
    const p = panel({
      dialogue: [
        { id: 'dlg_0000000001', speakerId: mina.id, kind: 'speech', text: 'We should go.', placement: null },
        { id: 'dlg_0000000002', speakerId: mina.id, kind: 'thought', text: 'Is he lying?', placement: null },
        { id: 'dlg_0000000003', speakerId: null, kind: 'narration', text: 'The city never slept.', placement: null },
        { id: 'dlg_0000000004', speakerId: null, kind: 'sfx', text: 'BOOM', placement: null }
      ]
    })
    render(<PanelCard panel={p} selected={false} onEdit={noEdit} />)
    const card = screen.getByTestId('panel-card')
    // No name labels on the strip, as in a printed manhwa: the bubble's side and tail say who speaks, and the
    // speaker's name (from the characters store) is only a tooltip.
    expect(within(card).queryByText('Mina')).toBeNull()
    const lines = card.querySelectorAll('[data-kind]')
    expect([...lines].map((l) => l.getAttribute('data-kind'))).toEqual(['speech', 'thought', 'narration', 'sfx'])
    expect([...lines].map((l) => l.getAttribute('data-shape'))).toEqual(['speech', 'thought', 'caption', 'sfx'])
    expect([...lines].map((l) => l.textContent)).toEqual(['We should go.', 'Is he lying?', 'The city never slept.', 'BOOM'])
    expect(card.querySelector('[data-kind="speech"]')).toHaveAttribute('title', 'Mina')
    // The lines are real DOM text in an overlay beside the image, never part of it: an <img> has no children,
    // and its alt text describes the panel, not what is said in it.
    const image = within(card).getByRole('img')
    const overlay = card.querySelector('.dialogue-overlay')
    expect(overlay).not.toBeNull()
    expect(overlay).toContainElement(card.querySelector<HTMLElement>('[data-kind="sfx"]'))
    expect(overlay).not.toContainElement(image)
    expect(image.parentElement).toBe(overlay?.parentElement)
    expect(image.childElementCount).toBe(0)
    for (const line of p.dialogue) expect(image.getAttribute('alt') ?? '').not.toContain(line.text)
    expect(within(card).getByText('We should go.')).toBeInTheDocument()
    expect(card.querySelector('[data-kind="sfx"]')).toHaveTextContent('BOOM')
  })

  it('renders dialogue as text, never as markup', () => {
    installFakeApi({})
    const p = panel({ dialogue: [{ id: 'dlg_0000000001', speakerId: null, kind: 'narration', text: '<img src=x onerror=alert(1)><b>bold</b>', placement: null }] })
    render(<PanelCard panel={p} selected={false} onEdit={noEdit} />)
    const card = screen.getByTestId('panel-card')
    expect(card.querySelectorAll('img')).toHaveLength(1)
    expect(card.querySelector('b')).toBeNull()
    expect(card).toHaveTextContent('<img src=x onerror=alert(1)><b>bold</b>')
  })

  it('click selects the panel', async () => {
    installFakeApi({})
    const p = panel()
    const { rerender } = render(<PanelCard panel={p} selected={false} onEdit={noEdit} />)
    expect(screen.getByTestId('panel-card')).toHaveAttribute('data-selected', 'false')
    await userEvent.click(screen.getByTestId('panel-card'))
    expect(useAppStore.getState().selectedPanelId).toBe(p.id)
    rerender(<PanelCard panel={p} selected={true} onEdit={noEdit} />)
    expect(screen.getByTestId('panel-card')).toHaveAttribute('data-selected', 'true')
  })

  it('selects when the image is clicked and from the keyboard', async () => {
    installFakeApi({})
    const p = panel()
    render(<PanelCard panel={p} selected={false} onEdit={noEdit} />)
    await userEvent.click(screen.getByRole('img'))
    expect(useAppStore.getState().selectedPanelId).toBe(p.id)
    useAppStore.getState().selectPanel(null)
    screen.getByTestId('panel-card').focus()
    await userEvent.keyboard('{Enter}')
    expect(useAppStore.getState().selectedPanelId).toBe(p.id)
  })

  describe('hover toolbar', () => {
    it('asks the strip to edit from Edit, without selecting the panel', async () => {
      installFakeApi({})
      const onEdit = vi.fn()
      render(<PanelCard panel={panel()} selected={false} onEdit={onEdit} />)
      await userEvent.click(screen.getByRole('button', { name: 'Edit' }))
      expect(onEdit).toHaveBeenCalledTimes(1)
      expect(useAppStore.getState().selectedPanelId).toBeNull()
      // The editor belongs to the strip: a card that moves to another row would take its own dialog with it.
      expect(screen.queryByTestId('panel-editor')).toBeNull()
    })

    it('toggles Beside previous with exactly the flag, without selecting the panel', async () => {
      const a = panel({ id: 'pnl_00000000aa' })
      const b = panel({ id: 'pnl_00000000bb' })
      const { calls } = installFakeApi({ 'panels:update': () => ({ panel: panel({ id: 'pnl_00000000bb', beside: true }), warnings: [] }), 'panels:list': () => [a, b] })
      strip(a, b)
      render(<PanelCard panel={b} selected={false} onEdit={noEdit} />)
      const toggle = screen.getByRole('button', { name: 'Beside previous' })
      expect(toggle).toHaveAttribute('aria-pressed', 'false')
      await userEvent.click(toggle)
      await waitFor(() => expect(calls.some((c) => c.channel === 'panels:update')).toBe(true))
      expect(calls.find((c) => c.channel === 'panels:update')?.req).toEqual({ projectId, panelId: 'pnl_00000000bb', patch: { beside: true } })
      expect(useAppStore.getState().selectedPanelId).toBeNull()
    })

    it('turns Beside previous off when it is on', async () => {
      const a = panel({ id: 'pnl_00000000aa' })
      const b = panel({ id: 'pnl_00000000bb', beside: true })
      const { calls } = installFakeApi({ 'panels:update': () => ({ panel: b, warnings: [] }), 'panels:list': () => [a, b] })
      strip(a, b)
      render(<PanelCard panel={b} selected={false} onEdit={noEdit} />)
      const toggle = screen.getByRole('button', { name: 'Beside previous' })
      expect(toggle).toHaveAttribute('aria-pressed', 'true')
      await userEvent.click(toggle)
      await waitFor(() => expect(calls.some((c) => c.channel === 'panels:update')).toBe(true))
      expect(calls.find((c) => c.channel === 'panels:update')?.req).toEqual({ projectId, panelId: 'pnl_00000000bb', patch: { beside: false } })
    })

    it('disables Beside previous on the first panel of the episode', () => {
      installFakeApi({})
      const a = panel({ id: 'pnl_00000000aa' })
      const b = panel({ id: 'pnl_00000000bb' })
      strip(a, b)
      render(<PanelCard panel={a} selected={false} onEdit={noEdit} />)
      expect(screen.getByRole('button', { name: 'Beside previous' })).toBeDisabled()
    })

    it('shows a failed Beside previous on the card', async () => {
      const a = panel({ id: 'pnl_00000000aa' })
      const b = panel({ id: 'pnl_00000000bb' })
      installFakeApi({
        'panels:update': () => {
          throw new Error('Unknown panel: pnl_00000000bb')
        }
      })
      strip(a, b)
      render(<PanelCard panel={b} selected={false} onEdit={noEdit} />)
      await userEvent.click(screen.getByRole('button', { name: 'Beside previous' }))
      expect(await within(screen.getByTestId('panel-card')).findByRole('alert')).toHaveTextContent('Unknown panel: pnl_00000000bb')
    })

    it('regenerates through panels:generate', async () => {
      const { calls } = installFakeApi({ 'panels:generate': () => undefined, 'panels:list': () => [] })
      render(<PanelCard panel={panel()} selected={false} onEdit={noEdit} />)
      await userEvent.click(screen.getByRole('button', { name: 'Regenerate' }))
      await waitFor(() => expect(calls.some((c) => c.channel === 'panels:generate')).toBe(true))
      expect(calls.find((c) => c.channel === 'panels:generate')?.req).toEqual({ projectId, panelId: 'pnl_0000000001' })
      expect(useAppStore.getState().selectedPanelId).toBeNull()
    })

    it('does not start a second generation while one is pending', () => {
      installFakeApi({})
      const pending = panelVersion({ id: 'ver_0000000002', status: 'pending', imagePath: null })
      render(<PanelCard panel={panel({ versions: [panelVersion(), pending] })} selected={false} onEdit={noEdit} />)
      expect(screen.getByRole('button', { name: 'Regenerate' })).toBeDisabled()
    })

    it('moves one place up or down, and not past the ends', async () => {
      const a = panel({ id: 'pnl_00000000aa' })
      const b = panel({ id: 'pnl_00000000bb' })
      const c = panel({ id: 'pnl_00000000cc' })
      const { calls } = installFakeApi({ 'panels:move': () => undefined, 'panels:list': () => [a, b, c] })
      strip(a, b, c)
      const { unmount } = render(<PanelCard panel={b} selected={false} onEdit={noEdit} />)
      await userEvent.click(screen.getByRole('button', { name: 'Move up' }))
      await userEvent.click(screen.getByRole('button', { name: 'Move down' }))
      const moves = calls.filter((x) => x.channel === 'panels:move').map((x) => x.req)
      expect(moves).toEqual([
        { projectId, panelId: 'pnl_00000000bb', toIndex: 0 },
        { projectId, panelId: 'pnl_00000000bb', toIndex: 2 }
      ])
      unmount()

      render(<PanelCard panel={a} selected={false} onEdit={noEdit} />)
      expect(screen.getByRole('button', { name: 'Move up' })).toBeDisabled()
      expect(screen.getByRole('button', { name: 'Move down' })).toBeEnabled()
    })

    it('disables Move down on the last panel', () => {
      installFakeApi({})
      const a = panel({ id: 'pnl_00000000aa' })
      const b = panel({ id: 'pnl_00000000bb' })
      strip(a, b)
      render(<PanelCard panel={b} selected={false} onEdit={noEdit} />)
      expect(screen.getByRole('button', { name: 'Move down' })).toBeDisabled()
      expect(screen.getByRole('button', { name: 'Move up' })).toBeEnabled()
    })

    it('asks before deleting, and deleting clears the selection', async () => {
      const { calls } = installFakeApi({ 'panels:delete': () => undefined, 'panels:list': () => [] })
      const p = panel()
      strip(p)
      useAppStore.setState({ selectedPanelId: p.id })
      render(<PanelCard panel={p} selected={true} onEdit={noEdit} />)
      await userEvent.click(screen.getByRole('button', { name: 'Delete' }))
      const confirm = screen.getByRole('dialog', { name: 'Delete panel' })
      expect(calls.some((c) => c.channel === 'panels:delete')).toBe(false)

      await userEvent.click(within(confirm).getByRole('button', { name: 'Cancel' }))
      expect(screen.queryByRole('dialog')).toBeNull()
      expect(calls.some((c) => c.channel === 'panels:delete')).toBe(false)

      await userEvent.click(screen.getByRole('button', { name: 'Delete' }))
      await userEvent.click(within(screen.getByRole('dialog', { name: 'Delete panel' })).getByRole('button', { name: 'Delete panel' }))
      await waitFor(() => expect(calls.some((c) => c.channel === 'panels:delete')).toBe(true))
      expect(calls.find((c) => c.channel === 'panels:delete')?.req).toEqual({ projectId, panelId: p.id })
      await waitFor(() => expect(useAppStore.getState().selectedPanelId).toBeNull())
    })

    it('shows an action failure on the card', async () => {
      installFakeApi({
        'panels:generate': () => {
          throw new Error('Unknown panel: pnl_0000000001')
        }
      })
      render(<PanelCard panel={panel()} selected={false} onEdit={noEdit} />)
      await userEvent.click(screen.getByRole('button', { name: 'Regenerate' }))
      expect(await within(screen.getByTestId('panel-card')).findByRole('alert')).toHaveTextContent('Unknown panel: pnl_0000000001')
    })
  })
})
