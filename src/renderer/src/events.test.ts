import { waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Character, Episode, ProjectMeta, ProjectProblem } from '@shared/types'
import { startEventSync } from './events'
import { initialAppState, useAppStore } from './stores/app-store'
import { initialCharactersState, useCharactersStore } from './stores/characters-store'
import { initialPanelsState, usePanelsStore } from './stores/panels-store'
import { installFakeApi } from './test/fake-api'

const projectId = 'prj_aaaaaaaaaa'
const meta = { id: projectId, title: 'Moon' } as unknown as ProjectMeta
const episode = { id: 'epi_0000000001', number: 1, title: 'Episode 1', synopsis: '', panelIds: [] } as unknown as Episode
const corruptPanel: ProjectProblem = { path: 'panels/pnl_0000000bad.json', message: 'Unexpected token } in JSON' }
const corruptCharacter: ProjectProblem = { path: 'characters/chr_0000000bad.json', message: 'Invalid JSON' }

/**
 * Main records an unreadable file in the project's problems while it LISTS (panels:list, characters:list, ...),
 * which is after projects:open has answered. This fake does the same, so it shows whether the renderer re-reads
 * the problems once a list has loaded rather than racing it.
 */
function mainThatFindsProblemsWhileListing() {
  const problems: ProjectProblem[] = []
  return installFakeApi({
    'projects:open': () => ({ meta, problems: [...problems] }),
    'episodes:list': () => [episode],
    'panels:list': async () => {
      await new Promise((r) => setTimeout(r, 5))
      problems.push(corruptPanel)
      return []
    },
    'characters:list': () => {
      problems.push(corruptCharacter)
      return [] as Character[]
    }
  })
}

let stop: (() => void) | null = null
beforeEach(() => {
  useAppStore.setState({ ...initialAppState, projects: [meta], projectId })
  usePanelsStore.setState({ ...initialPanelsState })
  useCharactersStore.setState({ ...initialCharactersState })
})
afterEach(() => {
  stop?.()
  stop = null
})

describe('project problems refresh (I1)', () => {
  it('shows a problem found by the first panel load after the project opened', async () => {
    mainThatFindsProblemsWhileListing()
    stop = startEventSync()
    // The initial load: no event announces it.
    await usePanelsStore.getState().loadEpisodes()
    await waitFor(() => expect(useAppStore.getState().problems).toEqual([corruptPanel]))
  })

  it('re-reads the problems after an event-driven reload', async () => {
    const { emit } = mainThatFindsProblemsWhileListing()
    stop = startEventSync()
    emit({ type: 'character.changed', projectId, characterId: 'chr_0000000001' })
    await waitFor(() => expect(useAppStore.getState().problems).toEqual([corruptCharacter]))
  })

  it('ignores the answer when the user switched project meanwhile', async () => {
    installFakeApi({ 'projects:open': () => ({ meta, problems: [corruptPanel] }), 'characters:list': () => [] })
    stop = startEventSync()
    const refreshing = useAppStore.getState().refreshProblems()
    useAppStore.setState({ projectId: 'prj_bbbbbbbbbb', problems: [] })
    await refreshing
    expect(useAppStore.getState().problems).toEqual([])
  })
})
