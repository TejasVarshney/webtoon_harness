import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import type { PanelDraft } from '@shared/types'
import { initialAppState, useAppStore } from '../../stores/app-store'
import { initialCharactersState, useCharactersStore } from '../../stores/characters-store'
import { initialPanelsState, usePanelsStore } from '../../stores/panels-store'
import { PROJECT_ID as projectId, character } from '../../test/character-fixtures'
import { installFakeApi } from '../../test/fake-api'
import { EPISODE_ID, panel } from '../../test/panel-fixtures'
import { InsertPanelButton } from './InsertPanelButton'

beforeEach(() => {
  useAppStore.setState({ ...initialAppState, projectId, activeEpisodeId: EPISODE_ID })
  usePanelsStore.setState({ ...initialPanelsState, projectId })
  useCharactersStore.setState({ ...initialCharactersState, projectId, characters: [character()], loaded: true })
})

const draftOf = (calls: { channel: string; req: unknown }[]): PanelDraft => (calls.find((c) => c.channel === 'panels:create')?.req as { draft: PanelDraft }).draft

describe('InsertPanelButton', () => {
  it('opens the editor in create mode', async () => {
    installFakeApi({})
    render(<InsertPanelButton episodeId={EPISODE_ID} />)
    expect(screen.queryByTestId('panel-editor')).toBeNull()
    await userEvent.click(screen.getByTestId('add-panel'))
    expect(screen.getByRole('dialog', { name: 'New panel' })).toBeInTheDocument()
  })

  it('inserts where it was opened, even if its parent names another panel afterwards', async () => {
    const { calls } = installFakeApi({ 'panels:create': () => ({ panel: panel(), warnings: [] }), 'panels:list': () => [] })
    const { rerender } = render(<InsertPanelButton episodeId={EPISODE_ID} afterPanelId="pnl_00000000aa" />)
    await userEvent.click(screen.getByTestId('add-panel'))
    // The strip changed under the open dialog (a panel was added elsewhere): the insert point must not follow it.
    rerender(<InsertPanelButton episodeId={EPISODE_ID} afterPanelId="pnl_00000000bb" />)
    await userEvent.click(within(screen.getByTestId('panel-editor')).getByRole('button', { name: 'Create without image' }))
    await waitFor(() => expect(screen.queryByTestId('panel-editor')).toBeNull())
    expect(draftOf(calls).afterPanelId).toBe('pnl_00000000aa')
  })

  it('opens again at its current panel after the dialog closed', async () => {
    const { calls } = installFakeApi({ 'panels:create': () => ({ panel: panel(), warnings: [] }), 'panels:list': () => [] })
    const { rerender } = render(<InsertPanelButton episodeId={EPISODE_ID} afterPanelId="pnl_00000000aa" />)
    await userEvent.click(screen.getByTestId('add-panel'))
    await userEvent.click(within(screen.getByTestId('panel-editor')).getByRole('button', { name: 'Cancel' }))
    rerender(<InsertPanelButton episodeId={EPISODE_ID} afterPanelId="pnl_00000000bb" />)
    await userEvent.click(screen.getByTestId('add-panel'))
    await userEvent.click(within(screen.getByTestId('panel-editor')).getByRole('button', { name: 'Create without image' }))
    await waitFor(() => expect(calls.some((c) => c.channel === 'panels:create')).toBe(true))
    expect(draftOf(calls).afterPanelId).toBe('pnl_00000000bb')
  })
})
