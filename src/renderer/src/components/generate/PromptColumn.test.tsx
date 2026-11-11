import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import type { PromptPreview, ProjectMeta } from '@shared/types'
import { initialAppState, useAppStore } from '../../stores/app-store'
import { initialGenerateState, useGenerateStore } from '../../stores/generate-store'
import { initialPanelsState, usePanelsStore } from '../../stores/panels-store'
import { character, PROJECT_ID as projectId } from '../../test/character-fixtures'
import { installFakeApi } from '../../test/fake-api'
import { EPISODE_ID } from '../../test/panel-fixtures'
import { PromptColumn } from './PromptColumn'

const NOTICE = 'Your selections changed. Reset to automatic to renumber the references.'
const noir = { id: 'sty_00000000a1', name: 'Noir ink', text: 'Heavy black ink, noir', builtin: true, edited: false }
const pastel = { id: 'sty_00000000a2', name: 'Pastel', text: 'Soft pastel washes', builtin: true, edited: false }

const preview = (prompt: string, droppedPanelIds: string[] = []): PromptPreview => ({ prompt, references: [], droppedPanelIds })

function setup(handlers: Parameters<typeof installFakeApi>[0] = {}) {
  return installFakeApi({
    'styles:list': () => ({ styles: [noir, pastel], loadError: null }),
    'panels:previewPrompt': () => preview('Automatic prompt'),
    ...handlers
  })
}

const previewCalls = (calls: { channel: string; req: unknown }[]) => calls.filter((c) => c.channel === 'panels:previewPrompt')

beforeEach(() => {
  useAppStore.setState({ ...initialAppState, projectId, projects: [{ id: projectId, defaultAspect: '2:3' } as unknown as ProjectMeta] })
  usePanelsStore.setState({ ...initialPanelsState, projectId })
  useGenerateStore.setState({ ...initialGenerateState })
  useGenerateStore.getState().open({ episodeId: EPISODE_ID, referencePanelIds: [] })
})

