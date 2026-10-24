import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Panel, PanelDraft, PanelPatch, ProjectMeta } from '@shared/types'
import { initialAppState, useAppStore } from '../../stores/app-store'
import { initialCharactersState, useCharactersStore } from '../../stores/characters-store'
import { initialPanelsState, usePanelsStore } from '../../stores/panels-store'
import { PROJECT_ID as projectId, character, variation, withVariation } from '../../test/character-fixtures'
import { installFakeApi } from '../../test/fake-api'
import { EPISODE_ID, panel } from '../../test/panel-fixtures'
import { PanelEditorDialog, type PanelEditorDialogProps } from './PanelEditorDialog'

// Mina has a ready base, a ready outfit, a pending look and a failed one; Jin is archived.
const mina = withVariation(
  withVariation(withVariation(character(), 'Outfit: School', { id: 'var_0000000002' }), 'Smile', { id: 'var_0000000003', status: 'pending', imagePath: null }),
  'Rage',
  { id: 'var_0000000004', status: 'failed', imagePath: null, error: 'boom' }
)
const jin = character({ id: 'chr_0000000002', name: 'Jin', role: 'supporting', archived: true, variations: [variation({ id: 'var_00000000j1', characterId: 'chr_0000000002' })] })
const sora = character({ id: 'chr_0000000003', name: 'Sora', role: 'supporting', variations: [variation({ id: 'var_00000000s1', characterId: 'chr_0000000003', name: 'Base' })] })
const ghost = character({ id: 'chr_0000000004', name: 'Ghost', variations: [variation({ id: 'var_00000000g1', characterId: 'chr_0000000004', status: 'pending', imagePath: null })] })

const created = panel({ id: 'pnl_0000000009', versions: [], currentVersionId: null })

beforeEach(() => {
  useAppStore.setState({ ...initialAppState, projectId, activeEpisodeId: EPISODE_ID })
  usePanelsStore.setState({ ...initialPanelsState, projectId })
  useCharactersStore.setState({ ...initialCharactersState, projectId, characters: [mina, jin, sora, ghost], loaded: true })
})

type Handlers = Parameters<typeof installFakeApi>[0]

function mount(handlers: Handlers = {}, props: Partial<PanelEditorDialogProps> = {}) {
  const onClose = vi.fn()
  const api = installFakeApi({
    'panels:create': () => ({ panel: created, warnings: [] }),
    'panels:update': () => ({ panel: panel(), warnings: [] }),
    'panels:list': () => [],
    ...handlers
  })
  render(<PanelEditorDialog mode="create" episodeId={EPISODE_ID} onClose={onClose} {...props} />)
  return { ...api, onClose, editor: within(screen.getByTestId('panel-editor')) }
}

const sent = (calls: { channel: string; req: unknown }[], channel: string): unknown[] => calls.filter((c) => c.channel === channel).map((c) => c.req)
const optionLabels = (select: HTMLElement): string[] => within(select).getAllByRole('option').map((o) => o.textContent ?? '')

