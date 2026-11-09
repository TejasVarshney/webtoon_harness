import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import { initialAppState, useAppStore } from '../../stores/app-store'
import { initialPanelsState, usePanelsStore } from '../../stores/panels-store'
import { PROJECT_ID as projectId } from '../../test/character-fixtures'
import { installFakeApi } from '../../test/fake-api'
import { EPISODE_ID, panel } from '../../test/panel-fixtures'
import { AddPanelButton } from './AddPanelButton'

beforeEach(() => {
  useAppStore.setState({ ...initialAppState, projectId, activeEpisodeId: EPISODE_ID })
  usePanelsStore.setState({ ...initialPanelsState, projectId })
})

describe('AddPanelButton', () => {
  it('makes one panel for a double click, and opens it in editing mode', async () => {
    let release: () => void = () => undefined
    const gate = new Promise<void>((resolve) => (release = resolve))
    const made = panel({ id: 'pnl_00000000cc' })
    const { calls } = installFakeApi({
      'panels:create': async () => {
        await gate
        return { panel: made, warnings: [] }
      },
      'panels:list': () => [made]
    })
    render(<AddPanelButton episodeId={EPISODE_ID} testId="add-panel" />)
    await userEvent.dblClick(screen.getByTestId('add-panel'))
    release()
    await waitFor(() => expect(useAppStore.getState().focusedPanelId).toBe(made.id))
    expect(calls.filter((c) => c.channel === 'panels:create')).toHaveLength(1)
  })

  it('says why a panel could not be made, and opens nothing', async () => {
    installFakeApi({
      'panels:create': () => {
        throw new Error('Unknown episode: epi_0000000001')
      }
    })
    render(<AddPanelButton episodeId={EPISODE_ID} testId="add-panel" />)
    await userEvent.click(screen.getByTestId('add-panel'))
    expect(await screen.findByRole('alert')).toHaveTextContent('Unknown episode')
    expect(useAppStore.getState().focusedPanelId).toBeNull()
  })
})
