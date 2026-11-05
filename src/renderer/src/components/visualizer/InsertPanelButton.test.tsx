import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import type { PanelDraft } from '@shared/types'
import { initialAppState, useAppStore } from '../../stores/app-store'
import { initialPanelsState, usePanelsStore } from '../../stores/panels-store'
import { PROJECT_ID as projectId } from '../../test/character-fixtures'
import { installFakeApi } from '../../test/fake-api'
import { EPISODE_ID, panel } from '../../test/panel-fixtures'
import { InsertPanelButton } from './InsertPanelButton'

beforeEach(() => {
  useAppStore.setState({ ...initialAppState, projectId, activeEpisodeId: EPISODE_ID })
  usePanelsStore.setState({ ...initialPanelsState, projectId })
})

const creates = (calls: { channel: string; req: unknown }[]): { draft: PanelDraft; generate: boolean }[] =>
  calls
    .filter((c) => c.channel === 'panels:create')
    .map((c) => {
      const { draft, generate } = c.req as { draft: PanelDraft; generate: boolean }
      return { draft, generate }
    })

describe('InsertPanelButton', () => {
  it('makes a blank panel without an image and opens it in editing mode', async () => {
    const made = panel({ id: 'pnl_00000000cc', versions: [], currentVersionId: null })
    const { calls } = installFakeApi({ 'panels:create': () => ({ panel: made, warnings: [] }), 'panels:list': () => [made] })
    render(<InsertPanelButton episodeId={EPISODE_ID} />)
    await userEvent.click(screen.getByTestId('add-panel'))
    await waitFor(() => expect(useAppStore.getState().selectedPanelId).toBe(made.id))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(creates(calls)).toEqual([{ draft: { episodeId: EPISODE_ID, description: '', setting: '', shot: 'medium', characters: [], dialogue: [] }, generate: false }])
  })

  it('inserts after the panel it stands after', async () => {
    const { calls } = installFakeApi({ 'panels:create': () => ({ panel: panel(), warnings: [] }), 'panels:list': () => [] })
    render(<InsertPanelButton episodeId={EPISODE_ID} afterPanelId="pnl_00000000aa" />)
    await userEvent.click(screen.getByTestId('add-panel'))
    await waitFor(() => expect(creates(calls)).toHaveLength(1))
    expect(creates(calls)[0].draft.afterPanelId).toBe('pnl_00000000aa')
  })

  it('makes one panel for a double click', async () => {
    let release: () => void = () => undefined
    const gate = new Promise<void>((resolve) => (release = resolve))
    const { calls } = installFakeApi({
      'panels:create': async () => {
        await gate
        return { panel: panel(), warnings: [] }
      },
      'panels:list': () => []
    })
    render(<InsertPanelButton episodeId={EPISODE_ID} />)
    const button = screen.getByTestId('add-panel')
    await userEvent.dblClick(button)
    release()
    await waitFor(() => expect(useAppStore.getState().selectedPanelId).not.toBeNull())
    expect(creates(calls)).toHaveLength(1)
  })

  it('says why a panel could not be made, and opens nothing', async () => {
    installFakeApi({
      'panels:create': () => {
        throw new Error('Unknown episode: epi_0000000001')
      }
    })
    render(<InsertPanelButton episodeId={EPISODE_ID} />)
    await userEvent.click(screen.getByTestId('add-panel'))
    expect(await screen.findByRole('alert')).toHaveTextContent('Unknown episode')
    expect(useAppStore.getState().selectedPanelId).toBeNull()
  })
})
