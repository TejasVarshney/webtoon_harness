import { render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { exportRows } from '@shared/strip-layout'
import { initialAppState, useAppStore } from '../../stores/app-store'
import { initialCharactersState, useCharactersStore } from '../../stores/characters-store'
import { initialPanelsState, usePanelsStore } from '../../stores/panels-store'
import { PROJECT_ID as projectId, character } from '../../test/character-fixtures'
import { installFakeApi } from '../../test/fake-api'
import { EPISODE_ID, panel } from '../../test/panel-fixtures'
import { WebtoonStrip } from './WebtoonStrip'

const a = panel({ id: 'pnl_00000000aa', description: 'Mina arrives.' })
const b = panel({ id: 'pnl_00000000bb', description: 'Jin waits.', beside: true })

beforeEach(() => {
  useAppStore.setState({ ...initialAppState, projectId, activeEpisodeId: EPISODE_ID, selectedPanelId: a.id, selectedPanelIds: [a.id] })
  usePanelsStore.setState({ ...initialPanelsState, projectId, panelsByEpisode: { [EPISODE_ID]: [a, b] } })
  useCharactersStore.setState({ ...initialCharactersState, projectId, characters: [character()], loaded: true })
})

describe('WebtoonStrip', () => {
  it('draws the export rows with positions and none of the editing chrome', () => {
    installFakeApi({})
    render(<WebtoonStrip panels={[a, b]} rows={exportRows([a, b])} />)
    const cards = screen.getAllByTestId('panel-card')
    expect(cards.map((c) => c.getAttribute('data-position'))).toEqual(['1', '2'])
    expect(document.querySelectorAll('.strip-row')).toHaveLength(1)
    expect(screen.queryByTestId('add-panel')).toBeNull()
    expect(screen.queryByRole('group', { name: 'Panel actions' })).toBeNull()
    // Whatever the screen has selected stays out of the export.
    expect(cards[0].getAttribute('data-selected')).toBeNull()
    expect(within(cards[0]).getAllByRole('img')).toHaveLength(1)
  })

  it('leaves the lettering out when asked', () => {
    installFakeApi({})
    const lettered = panel({ id: 'pnl_00000000cc', dialogue: [{ id: 'dlg_0000000001', speakerId: null, kind: 'narration', text: 'Hello there', placement: null, style: null, tail: null }] })
    const { rerender } = render(<WebtoonStrip panels={[lettered]} />)
    expect(screen.getByText('Hello there')).toBeInTheDocument()
    rerender(<WebtoonStrip panels={[lettered]} lettering={false} />)
    expect(screen.queryByText('Hello there')).toBeNull()
  })
})
