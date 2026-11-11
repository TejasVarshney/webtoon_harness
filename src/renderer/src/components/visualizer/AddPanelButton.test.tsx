import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import { initialAppState, useAppStore } from '../../stores/app-store'
import { initialGenerateState, useGenerateStore } from '../../stores/generate-store'
import { PROJECT_ID as projectId } from '../../test/character-fixtures'
import { installFakeApi } from '../../test/fake-api'
import { EPISODE_ID } from '../../test/panel-fixtures'
import { AddPanelButton } from './AddPanelButton'

beforeEach(() => {
  useAppStore.setState({ ...initialAppState, projectId, activeEpisodeId: EPISODE_ID })
  useGenerateStore.setState({ ...initialGenerateState })
})

describe('AddPanelButton', () => {
  it('opens the Generate page for the episode with no references, and makes no panel itself', async () => {
    const { calls } = installFakeApi({})
    render(<AddPanelButton episodeId={EPISODE_ID} testId="add-panel" />)
    await userEvent.click(screen.getByTestId('add-panel'))
    expect(useGenerateStore.getState().request).toEqual({ episodeId: EPISODE_ID, referencePanelIds: [] })
    expect(calls).toEqual([])
  })
})