describe('PanelEditorDialog', () => {
  it('cast picker lists only active characters and ready variations', async () => {
    const { editor } = mount()
    expect(editor.queryByLabelText('Character')).toBeNull()
    await userEvent.click(editor.getByRole('button', { name: 'Add character' }))
    // Archived Jin is hidden. Ghost has no ready look but is still a character the user may pick.
    expect(optionLabels(editor.getByLabelText('Character'))).toEqual(['Mina', 'Sora', 'Ghost'])
    // The pending and the failed variation cannot be a reference, so they are not offered.
    expect(optionLabels(editor.getByLabelText('Variation'))).toEqual(['Base', 'Outfit: School'])
    // A new row defaults to the character's base look.
    expect(editor.getByLabelText('Variation')).toHaveValue('var_0000000001')
  })

  it('adds rows for characters not cast yet, and resets the look when the character changes', async () => {
    const { editor } = mount()
    await userEvent.click(editor.getByRole('button', { name: 'Add character' }))
    await userEvent.selectOptions(editor.getByLabelText('Variation'), 'Outfit: School')
    await userEvent.click(editor.getByRole('button', { name: 'Add character' }))
    const [first, second] = editor.getAllByLabelText('Character')
    expect(first).toHaveValue(mina.id)
    // Mina is already cast, so the second row starts on the next character.
    expect(second).toHaveValue(sora.id)
    await userEvent.selectOptions(first, 'Sora')
    expect(editor.getAllByLabelText('Variation')[0]).toHaveValue('var_00000000s1')
    await userEvent.click(editor.getAllByRole('button', { name: 'Remove cast member' })[1])
    expect(editor.getAllByLabelText('Character')).toHaveLength(1)
  })

  it('says why a character without a ready look cannot be cast yet', async () => {
    const { editor, calls } = mount()
    await userEvent.click(editor.getByRole('button', { name: 'Add character' }))
    await userEvent.selectOptions(editor.getByLabelText('Character'), 'Ghost')
    expect(editor.getByText(/no ready variation/i)).toBeInTheDocument()
    expect(editor.getByLabelText('Variation')).toBeDisabled()
    // A row that cannot be cast would only come back as a server error: block it here.
    expect(editor.getByRole('button', { name: 'Create & generate' })).toBeDisabled()
    expect(editor.getByRole('button', { name: 'Create without image' })).toBeDisabled()
    expect(sent(calls, 'panels:create')).toEqual([])
  })

  it('has no add button when no character is active', () => {
    useCharactersStore.setState({ characters: [jin] })
    const { editor } = mount()
    expect(editor.getByRole('button', { name: 'Add character' })).toBeDisabled()
  })

  it('loads the characters itself when nothing has', async () => {
    useCharactersStore.setState({ ...initialCharactersState })
    const { editor } = mount({ 'characters:list': () => [mina, jin] })
    await waitFor(() => expect(editor.getByRole('button', { name: 'Add character' })).toBeEnabled())
    await userEvent.click(editor.getByRole('button', { name: 'Add character' }))
    expect(optionLabels(editor.getByLabelText('Character'))).toEqual(['Mina'])
  })

  it('labels the fields the editor is tested through', () => {
    const { editor } = mount()
    for (const label of ['Description', 'Setting', 'Shot', 'Aspect']) expect(editor.getByLabelText(label)).toBeInTheDocument()
    expect(editor.getByLabelText('Shot')).toHaveValue('medium')
    expect(editor.getByLabelText('Aspect')).toHaveValue('2:3')
    expect(optionLabels(editor.getByLabelText('Aspect'))).toEqual(['1:1', '2:3', '3:4', '9:16', '4:3', '16:9'])
    expect(optionLabels(editor.getByLabelText('Shot'))).toContain('over-the-shoulder')
  })

  it("starts from the project's default aspect", () => {
    const meta: ProjectMeta = {
      id: projectId,
      title: 'Moon Diary',
      logline: '',
      stylePreset: '',
      storyMode: 'user',
      defaultAspect: '9:16',
      autopilotPanels: 4,
      consistencyRetries: 1,
      createdAt: '2026-10-21T10:00:00.000Z',
      updatedAt: '2026-10-21T10:00:00.000Z'
    }
    useAppStore.setState({ projects: [meta] })
    const { editor } = mount()
    expect(editor.getByLabelText('Aspect')).toHaveValue('9:16')
  })

  it('submits a draft and shows warnings', async () => {
    const warning = 'Mentioned but not attached: Jin. Attach them to characters or list them in offPanelMentions.'
    const { editor, calls, onClose } = mount({ 'panels:create': () => ({ panel: created, warnings: [warning] }) })
    await userEvent.type(editor.getByLabelText('Description'), 'Mina meets Jin.')
    await userEvent.type(editor.getByLabelText('Setting'), 'Rooftop')
    await userEvent.click(editor.getByRole('button', { name: 'Create & generate' }))

    expect(await screen.findByText(/Mentioned but not attached: Jin/)).toBeInTheDocument()
    // The panel exists now: the dialog stays open with Close, and nothing can create it a second time.
    expect(screen.getByTestId('panel-editor')).toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()
    expect(editor.queryByRole('button', { name: 'Create & generate' })).toBeNull()
    expect(editor.queryByRole('button', { name: 'Create without image' })).toBeNull()
    expect(editor.queryByRole('button', { name: /Upload image/ })).toBeNull()
    expect(sent(calls, 'panels:create')).toEqual([
      {
        projectId,
        generate: true,
        draft: { episodeId: EPISODE_ID, description: 'Mina meets Jin.', setting: 'Rooftop', shot: 'medium', aspect: '2:3', characters: [], dialogue: [] }
      }
    ])
    await userEvent.click(editor.getByRole('button', { name: 'Close' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('closes after a clean create, with the cast and the dialogue in the draft', async () => {
    const { editor, calls, onClose } = mount({}, { afterPanelId: 'pnl_00000000aa' })
    await userEvent.type(editor.getByLabelText('Description'), 'Mina stands on the rooftop.')
    await userEvent.click(editor.getByRole('button', { name: 'Add character' }))
    await userEvent.selectOptions(editor.getByLabelText('Variation'), 'Outfit: School')
    await userEvent.type(editor.getByLabelText('Action'), 'turning')
    await userEvent.type(editor.getByLabelText('Expression'), 'curious')
    await userEvent.selectOptions(editor.getByLabelText('Position'), 'left')
    await userEvent.click(editor.getByRole('button', { name: 'Add dialogue line' }))
    await userEvent.type(editor.getByLabelText('Text'), 'Who?')
    await userEvent.click(editor.getByRole('button', { name: 'Create & generate' }))

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
    const [req] = sent(calls, 'panels:create') as { draft: PanelDraft; generate: boolean }[]
    expect(req.generate).toBe(true)
    expect(req.draft).toEqual({
      episodeId: EPISODE_ID,
      afterPanelId: 'pnl_00000000aa',
      description: 'Mina stands on the rooftop.',
      setting: '',
      shot: 'medium',
      aspect: '2:3',
      characters: [{ characterId: mina.id, variationId: 'var_0000000002', action: 'turning', expression: 'curious', position: 'left' }],
      dialogue: [{ speakerId: mina.id, kind: 'speech', text: 'Who?' }]
    })
  })

  it('appends when no panel is named, instead of inserting at the start', async () => {
    const { editor, calls } = mount()
    await userEvent.click(editor.getByRole('button', { name: 'Create & generate' }))
    const [req] = sent(calls, 'panels:create') as { draft: PanelDraft }[]
    expect('afterPanelId' in req.draft).toBe(false)
  })

  it('creates without an image', async () => {
    const { editor, calls, onClose } = mount()
    await userEvent.type(editor.getByLabelText('Description'), 'A quiet street.')
    await userEvent.click(editor.getByRole('button', { name: 'Create without image' }))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(sent(calls, 'panels:create')).toMatchObject([{ generate: false, draft: { description: 'A quiet street.' } }])
    expect(sent(calls, 'panels:uploadImage')).toEqual([])
  })

  it('uploads an image by creating the panel without one first', async () => {
    const version = { id: 'ver_0000000005' }
    const { editor, calls, onClose } = mount({ 'panels:uploadImage': () => version })
    await userEvent.click(editor.getByRole('button', { name: 'Upload image…' }))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(sent(calls, 'panels:create')).toMatchObject([{ generate: false }])
    expect(sent(calls, 'panels:uploadImage')).toEqual([{ projectId, panelId: 'pnl_0000000009' }])
  })

  it('still closes when the file dialog is cancelled, because the panel exists', async () => {
    const { editor, onClose } = mount({ 'panels:uploadImage': () => null })
    await userEvent.click(editor.getByRole('button', { name: 'Upload image…' }))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
  })

  it('reports a failed upload next to the panel that was created', async () => {
    const { editor, calls, onClose } = mount({
      'panels:uploadImage': () => {
        throw new Error('Unsupported image type: use png, jpg or webp')
      }
    })
    await userEvent.click(editor.getByRole('button', { name: 'Upload image…' }))
    expect(await screen.findByText(/Unsupported image type/)).toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()
    expect(editor.getByRole('button', { name: 'Close' })).toBeInTheDocument()
    expect(editor.queryByRole('button', { name: 'Create & generate' })).toBeNull()
    expect(sent(calls, 'panels:create')).toHaveLength(1)
  })

  it('shows validation issues one per line and stays editable', async () => {
    let attempts = 0
    const { editor, onClose, calls } = mount({
      'panels:create': () => {
        attempts += 1
        if (attempts === 1) throw new Error('Mina is cast twice\nUnknown speaker: chr_ffffffffff')
        return { panel: created, warnings: [] }
      }
    })
    await userEvent.click(editor.getByRole('button', { name: 'Create & generate' }))
    const alert = await screen.findByRole('alert')
    expect(within(alert).getByText('Mina is cast twice')).toBeInTheDocument()
    expect(within(alert).getByText('Unknown speaker: chr_ffffffffff')).toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()
    // Nothing was created, so the same buttons try again.
    await userEvent.click(editor.getByRole('button', { name: 'Create & generate' }))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(screen.queryByRole('alert')).toBeNull()
    expect(sent(calls, 'panels:create')).toHaveLength(2)
  })

  it('disables every action while a create is in flight', async () => {
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    const { editor, calls } = mount({
      'panels:create': async () => {
        await gate
        return { panel: created, warnings: [] }
      }
    })
    await userEvent.click(editor.getByRole('button', { name: 'Create & generate' }))
    expect(editor.getByRole('button', { name: 'Create & generate' })).toBeDisabled()
    expect(editor.getByRole('button', { name: 'Create without image' })).toBeDisabled()
    await userEvent.click(editor.getByRole('button', { name: 'Create & generate' }))
    release()
    await waitFor(() => expect(screen.queryByTestId('panel-editor')).toBeNull())
    expect(sent(calls, 'panels:create')).toHaveLength(1)
  })

  describe('dialogue', () => {
    it('offers Narration and the active characters as speakers', async () => {
      const { editor } = mount()
      await userEvent.click(editor.getByRole('button', { name: 'Add dialogue line' }))
      expect(optionLabels(editor.getByLabelText('Speaker'))).toEqual(['Narration', 'Mina', 'Sora', 'Ghost'])
      expect(optionLabels(editor.getByLabelText('Kind'))).toEqual(['speech', 'thought', 'narration', 'sfx'])
    })

    it('stores narration as a null speaker and drops blank lines', async () => {
      const { editor, calls } = mount()
      await userEvent.click(editor.getByRole('button', { name: 'Add dialogue line' }))
      await userEvent.click(editor.getByRole('button', { name: 'Add dialogue line' }))
      await userEvent.selectOptions(editor.getAllByLabelText('Speaker')[0], 'Narration')
      await userEvent.selectOptions(editor.getAllByLabelText('Kind')[0], 'narration')
      await userEvent.type(editor.getAllByLabelText('Text')[0], 'Night fell.')
      await userEvent.click(editor.getByRole('button', { name: 'Create without image' }))
      await waitFor(() => expect(sent(calls, 'panels:create')).toHaveLength(1))
      const [req] = sent(calls, 'panels:create') as { draft: PanelDraft }[]
      expect(req.draft.dialogue).toEqual([{ speakerId: null, kind: 'narration', text: 'Night fell.' }])
    })

    it('removes a line', async () => {
      const { editor } = mount()
      await userEvent.click(editor.getByRole('button', { name: 'Add dialogue line' }))
      await userEvent.click(editor.getByRole('button', { name: 'Remove line' }))
      expect(editor.queryByLabelText('Text')).toBeNull()
    })
  })

  describe('edit mode', () => {
    const existing: Panel = panel({
      id: 'pnl_00000000ed',
      description: 'Jin waits by the door.',
      setting: 'Hallway',
      shot: 'wide',
      aspect: '3:4',
      characters: [
        { characterId: mina.id, variationId: 'var_0000000002', action: 'turning', expression: 'curious', position: 'right' },
        { characterId: jin.id, variationId: 'var_00000000j1', action: '', expression: '', position: 'left' }
      ],
      dialogue: [{ id: 'dlg_0000000001', speakerId: mina.id, kind: 'speech', text: 'Hello.' }]
    })

    it('starts from the panel and offers Save instead of the create buttons', () => {
      const { editor } = mount({}, { mode: 'edit', panel: existing })
      expect(editor.getByLabelText('Description')).toHaveValue('Jin waits by the door.')
      expect(editor.getByLabelText('Setting')).toHaveValue('Hallway')
      expect(editor.getByLabelText('Shot')).toHaveValue('wide')
      expect(editor.getByLabelText('Aspect')).toHaveValue('3:4')
      expect(editor.getAllByLabelText('Character').map((s) => (s as HTMLSelectElement).value)).toEqual([mina.id, jin.id])
      expect(editor.getByLabelText('Text')).toHaveValue('Hello.')
      expect(editor.queryByRole('button', { name: 'Create & generate' })).toBeNull()
      expect(editor.getByRole('button', { name: 'Save' })).toBeDisabled()
    })

    it('keeps a since-archived cast member selectable on its own row only', () => {
      const { editor } = mount({}, { mode: 'edit', panel: existing })
      const [minaRow, jinRow] = editor.getAllByLabelText('Character')
      expect(optionLabels(jinRow)).toContain('Jin (archived)')
      expect(jinRow).toHaveValue(jin.id)
      // The archived character is not offered to any other row.
      expect(optionLabels(minaRow)).not.toContain('Jin (archived)')
      expect(optionLabels(minaRow)).not.toContain('Jin')
    })

    it('keeps a cast look that is no longer ready on its own row', () => {
      const stale = panel({ ...existing, characters: [{ characterId: mina.id, variationId: 'var_0000000003', action: '', expression: '', position: 'center' }] })
      const { editor } = mount({}, { mode: 'edit', panel: stale })
      expect(editor.getByLabelText('Variation')).toHaveValue('var_0000000003')
      expect(optionLabels(editor.getByLabelText('Variation'))).toEqual(['Base', 'Outfit: School', 'Smile (not ready)'])
    })

    it('sends only the fields that changed', async () => {
      const { editor, calls, onClose } = mount({}, { mode: 'edit', panel: existing })
      await userEvent.clear(editor.getByLabelText('Description'))
      await userEvent.type(editor.getByLabelText('Description'), 'Jin leaves.')
      await userEvent.click(editor.getByRole('button', { name: 'Save' }))
      await waitFor(() => expect(onClose).toHaveBeenCalled())
      expect(sent(calls, 'panels:update')).toEqual([{ projectId, panelId: 'pnl_00000000ed', patch: { description: 'Jin leaves.' } }])
      expect(sent(calls, 'panels:create')).toEqual([])
      expect(sent(calls, 'panels:generate')).toEqual([])
    })

    it('sends the whole cast and dialogue when either changed, archived member included', async () => {
      const { editor, calls, onClose } = mount({}, { mode: 'edit', panel: existing })
      await userEvent.clear(editor.getByLabelText('Text'))
      await userEvent.type(editor.getByLabelText('Text'), 'Goodbye.')
      await userEvent.selectOptions(editor.getAllByLabelText('Position')[0], 'center')
      await userEvent.click(editor.getByRole('button', { name: 'Save' }))
      await waitFor(() => expect(onClose).toHaveBeenCalled())
      const [req] = sent(calls, 'panels:update') as { patch: PanelPatch }[]
      expect(req.patch).toEqual({
        characters: [
          { characterId: mina.id, variationId: 'var_0000000002', action: 'turning', expression: 'curious', position: 'center' },
          { characterId: jin.id, variationId: 'var_00000000j1', action: '', expression: '', position: 'left' }
        ],
        dialogue: [{ speakerId: mina.id, kind: 'speech', text: 'Goodbye.' }]
      })
    })

    it('does not send a field that was changed and changed back', async () => {
      const { editor } = mount({}, { mode: 'edit', panel: existing })
      await userEvent.type(editor.getByLabelText('Setting'), 'x')
      expect(editor.getByRole('button', { name: 'Save' })).toBeEnabled()
      await userEvent.type(editor.getByLabelText('Setting'), '{Backspace}')
      expect(editor.getByRole('button', { name: 'Save' })).toBeDisabled()
    })

    it('shows warnings from the save and waits for Close', async () => {
      const warning = 'Mentioned but not attached: Sora. Attach them to characters or list them in offPanelMentions.'
      const { editor, onClose } = mount({ 'panels:update': () => ({ panel: existing, warnings: [warning] }) }, { mode: 'edit', panel: existing })
      await userEvent.type(editor.getByLabelText('Description'), ' Sora watches.')
      await userEvent.click(editor.getByRole('button', { name: 'Save' }))
      expect(await screen.findByText(/Mentioned but not attached: Sora/)).toBeInTheDocument()
      expect(onClose).not.toHaveBeenCalled()
      expect(editor.queryByRole('button', { name: 'Save' })).toBeNull()
      await userEvent.click(editor.getByRole('button', { name: 'Close' }))
      expect(onClose).toHaveBeenCalled()
    })

    it('shows a rejected save inline and keeps the edits', async () => {
      const { editor, onClose } = mount(
        {
          'panels:update': () => {
            throw new Error('Character Jin is archived')
          }
        },
        { mode: 'edit', panel: existing }
      )
      await userEvent.type(editor.getByLabelText('Setting'), ' roof')
      await userEvent.click(editor.getByRole('button', { name: 'Save' }))
      expect(await screen.findByRole('alert')).toHaveTextContent('Character Jin is archived')
      expect(editor.getByLabelText('Setting')).toHaveValue('Hallway roof')
      expect(onClose).not.toHaveBeenCalled()
    })

    it('saves then regenerates', async () => {
      const { editor, calls, onClose } = mount({ 'panels:generate': () => undefined }, { mode: 'edit', panel: existing })
      await userEvent.type(editor.getByLabelText('Setting'), ' roof')
      await userEvent.click(editor.getByRole('button', { name: 'Save & regenerate' }))
      await waitFor(() => expect(onClose).toHaveBeenCalled())
      expect(calls.filter((c) => c.channel === 'panels:update' || c.channel === 'panels:generate').map((c) => c.channel)).toEqual(['panels:update', 'panels:generate'])
      expect(sent(calls, 'panels:generate')).toEqual([{ projectId, panelId: 'pnl_00000000ed' }])
    })

    it('regenerates without a save when nothing changed', async () => {
      const { editor, calls, onClose } = mount({ 'panels:generate': () => undefined }, { mode: 'edit', panel: existing })
      await userEvent.click(editor.getByRole('button', { name: 'Save & regenerate' }))
      await waitFor(() => expect(onClose).toHaveBeenCalled())
      expect(sent(calls, 'panels:update')).toEqual([])
      expect(sent(calls, 'panels:generate')).toHaveLength(1)
    })

    it('uploads an image for the panel it edits', async () => {
      const { editor, calls, onClose } = mount({ 'panels:uploadImage': () => null }, { mode: 'edit', panel: existing })
      await userEvent.click(editor.getByRole('button', { name: 'Upload image…' }))
      await waitFor(() => expect(onClose).toHaveBeenCalled())
      expect(sent(calls, 'panels:uploadImage')).toEqual([{ projectId, panelId: 'pnl_00000000ed' }])
      expect(sent(calls, 'panels:create')).toEqual([])
    })
  })
})
