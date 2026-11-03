import { render, screen, within } from '@testing-library/react'
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

describe('WebtoonStrip', () => {
  it('opens no editor of its own: a click on a card selects the panel, for the editing mode', async () => {
    installFakeApi({})
    render(<Harness />)
    const second = screen.getAllByTestId('panel-card')[1]
    expect(within(second).queryByRole('button', { name: 'Edit' })).toBeNull()
    await userEvent.click(second)
    expect(useAppStore.getState().selectedPanelId).toBe(b.id)
    expect(screen.queryByTestId('panel-editor')).toBeNull()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('keeps the end "+" the last child of the strip', () => {
    installFakeApi({})
    render(<Harness />)
    expect(document.querySelector('.webtoon-strip > .insert-panel:last-child')).not.toBeNull()
  })
})
