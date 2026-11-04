import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import { initialAppState, useAppStore } from '../../stores/app-store'
import { initialCharactersState, useCharactersStore } from '../../stores/characters-store'
import { initialPanelsState, usePanelsStore } from '../../stores/panels-store'
import { PROJECT_ID as projectId, character } from '../../test/character-fixtures'
import { installFakeApi } from '../../test/fake-api'
import { EPISODE_ID, panel } from '../../test/panel-fixtures'
import { WebtoonStrip } from './WebtoonStrip'

const a = panel({ id: 'pnl_00000000aa', description: 'Mina arrives.' })
const b = panel({ id: 'pnl_00000000bb', description: 'Jin waits.' })

beforeEach(() => {
  useAppStore.setState({ ...initialAppState, projectId, activeEpisodeId: EPISODE_ID })
  usePanelsStore.setState({ ...initialPanelsState, projectId, panelsByEpisode: { [EPISODE_ID]: [a, b] } })
  useCharactersStore.setState({ ...initialCharactersState, projectId, characters: [character()], loaded: true })
})

/** The strip as the pane drives it: panels read from the store, so a save that reloads them re-renders the rows. */
function Harness() {
  const panels = usePanelsStore((s) => s.panelsByEpisode[EPISODE_ID] ?? [])
  return <WebtoonStrip episodeId={EPISODE_ID} panels={panels} />
}

const rows = (): number => document.querySelectorAll('.strip-row').length

describe('WebtoonStrip', () => {
  it('keeps the editor open when saving moves its panel to another row', async () => {
    const warning = 'Mentioned but not attached: Sora. Attach them to characters or list them in offPanelMentions.'
    const beside = panel({ ...b, beside: true })
    installFakeApi({ 'panels:update': () => ({ panel: beside, warnings: [warning] }), 'panels:list': () => [a, beside] })
    render(<Harness />)
    // Two rows of one, then one row of two: the card is rebuilt in a different row.
    expect(rows()).toBe(2)

    await userEvent.click(within(screen.getAllByTestId('panel-card')[1]).getByRole('button', { name: 'Edit' }))
    const dialog = await screen.findByTestId('panel-editor')
    const editor = within(dialog)
    expect(editor.getByLabelText('Description')).toHaveValue('Jin waits.')
    // Lettering scales against its row, so the dialog is not inside one (nor inside a card).
    expect(dialog.closest('.strip-row')).toBeNull()

    await userEvent.click(editor.getByLabelText('Beside the previous panel'))
    await userEvent.click(editor.getByRole('button', { name: 'Save' }))

    expect(await screen.findByText(/Mentioned but not attached: Sora/)).toBeInTheDocument()
    await waitFor(() => expect(rows()).toBe(1))
    // Still there, waiting for Close.
    expect(screen.getByTestId('panel-editor')).toBeInTheDocument()
    expect(editor.getByRole('button', { name: 'Close' })).toBeInTheDocument()
    expect(useAppStore.getState().selectedPanelId).toBeNull()

    await userEvent.click(editor.getByRole('button', { name: 'Close' }))
    expect(screen.queryByTestId('panel-editor')).toBeNull()
  })

  it('opens the editor on the panel whose Edit was clicked, and again on another', async () => {
    installFakeApi({})
    render(<Harness />)
    await userEvent.click(within(screen.getAllByTestId('panel-card')[0]).getByRole('button', { name: 'Edit' }))
    expect(within(await screen.findByTestId('panel-editor')).getByLabelText('Description')).toHaveValue('Mina arrives.')
    await userEvent.click(within(screen.getByTestId('panel-editor')).getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByTestId('panel-editor')).toBeNull()
    await userEvent.click(within(screen.getAllByTestId('panel-card')[1]).getByRole('button', { name: 'Edit' }))
    expect(within(await screen.findByTestId('panel-editor')).getByLabelText('Description')).toHaveValue('Jin waits.')
    // A click in the dialog does not reach a card.
    await userEvent.click(within(screen.getByTestId('panel-editor')).getByLabelText('Description'))
    expect(useAppStore.getState().selectedPanelId).toBeNull()
  })

  it('keeps the end "+" the last child of the strip while an editor is open', async () => {
    installFakeApi({})
    render(<Harness />)
    const endPlus = (): Element | null => document.querySelector('.webtoon-strip > .insert-panel:last-child')
    expect(endPlus()).not.toBeNull()
    await userEvent.click(within(screen.getAllByTestId('panel-card')[0]).getByRole('button', { name: 'Edit' }))
    await screen.findByTestId('panel-editor')
    expect(endPlus()).not.toBeNull()
  })

  it('does not open the editor again for a panel that comes back', async () => {
    installFakeApi({})
    render(<Harness />)
    await userEvent.click(within(screen.getAllByTestId('panel-card')[1]).getByRole('button', { name: 'Edit' }))
    await screen.findByTestId('panel-editor')
    usePanelsStore.setState({ panelsByEpisode: { [EPISODE_ID]: [a] } })
    await waitFor(() => expect(screen.queryByTestId('panel-editor')).toBeNull())
    // Restored from the trash, say: the user is not editing it now.
    usePanelsStore.setState({ panelsByEpisode: { [EPISODE_ID]: [a, b] } })
    await waitFor(() => expect(screen.getAllByTestId('panel-card')).toHaveLength(2))
    expect(screen.queryByTestId('panel-editor')).toBeNull()
  })

  it('drops the editor when its panel is gone', async () => {
    installFakeApi({})
    render(<Harness />)
    await userEvent.click(within(screen.getAllByTestId('panel-card')[1]).getByRole('button', { name: 'Edit' }))
    await screen.findByTestId('panel-editor')
    usePanelsStore.setState({ panelsByEpisode: { [EPISODE_ID]: [a] } })
    await waitFor(() => expect(screen.queryByTestId('panel-editor')).toBeNull())
  })
})