describe('PromptColumn', () => {
  it('the prompt follows the selections until edited', async () => {
    let text = 'First prompt'
    const { calls } = setup({ 'panels:previewPrompt': () => preview(text) })
    render(<PromptColumn />)
    await waitFor(() => expect(screen.getByLabelText('Prompt')).toHaveValue('First prompt'))
    text = 'Prompt with Mina'
    act(() => useGenerateStore.getState().toggleCharacter(character()))
    await waitFor(() => expect(screen.getByLabelText('Prompt')).toHaveValue('Prompt with Mina'))
    expect(previewCalls(calls)).toHaveLength(2)
    expect(previewCalls(calls)[1]?.req).toMatchObject({ projectId, hasSketch: false, draft: { characters: [{ characterId: character().id }] } })
  })

  it('an edit is kept when selections change, with a notice', async () => {
    let text = 'First prompt'
    setup({ 'panels:previewPrompt': () => preview(text) })
    render(<PromptColumn />)
    await waitFor(() => expect(screen.getByLabelText('Prompt')).toHaveValue('First prompt'))
    expect(screen.queryByText(NOTICE)).toBeNull()
    await userEvent.type(screen.getByLabelText('Prompt'), '!')
    expect(useGenerateStore.getState().draft.promptOverride).toBe('First prompt!')
    expect(screen.queryByText(NOTICE)).toBeNull()
    text = 'Second prompt'
    act(() => useGenerateStore.getState().patch({ setting: 'A roof' }))
    expect(await screen.findByText(NOTICE)).toBeInTheDocument()
    expect(screen.getByLabelText('Prompt')).toHaveValue('First prompt!')
  })

  it('Reset to automatic clears the edit', async () => {
    let text = 'First prompt'
    setup({ 'panels:previewPrompt': () => preview(text) })
    render(<PromptColumn />)
    await waitFor(() => expect(screen.getByLabelText('Prompt')).toHaveValue('First prompt'))
    await userEvent.type(screen.getByLabelText('Prompt'), '!')
    text = 'Second prompt'
    act(() => useGenerateStore.getState().patch({ setting: 'A roof' }))
    await screen.findByText(NOTICE)
    await userEvent.click(screen.getByRole('button', { name: 'Reset to automatic' }))
    expect(useGenerateStore.getState().draft.promptOverride).toBeNull()
    expect(screen.getByLabelText('Prompt')).toHaveValue('Second prompt')
    expect(screen.queryByText(NOTICE)).toBeNull()
  })

  it('a late preview never overwrites a newer one', async () => {
    const releases: ((p: PromptPreview) => void)[] = []
    setup({ 'panels:previewPrompt': () => new Promise<PromptPreview>((resolve) => releases.push(resolve)) })
    render(<PromptColumn />)
    await waitFor(() => expect(releases).toHaveLength(1))
    act(() => useGenerateStore.getState().patch({ setting: 'A roof' }))
    await waitFor(() => expect(releases).toHaveLength(2))
    await act(async () => releases[1]?.(preview('Newer')))
    await waitFor(() => expect(screen.getByLabelText('Prompt')).toHaveValue('Newer'))
    await act(async () => releases[0]?.(preview('Older')))
    expect(screen.getByLabelText('Prompt')).toHaveValue('Newer')
  })

  it('style defaults to Project style', async () => {
    setup()
    render(<PromptColumn />)
    expect(await screen.findByRole('option', { name: 'Noir ink' })).toBeInTheDocument()
    expect(screen.getByLabelText('Style')).toHaveDisplayValue('Project style')
    expect(useGenerateStore.getState().draft.styleOverride).toBeNull()
    expect(screen.queryByLabelText('Custom style')).toBeNull()
  })

  it('choosing a library style stores its words', async () => {
    setup()
    render(<PromptColumn />)
    await screen.findByRole('option', { name: 'Pastel' })
    await userEvent.selectOptions(screen.getByLabelText('Style'), 'Pastel')
    expect(useGenerateStore.getState().draft.styleOverride).toBe('Soft pastel washes')
    await userEvent.selectOptions(screen.getByLabelText('Style'), 'Project style')
    expect(useGenerateStore.getState().draft.styleOverride).toBeNull()
  })

  it('a style change refreshes the preview', async () => {
    const { calls } = setup()
    render(<PromptColumn />)
    await screen.findByRole('option', { name: 'Pastel' })
    await waitFor(() => expect(previewCalls(calls)).toHaveLength(1))
    await userEvent.selectOptions(screen.getByLabelText('Style'), 'Pastel')
    await waitFor(() => expect(previewCalls(calls)).toHaveLength(2))
    expect(previewCalls(calls)[1]?.req).toMatchObject({ draft: { styleOverride: 'Soft pastel washes' } })
  })

  it('typed style text is kept', async () => {
    setup()
    render(<PromptColumn />)
    await screen.findByRole('option', { name: 'Pastel' })
    await userEvent.selectOptions(screen.getByLabelText('Style'), 'Custom')
    await userEvent.type(screen.getByLabelText('Custom style'), 'Chalk on slate')
    expect(useGenerateStore.getState().draft.styleOverride).toBe('Chalk on slate')
    expect(screen.getByLabelText('Style')).toHaveDisplayValue('Custom')
    expect(screen.getByLabelText('Custom style')).toHaveValue('Chalk on slate')
  })

  it('edits the description, setting, shot and aspect of the draft', async () => {
    setup()
    render(<PromptColumn />)
    await userEvent.type(screen.getByLabelText('Description'), 'Mina waves')
    await userEvent.type(screen.getByLabelText('Setting'), 'A roof')
    await userEvent.selectOptions(screen.getByLabelText('Shot'), 'close-up')
    await userEvent.selectOptions(screen.getByLabelText('Aspect'), '1:1')
    expect(useGenerateStore.getState().draft).toMatchObject({ description: 'Mina waves', setting: 'A roof', shot: 'close-up', aspect: '1:1' })
  })

  it('says how many chosen panels will not be sent', async () => {
    setup({ 'panels:previewPrompt': () => preview('P', ['pnl_00000000aa', 'pnl_00000000bb']) })
    render(<PromptColumn />)
    expect(await screen.findByText("2 chosen panels won't be sent: this image model takes fewer references.")).toBeInTheDocument()
  })

  it('says it in the singular for one chosen panel', async () => {
    setup({ 'panels:previewPrompt': () => preview('P', ['pnl_00000000aa']) })
    render(<PromptColumn />)
    expect(await screen.findByText("1 chosen panel won't be sent: this image model takes fewer references.")).toBeInTheDocument()
  })

  it('a preview failure shows its reason and the fields still work', async () => {
    setup({
      'panels:previewPrompt': () => {
        throw new Error('Unknown episode: epi_0000000001')
      }
    })
    render(<PromptColumn />)
    expect(await screen.findByText(/Unknown episode/)).toBeInTheDocument()
    await userEvent.type(screen.getByLabelText('Description'), 'Mina waves')
    expect(useGenerateStore.getState().draft.description).toBe('Mina waves')
  })
})
