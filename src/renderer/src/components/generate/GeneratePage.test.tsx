import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import type { ProjectMeta } from '@shared/types'
import { initialAppState, useAppStore } from '../../stores/app-store'
import { initialCharactersState, useCharactersStore } from '../../stores/characters-store'
import { initialGenerateState, useGenerateStore } from '../../stores/generate-store'
import { initialItemsState, useItemsStore } from '../../stores/items-store'
import { initialLocationsState, useLocationsStore } from '../../stores/locations-store'
import { initialPanelsState, usePanelsStore } from '../../stores/panels-store'
import { character, PROJECT_ID as projectId, variation, withVariation } from '../../test/character-fixtures'
import { installFakeApi } from '../../test/fake-api'
import { item, withUsage } from '../../test/item-fixtures'
import { location } from '../../test/location-fixtures'
import { EPISODE_ID, panel } from '../../test/panel-fixtures'
import { GeneratePage } from './GeneratePage'

const a = panel({ id: 'pnl_00000000aa' })
const b = panel({ id: 'pnl_00000000bb' })
const mina = withVariation(character(), 'Blazer')
const sleepy = character({ id: 'chr_0000000002', name: 'Old Kim', archived: true, variations: [variation({ id: 'var_0000000009', characterId: 'chr_0000000002' })] })
const pistol = withUsage(item(), 'Aimed')
const stockroom = location()

function setup(handlers: Parameters<typeof installFakeApi>[0] = {}) {
  const made = panel({ id: 'pnl_00000000dd', versions: [], currentVersionId: null })
  const fake = installFakeApi({
    'characters:list': () => [mina, sleepy],
    'items:list': () => [pistol],
    'locations:list': () => [stockroom],
    'panels:create': () => ({ panel: made, warnings: [] }),
    'panels:list': () => [a, b, made],
    'panels:previewPrompt': () => ({ prompt: 'Automatic prompt', references: [], droppedPanelIds: [] }),
    'styles:list': () => ({ styles: [], loadError: null }),
    ...handlers
  })
  return { ...fake, made }
}

beforeEach(() => {
  useAppStore.setState({ ...initialAppState, projectId, activeEpisodeId: EPISODE_ID, projects: [{ id: projectId, defaultAspect: '2:3' } as unknown as ProjectMeta] })
  usePanelsStore.setState({ ...initialPanelsState, projectId, panelsByEpisode: { [EPISODE_ID]: [a, b] } })
  useCharactersStore.setState({ ...initialCharactersState })
  useItemsStore.setState({ ...initialItemsState })
  useLocationsStore.setState({ ...initialLocationsState })
  useGenerateStore.setState({ ...initialGenerateState })
  useGenerateStore.getState().open({ episodeId: EPISODE_ID, referencePanelIds: [a.id, b.id] })
})

