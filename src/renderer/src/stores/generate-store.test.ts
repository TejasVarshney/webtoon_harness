import { beforeEach, describe, expect, it } from 'vitest'
import type { ProjectMeta } from '@shared/types'
import { character } from '../test/character-fixtures'
import { installFakeApi } from '../test/fake-api'
import { item } from '../test/item-fixtures'
import { EPISODE_ID, panel } from '../test/panel-fixtures'
import { initialAppState, useAppStore } from './app-store'
import { initialGenerateState, useGenerateStore } from './generate-store'
import { initialPanelsState, usePanelsStore } from './panels-store'

const projectId = 'prj_aaaaaaaaaa'
const request = { episodeId: EPISODE_ID, referencePanelIds: ['pnl_00000000aa', 'pnl_00000000bb', 'pnl_00000000cc'] }

beforeEach(() => {
  useAppStore.setState({ ...initialAppState, projectId, activeEpisodeId: EPISODE_ID, projects: [{ id: projectId, defaultAspect: '9:16' } as unknown as ProjectMeta] })
  usePanelsStore.setState({ ...initialPanelsState, projectId })
  useGenerateStore.setState({ ...initialGenerateState })
})

describe('useGenerateStore', () => {
  it('opens with an empty draft in the project aspect, and closes', () => {
    useGenerateStore.getState().open(request)
    expect(useGenerateStore.getState().request).toEqual(request)
    expect(useGenerateStore.getState().draft.aspect).toBe('9:16')
    useGenerateStore.getState().close()
    expect(useGenerateStore.getState().request).toBeNull()
  })

  it('toggles a character and an item on and off', () => {
    useGenerateStore.getState().open(request)
    const { toggleCharacter, toggleItem } = useGenerateStore.getState()
    toggleCharacter(character())
    toggleItem(item())
    expect(useGenerateStore.getState().draft.characters).toEqual([{ characterId: 'chr_0000000001', variationId: 'var_0000000001', action: '', expression: '', position: 'center' }])
    expect(useGenerateStore.getState().draft.items).toEqual([{ itemId: 'itm_0000000001', usageId: 'use_0000000001', heldBy: null, action: '' }])
    toggleCharacter(character())
    toggleItem(item())
    expect(useGenerateStore.getState().draft.characters).toEqual([])
    expect(useGenerateStore.getState().draft.items).toEqual([])
  })

  it('removes a chosen panel, and is dirty only once something is entered', () => {
    useGenerateStore.getState().open(request)
    useGenerateStore.getState().removeReference('pnl_00000000bb')
    expect(useGenerateStore.getState().request?.referencePanelIds).toEqual(['pnl_00000000aa', 'pnl_00000000cc'])
    expect(useGenerateStore.getState().isDirty()).toBe(false)
    useGenerateStore.getState().patch({ description: 'x' })
    expect(useGenerateStore.getState().isDirty()).toBe(true)
  })

  it('submits after the last remaining chosen panel, then closes and reveals the new panel', async () => {
    const made = panel({ id: 'pnl_00000000dd' })
    const { calls } = installFakeApi({ 'panels:create': () => ({ panel: made, warnings: [] }), 'panels:list': () => [made] })
    useGenerateStore.getState().open(request)
    useGenerateStore.getState().removeReference('pnl_00000000cc')
    useGenerateStore.getState().patch({ description: 'Mina waves', sketchPng: 'data:image/png;base64,AA' })
    await useGenerateStore.getState().submit(true)
    expect(calls.find((c) => c.channel === 'panels:create')?.req).toMatchObject({
      generate: true,
      sketchPng: 'data:image/png;base64,AA',
      draft: { episodeId: EPISODE_ID, afterPanelId: 'pnl_00000000bb', referencePanelIds: ['pnl_00000000aa', 'pnl_00000000bb'], description: 'Mina waves' }
    })
    expect(useGenerateStore.getState().request).toBeNull()
    expect(useAppStore.getState().selectedPanelIds).toEqual([made.id])
    expect(useGenerateStore.getState().revealPanelId).toBe(made.id)
  })

  it('refuses to draw without a description or prompt, and sends nothing', async () => {
    const { calls } = installFakeApi({})
    useGenerateStore.getState().open(request)
    await expect(useGenerateStore.getState().submit(true)).rejects.toThrow('Describe the panel or write a prompt to generate it')
    expect(calls).toEqual([])
    expect(useGenerateStore.getState().request).not.toBeNull()
  })
})