describe('GeneratePage', () => {
  it('shows no AI chat', () => {
    setup()
    render(<GeneratePage />)
    expect(screen.queryByTestId('composer-input')).toBeNull()
    expect(screen.queryByTestId('pane-chat')).toBeNull()
  })

  it('shows every character, item and location', async () => {
    setup()
    render(<GeneratePage />)
    expect(await screen.findAllByTestId('library-character')).toHaveLength(1)
    expect(screen.getAllByTestId('library-item')).toHaveLength(1)
    expect(screen.getAllByTestId('library-location')).toHaveLength(1)
    expect(screen.getByTestId('library-character')).toHaveTextContent('Mina')
    expect(screen.queryByText('Old Kim')).toBeNull()
  })

  it('selecting a character uses a ready variation and shows the variation picker', async () => {
    setup()
    render(<GeneratePage />)
    const tile = await screen.findByTestId('library-character')
    expect(within(tile).queryByRole('combobox')).toBeNull()
    await userEvent.click(within(tile).getByRole('button', { name: /Mina/ }))
    expect(useGenerateStore.getState().draft.characters).toMatchObject([{ characterId: mina.id, variationId: mina.variations[0]?.id }])
    await userEvent.selectOptions(within(tile).getByRole('combobox', { name: 'Variation of Mina' }), 'Blazer')
    expect(useGenerateStore.getState().draft.characters[0]?.variationId).toBe(mina.variations[1]?.id)
  })

  it('selecting an item uses a ready usage held by nobody', async () => {
    setup()
    render(<GeneratePage />)
    const tile = await screen.findByTestId('library-item')
    await userEvent.click(within(tile).getByRole('button', { name: /Ray Pistol/ }))
    expect(useGenerateStore.getState().draft.items).toEqual([{ itemId: pistol.id, usageId: pistol.usages[0]?.id, heldBy: null, action: '' }])
    expect(within(tile).getByRole('combobox', { name: 'Usage of Ray Pistol' })).toBeInTheDocument()
  })

  it('selecting a location uses its base state and main camera', async () => {
    setup()
    render(<GeneratePage />)
    const tile = await screen.findByTestId('library-location')
    await userEvent.click(within(tile).getByRole('button', { name: /Back stockroom/ }))
    expect(useGenerateStore.getState().draft.location).toEqual({ locationId: stockroom.id, stateId: stockroom.states[0]?.id, camera: 'main' })
    await userEvent.click(within(tile).getByRole('button', { name: /Back stockroom/ }))
    expect(useGenerateStore.getState().draft.location).toBeNull()
  })

  it('shows the chosen panels and lets one be removed', async () => {
    setup()
    render(<GeneratePage />)
    expect(screen.getAllByTestId('reference-row')).toHaveLength(2)
    await userEvent.click(within(screen.getAllByTestId('reference-row')[0] as HTMLElement).getByRole('button', { name: 'Remove reference' }))
    expect(screen.getAllByTestId('reference-row')).toHaveLength(1)
    expect(useGenerateStore.getState().request?.referencePanelIds).toEqual([b.id])
  })

  it('Generate needs a description or a custom prompt', async () => {
    setup()
    render(<GeneratePage />)
    expect(screen.getByTestId('generate-submit')).toBeDisabled()
    useGenerateStore.getState().patch({ description: 'Mina waves' })
    await waitFor(() => expect(screen.getByTestId('generate-submit')).toBeEnabled())
    useGenerateStore.getState().patch({ description: '', promptOverride: 'A cat' })
    await waitFor(() => expect(screen.getByTestId('generate-submit')).toBeEnabled())
  })

  it('Generate creates and draws the panel after the last chosen one, closes, and selects it', async () => {
    const { calls, made } = setup()
    render(<GeneratePage />)
    useGenerateStore.getState().patch({ description: 'Mina waves' })
    await userEvent.click(await screen.findByTestId('generate-submit'))
    await waitFor(() => expect(useGenerateStore.getState().request).toBeNull())
    expect(calls.filter((c) => c.channel === 'panels:create').map((c) => c.req)).toMatchObject([
      { projectId, generate: true, draft: { episodeId: EPISODE_ID, afterPanelId: b.id, referencePanelIds: [a.id, b.id], description: 'Mina waves', shot: 'medium', aspect: '2:3' } }
    ])
    expect(useAppStore.getState().selectedPanelIds).toEqual([made.id])
  })

  it('Add blank panel creates without drawing', async () => {
    const { calls } = setup()
    render(<GeneratePage />)
    await userEvent.click(screen.getByTestId('generate-blank'))
    await waitFor(() => expect(useGenerateStore.getState().request).toBeNull())
    expect(calls.filter((c) => c.channel === 'panels:create').map((c) => c.req)).toMatchObject([{ generate: false, draft: { description: '' } }])
  })

  it('a refused create keeps the page and says why', async () => {
    setup({
      'panels:create': () => {
        throw new Error('Unknown episode: epi_0000000001')
      }
    })
    render(<GeneratePage />)
    await userEvent.click(screen.getByTestId('generate-blank'))
    expect(await screen.findByRole('alert')).toHaveTextContent('Unknown episode')
    expect(useGenerateStore.getState().request).not.toBeNull()
    expect(screen.getByTestId('generate-blank')).toBeEnabled()
  })

  it('Back with work asks first', async () => {
    setup()
    render(<GeneratePage />)
    useGenerateStore.getState().patch({ setting: 'A roof' })
    await userEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect(await screen.findByText('Discard this panel?')).toBeInTheDocument()
    expect(useGenerateStore.getState().request).not.toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Keep editing' }))
    expect(screen.queryByText('Discard this panel?')).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Back' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Discard' }))
    expect(useGenerateStore.getState().request).toBeNull()
  })

  it('Back after only drawing asks first', async () => {
    setup()
    render(<GeneratePage />)
    useGenerateStore.getState().patch({ sketchPng: 'data:image/png;base64,SKETCH' })
    await userEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect(await screen.findByText('Discard this panel?')).toBeInTheDocument()
  })

  it('has a sketch canvas under the chosen panels', () => {
    setup()
    render(<GeneratePage />)
    expect(screen.getByTestId('generate-sketch-canvas')).toBeInTheDocument()
  })

  it('Back with nothing asks nothing', async () => {
    setup()
    render(<GeneratePage />)
    await userEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect(screen.queryByText('Discard this panel?')).toBeNull()
    expect(useGenerateStore.getState().request).toBeNull()
  })

  it('drops a chosen character that was archived, and one that is gone', async () => {
    setup()
    render(<GeneratePage />)
    await screen.findByTestId('library-character')
    useGenerateStore.getState().toggleCharacter(mina)
    useGenerateStore.getState().toggleCharacter(sleepy)
    useGenerateStore.getState().toggleCharacter(character({ id: 'chr_0000000003', name: 'Gone' }))
    await waitFor(() => expect(useGenerateStore.getState().draft.characters.map((m) => m.characterId)).toEqual([mina.id]))
  })

  it('drops a chosen item that was archived or deleted, and a usage that is gone falls back', async () => {
    setup({ 'items:list': () => [pistol, item({ id: 'itm_0000000002', name: 'Old', archived: true })] })
    render(<GeneratePage />)
    await screen.findByTestId('library-item')
    useGenerateStore.getState().toggleItem(pistol)
    useGenerateStore.getState().toggleItem(item({ id: 'itm_0000000002', name: 'Old', archived: true }))
    useGenerateStore.getState().toggleItem(item({ id: 'itm_0000000003', name: 'Gone' }))
    useGenerateStore.getState().patch({ items: useGenerateStore.getState().draft.items.map((u) => (u.itemId === pistol.id ? { ...u, usageId: 'use_0000009999' } : u)) })
    await waitFor(() => expect(useGenerateStore.getState().draft.items).toEqual([{ itemId: pistol.id, usageId: pistol.usages[0]?.id, heldBy: null, action: '' }]))
  })

  it('drops a chosen location that was archived or deleted', async () => {
    setup({ 'locations:list': () => [location({ archived: true })] })
    render(<GeneratePage />)
    await waitFor(() => expect(useLocationsStore.getState().loaded).toBe(true))
    useGenerateStore.getState().patch({ location: { locationId: 'loc_0000000001', stateId: 'lst_0000000001', camera: 'main' } })
    await waitFor(() => expect(useGenerateStore.getState().draft.location).toBeNull())
    useGenerateStore.getState().patch({ location: { locationId: 'loc_0000000009', stateId: 'lst_0000000001', camera: 'main' } })
    await waitFor(() => expect(useGenerateStore.getState().draft.location).toBeNull())
  })

  it('a double click on Generate makes one panel', async () => {
    let release: () => void = () => undefined
    const gate = new Promise<void>((resolve) => (release = resolve))
    const { calls, made } = setup({
      'panels:create': async () => {
        await gate
        return { panel: made, warnings: [] }
      }
    })
    render(<GeneratePage />)
    useGenerateStore.getState().patch({ description: 'Mina waves' })
    await userEvent.dblClick(await screen.findByTestId('generate-submit'))
    release()
    await waitFor(() => expect(useGenerateStore.getState().request).toBeNull())
    expect(calls.filter((c) => c.channel === 'panels:create')).toHaveLength(1)
  })
})
