import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { assetUrl } from '@shared/asset-url'
import type { Character } from '@shared/types'
import { startEventSync } from '../../events'
import { initialAppState, useAppStore } from '../../stores/app-store'
import { initialCharactersState, useCharactersStore } from '../../stores/characters-store'
import { useChatStore } from '../../stores/chat-store'
import { PROJECT_ID as projectId, character, variation, withVariation } from '../../test/character-fixtures'
import { installFakeApi } from '../../test/fake-api'
import { CharacterStudio } from './CharacterStudio'

const mina = character()
let stopSync: (() => void) | undefined

beforeEach(() => {
  useAppStore.setState({ ...initialAppState, projectId, sessionId: 'ses_0000000001' })
  useCharactersStore.setState({ ...initialCharactersState })
  useChatStore.setState({ draft: '' })
})
afterEach(() => stopSync?.())

function mount(handlers: Parameters<typeof installFakeApi>[0]) {
  const api = installFakeApi({ 'characters:list': () => [mina], ...handlers })
  stopSync = startEventSync()
  render(<CharacterStudio />)
  return api
}

const variationForm = (): ReturnType<typeof within> => within(screen.getByTestId('variation-form'))
const characterForm = (): ReturnType<typeof within> => within(screen.getByTestId('character-form'))

describe('CharacterStudio', () => {
  it('shows AI-created variations live', async () => {
    let current: Character[] = [mina]
    const api = installFakeApi({ 'characters:list': () => current })
    stopSync = startEventSync()
    render(<CharacterStudio />)
    await screen.findByText('Mina')
    current = [withVariation(mina, 'Outfit: School uniform')]
    api.emit({ type: 'character.changed', projectId, characterId: mina.id })
    await userEvent.click(screen.getByText('Mina'))
    expect(await screen.findAllByTestId('variation-card')).toHaveLength(2)
  })

  it('lists characters as cards with the base image, name and role, and loads archived ones too', async () => {
    const pending = character({ id: 'chr_0000000002', name: 'Jun', role: 'supporting', variations: [variation({ id: 'var_0000000002', characterId: 'chr_0000000002', status: 'pending', imagePath: null })] })
    const archived = character({ id: 'chr_0000000003', name: 'Old Mina', archived: true })
    const { calls } = mount({ 'characters:list': () => [mina, pending, archived] })
    const cards = await screen.findAllByTestId('character-card')
    expect(cards).toHaveLength(2)
    expect(calls[0]).toEqual({ channel: 'characters:list', req: { projectId, includeArchived: true } })
    expect(within(cards[0]).getByText('Mina')).toBeInTheDocument()
    expect(within(cards[0]).getByText('protagonist')).toBeInTheDocument()
    expect(within(cards[0]).getByRole('img')).toHaveAttribute('src', assetUrl(projectId, mina.variations[0].imagePath!))
    expect(within(cards[1]).getByText('supporting')).toBeInTheDocument()
    expect(within(cards[1]).queryByRole('img')).toBeNull()
    expect(within(cards[1]).getByText(/generating/i)).toBeInTheDocument()

    await userEvent.click(screen.getByLabelText('Show archived'))
    expect(screen.getAllByTestId('character-card')).toHaveLength(3)
    expect(screen.getByText('Archived')).toBeInTheDocument()
  })

  it('offers no Upload on a variation while its image is generating', async () => {
    const generating = variation({ id: 'var_0000000002', name: 'Outfit: Coat', kind: 'outfit', status: 'pending', imagePath: null })
    mount({ 'characters:list': () => [{ ...mina, variations: [...mina.variations, generating] }] })
    await userEvent.click(await screen.findByText('Mina'))
    const [ready, pending] = await screen.findAllByTestId('variation-card')
    expect(within(ready).getByRole('button', { name: 'Upload' })).toBeEnabled()
    expect(within(pending).getByRole('button', { name: 'Upload' })).toBeDisabled()
  })

  it('asks for a project first', () => {
    useAppStore.setState({ projectId: null })
    installFakeApi({})
    render(<CharacterStudio />)
    expect(screen.getByText(/create a project/i)).toBeInTheDocument()
  })

  it('shows a load failure', async () => {
    mount({
      'characters:list': () => {
        throw new Error('disk on fire')
      }
    })
    expect(await screen.findByRole('alert')).toHaveTextContent('disk on fire')
  })

  describe('Draft with AI', () => {
    const PINNED = (name: string) =>
      `Help me design the character "${name}": interview me briefly if needed, then fill characterization, appearance and appearanceLock, create the character and generate its base reference image.`

    it('prefills the composer for a new character from the list view', async () => {
      mount({})
      await screen.findByText('Mina')
      await userEvent.click(screen.getByRole('button', { name: 'Draft with AI' }))
      expect(useChatStore.getState().draft).toBe(PINNED('a new character'))
    })

    it('uses the name from the character form', async () => {
      mount({})
      await userEvent.click(await screen.findByText('Mina'))
      await userEvent.click(screen.getByRole('button', { name: 'Draft with AI' }))
      expect(useChatStore.getState().draft).toBe(PINNED('Mina'))

      await userEvent.clear(characterForm().getByLabelText('Name'))
      await userEvent.type(characterForm().getByLabelText('Name'), 'Mina Park')
      await userEvent.click(screen.getByRole('button', { name: 'Draft with AI' }))
      expect(useChatStore.getState().draft).toBe(PINNED('Mina Park'))
    })

    it('falls back to "a new character" for a blank name on the new-character form', async () => {
      mount({})
      await screen.findByText('Mina')
      await userEvent.click(screen.getByRole('button', { name: 'New character' }))
      await userEvent.click(screen.getByRole('button', { name: 'Draft with AI' }))
      expect(useChatStore.getState().draft).toBe(PINNED('a new character'))
    })

    it('says when there is no session to send it in', async () => {
      useAppStore.setState({ sessionId: null })
      mount({})
      await screen.findByText('Mina')
      expect(screen.getByText(/select or create a session/i)).toBeInTheDocument()
    })
  })

  describe('character form', () => {
    it('creates a character with the base image requested, then opens it', async () => {
      const created = character({ id: 'chr_0000000009', name: 'Jun', role: 'antagonist', variations: [variation({ id: 'var_0000000009', characterId: 'chr_0000000009', status: 'pending', imagePath: null })] })
      let list: Character[] = [mina]
      const { calls } = mount({ 'characters:list': () => list, 'characters:create': () => ((list = [mina, created]), created) })
      await screen.findByText('Mina')
      await userEvent.click(screen.getByRole('button', { name: 'New character' }))
      const form = characterForm()
      expect(form.getByRole('button', { name: 'Create character' })).toBeDisabled()
      await userEvent.type(form.getByLabelText('Name'), 'Jun')
      await userEvent.selectOptions(form.getByLabelText('Role'), 'antagonist')
      await userEvent.type(form.getByLabelText('Aliases'), 'J, The Rival ,')
      await userEvent.type(form.getByLabelText('Hair'), 'jet black')
      await userEvent.type(form.getByLabelText('Personality'), 'cold')
      await userEvent.type(form.getByLabelText('Appearance lock'), 'Tall young man, jet black hair')
      await userEvent.click(form.getByRole('button', { name: 'Create character' }))

      const create = calls.find((c) => c.channel === 'characters:create')
      expect(create?.req).toMatchObject({
        projectId,
        generateBase: true,
        input: {
          name: 'Jun',
          role: 'antagonist',
          aliases: ['J', 'The Rival'],
          appearance: { hair: 'jet black', eyes: '' },
          characterization: { personality: 'cold', relationships: [] },
          appearanceLock: 'Tall young man, jet black hair'
        }
      })
      // The new character opens in the detail view with its base pending.
      expect(await screen.findByRole('heading', { name: 'Jun' })).toBeInTheDocument()
      expect(screen.getAllByTestId('variation-card')).toHaveLength(1)
    })

    it('shows a create failure and stays on the form', async () => {
      mount({
        'characters:create': () => {
          throw new Error('A character named "Jun" already exists')
        }
      })
      await screen.findByText('Mina')
      await userEvent.click(screen.getByRole('button', { name: 'New character' }))
      await userEvent.type(characterForm().getByLabelText('Name'), 'Jun')
      await userEvent.type(characterForm().getByLabelText('Appearance lock'), 'x')
      await userEvent.click(characterForm().getByRole('button', { name: 'Create character' }))
      expect(await screen.findByRole('alert')).toHaveTextContent('A character named "Jun" already exists')
      expect(characterForm().getByLabelText('Name')).toHaveValue('Jun')
    })

    it('counts the words of the appearance lock against the 40-90 hint', async () => {
      mount({})
      await userEvent.click(await screen.findByText('Mina'))
      const hint = screen.getByTestId('lock-word-count')
      expect(hint).toHaveTextContent('7 words')
      expect(hint).toHaveTextContent('40-90')
      expect(hint).toHaveAttribute('data-in-range', 'false')
      await userEvent.clear(characterForm().getByLabelText('Appearance lock'))
      await userEvent.type(characterForm().getByLabelText('Appearance lock'), Array.from({ length: 41 }, (_, i) => `w${i}`).join(' '))
      expect(hint).toHaveTextContent('41 words')
      expect(hint).toHaveAttribute('data-in-range', 'true')
    })

    it('saves only the fields the user changed', async () => {
      const { calls } = mount({ 'characters:update': () => mina })
      await userEvent.click(await screen.findByText('Mina'))
      const form = characterForm()
      const save = form.getByRole('button', { name: 'Save' })
      expect(save).toBeDisabled()
      await userEvent.type(form.getByLabelText('Hair'), 'red')
      await userEvent.type(form.getByLabelText('Motivation'), 'to win')
      await userEvent.type(form.getByLabelText('Aliases'), 'Min')
      expect(save).toBeEnabled()
      await userEvent.click(save)
      expect(calls.find((c) => c.channel === 'characters:update')?.req).toEqual({
        projectId,
        characterId: mina.id,
        patch: { aliases: ['Min'], characterization: { motivation: 'to win' }, appearance: { hair: 'red' } }
      })
    })

    it('keeps unsaved edits when the AI changes another field, and adopts AI changes to untouched fields', async () => {
      let current: Character[] = [mina]
      const api = installFakeApi({ 'characters:list': () => current, 'characters:update': () => mina })
      stopSync = startEventSync()
      render(<CharacterStudio />)
      await userEvent.click(await screen.findByText('Mina'))
      await userEvent.type(characterForm().getByLabelText('Name'), ' Park')

      current = [character({ appearanceLock: 'NEW LOCK', appearance: { ...mina.appearance, eyes: 'violet' }, updatedAt: '2026-10-21T11:00:00.000Z' })]
      api.emit({ type: 'character.changed', projectId, characterId: mina.id })
      await waitFor(() => expect(characterForm().getByLabelText('Appearance lock')).toHaveValue('NEW LOCK'))
      expect(characterForm().getByLabelText('Eyes')).toHaveValue('violet')
      expect(characterForm().getByLabelText('Name')).toHaveValue('Mina Park')

      await userEvent.click(characterForm().getByRole('button', { name: 'Save' }))
      expect(api.calls.find((c) => c.channel === 'characters:update')?.req).toMatchObject({ patch: { name: 'Mina Park' } })
    })

    it('edits relationships to other characters', async () => {
      const jun = character({ id: 'chr_0000000002', name: 'Jun' })
      const { calls } = mount({ 'characters:list': () => [mina, jun], 'characters:update': () => mina })
      await userEvent.click((await screen.findAllByTestId('character-card'))[0])
      const form = characterForm()
      await userEvent.click(form.getByRole('button', { name: 'Add relationship' }))
      await userEvent.selectOptions(form.getByLabelText('Relationship with'), 'chr_0000000002')
      await userEvent.type(form.getByLabelText('Relation'), 'older brother')
      await userEvent.click(form.getByRole('button', { name: 'Save' }))
      expect(calls.find((c) => c.channel === 'characters:update')?.req).toMatchObject({
        patch: { characterization: { relationships: [{ characterId: 'chr_0000000002', relation: 'older brother' }] } }
      })
    })

    it('archives and unarchives', async () => {
      let list: Character[] = [mina]
      const { calls } = mount({
        'characters:list': () => list,
        'characters:archive': () => ((list = [{ ...mina, archived: true }]), undefined),
        'characters:unarchive': () => ((list = [mina]), undefined)
      })
      await userEvent.click(await screen.findByText('Mina'))
      await userEvent.click(screen.getByRole('button', { name: 'Archive' }))
      expect(calls.find((c) => c.channel === 'characters:archive')?.req).toEqual({ projectId, characterId: mina.id })
      await userEvent.click(await screen.findByRole('button', { name: 'Unarchive' }))
      expect(calls.find((c) => c.channel === 'characters:unarchive')?.req).toEqual({ projectId, characterId: mina.id })
      expect(await screen.findByRole('button', { name: 'Archive' })).toBeInTheDocument()
    })

    it('deletes after a confirmation and shows the refusal for a character in use', async () => {
      const { calls } = mount({
        'characters:delete': () => {
          throw new Error('This character is used by 1 panel(s): pnl_0000000001. Archive it instead.')
        }
      })
      await userEvent.click(await screen.findByText('Mina'))
      await userEvent.click(screen.getByRole('button', { name: 'Delete character' }))
      expect(calls.some((c) => c.channel === 'characters:delete')).toBe(false)
      await userEvent.click(screen.getByRole('button', { name: 'Confirm delete' }))
      expect(await screen.findByRole('alert')).toHaveTextContent('Archive it instead.')
      expect(calls.find((c) => c.channel === 'characters:delete')?.req).toEqual({ projectId, characterId: mina.id })
    })

    it('goes back to the list', async () => {
      mount({})
      await userEvent.click(await screen.findByText('Mina'))
      await userEvent.click(screen.getByRole('button', { name: 'Back to characters' }))
      expect(screen.getByTestId('character-card')).toBeInTheDocument()
    })
  })

  describe('variations', () => {
    async function openMina(chars: Character[], handlers: Parameters<typeof installFakeApi>[0] = {}) {
      const api = mount({ 'characters:list': () => chars, ...handlers })
      await userEvent.click(await screen.findByText('Mina'))
      return api
    }

    it('adds a variation through the form and requests its image', async () => {
      const { calls } = await openMina([mina], { 'characters:addVariation': () => variation({ id: 'var_0000000002', status: 'pending', imagePath: null }) })
      expect(screen.queryByTestId('variation-form')).toBeNull()
      await userEvent.click(screen.getByRole('button', { name: 'Add variation' }))
      const form = variationForm()
      expect(form.getByLabelText('Kind')).toHaveValue('outfit')
      expect(within(form.getByLabelText('Kind')).getAllByRole('option').map((o) => o.getAttribute('value'))).toEqual(['outfit', 'expression', 'pose', 'age', 'form', 'other'])
      expect(form.getByRole('button', { name: 'Create variation' })).toBeDisabled()
      await userEvent.type(form.getByLabelText('Name'), 'Outfit: School uniform')
      await userEvent.type(form.getByLabelText('Delta'), 'navy blazer, pleated skirt')
      await userEvent.click(form.getByRole('button', { name: 'Create variation' }))
      expect(calls.find((c) => c.channel === 'characters:addVariation')?.req).toEqual({
        projectId,
        characterId: mina.id,
        input: { name: 'Outfit: School uniform', kind: 'outfit', delta: 'navy blazer, pleated skirt' },
        generate: true
      })
      await waitFor(() => expect(screen.queryByTestId('variation-form')).toBeNull())
    })

    it('keeps the form open and shows the error when adding fails', async () => {
      await openMina([mina], {
        'characters:addVariation': () => {
          throw new Error('nope')
        }
      })
      await userEvent.click(screen.getByRole('button', { name: 'Add variation' }))
      await userEvent.type(variationForm().getByLabelText('Name'), 'X')
      await userEvent.click(variationForm().getByRole('button', { name: 'Create variation' }))
      expect(await screen.findByRole('alert')).toHaveTextContent('nope')
      expect(screen.getByTestId('variation-form')).toBeInTheDocument()
    })

    it('shows an image or a status badge on each card, and the right actions', async () => {
      let c = withVariation(mina, 'Outfit: Ready')
      c = withVariation(c, 'Pose: Pending', { status: 'pending', imagePath: null, kind: 'pose' })
      c = withVariation(c, 'Expression: Failed', { status: 'failed', imagePath: null, error: 'quota exceeded', kind: 'expression' })
      await openMina([c])
      const cards = screen.getAllByTestId('variation-card')
      expect(cards).toHaveLength(4)
      const [base, ready, pending, failed] = cards.map((el) => within(el))

      expect(base.getByRole('img')).toHaveAttribute('src', assetUrl(projectId, mina.variations[0].imagePath!))
      expect(base.getByText('Base')).toBeInTheDocument()
      expect(base.queryByRole('button', { name: 'Delete' })).toBeNull()
      expect(base.getByRole('button', { name: 'Upload' })).toBeInTheDocument()
      expect(base.getByRole('button', { name: 'Regenerate' })).toBeInTheDocument()

      expect(ready.getByRole('img')).toBeInTheDocument()
      expect(ready.getByRole('button', { name: 'Delete' })).toBeInTheDocument()
      expect(ready.queryByRole('button', { name: 'Retry' })).toBeNull()

      expect(pending.queryByRole('img')).toBeNull()
      expect(pending.getByText(/generating/i)).toBeInTheDocument()
      expect(pending.queryByRole('button', { name: 'Retry' })).toBeNull()
      expect(pending.queryByRole('button', { name: 'Regenerate' })).toBeNull()

      expect(failed.queryByRole('img')).toBeNull()
      expect(failed.getByText('Failed')).toBeInTheDocument()
      expect(failed.getByText('quota exceeded')).toBeInTheDocument()
      expect(failed.getByRole('button', { name: 'Retry' })).toBeInTheDocument()
    })

    it('keeps showing the previous image on a variation whose regeneration failed', async () => {
      const c = character({ variations: [variation({ status: 'failed', error: 'timeout' })] })
      await openMina([c])
      const card = within(screen.getByTestId('variation-card'))
      expect(card.getByRole('img')).toBeInTheDocument()
      expect(card.getByText('timeout')).toBeInTheDocument()
      expect(card.getByRole('button', { name: 'Retry' })).toBeInTheDocument()
    })

    it('retries a failed variation', async () => {
      const c = character({ variations: [variation({ status: 'failed', imagePath: null, error: 'boom' })] })
      const { calls } = await openMina([c], { 'characters:generateVariation': () => variation({ status: 'pending' }) })
      await userEvent.click(screen.getByRole('button', { name: 'Retry' }))
      expect(calls.find((c) => c.channel === 'characters:generateVariation')?.req).toEqual({ projectId, characterId: mina.id, variationId: 'var_0000000001' })
    })

    it('uploads an image, and does nothing visible when the dialog is cancelled', async () => {
      let result: unknown = null
      const { calls } = await openMina([mina], { 'characters:uploadVariationImage': () => result })
      await userEvent.click(screen.getByRole('button', { name: 'Upload' }))
      await waitFor(() => expect(calls.filter((c) => c.channel === 'characters:uploadVariationImage')).toHaveLength(1))
      expect(calls.find((c) => c.channel === 'characters:uploadVariationImage')?.req).toEqual({ projectId, characterId: mina.id, variationId: 'var_0000000001' })
      expect(screen.queryByRole('alert')).toBeNull()

      result = variation()
      await userEvent.click(screen.getByRole('button', { name: 'Upload' }))
      await waitFor(() => expect(calls.filter((c) => c.channel === 'characters:uploadVariationImage')).toHaveLength(2))
    })

    it('shows an upload failure', async () => {
      await openMina([mina], {
        'characters:uploadVariationImage': () => {
          throw new Error('Unsupported image type: use png, jpg or webp')
        }
      })
      await userEvent.click(screen.getByRole('button', { name: 'Upload' }))
      expect(await screen.findByRole('alert')).toHaveTextContent('png, jpg or webp')
    })

    it('deletes a non-base variation after confirmation', async () => {
      const c = withVariation(mina, 'Outfit: Old')
      const { calls } = await openMina([c], { 'characters:deleteVariation': () => undefined })
      const card = within(screen.getAllByTestId('variation-card')[1])
      await userEvent.click(card.getByRole('button', { name: 'Delete' }))
      expect(calls.some((x) => x.channel === 'characters:deleteVariation')).toBe(false)
      await userEvent.click(card.getByRole('button', { name: 'Confirm delete' }))
      expect(calls.find((x) => x.channel === 'characters:deleteVariation')?.req).toEqual({ projectId, characterId: mina.id, variationId: c.variations[1].id })
    })

    it('updates the grid when the base image finishes generating', async () => {
      let c = character({ variations: [variation({ status: 'pending', imagePath: null })] })
      const api = installFakeApi({ 'characters:list': () => [c] })
      stopSync = startEventSync()
      render(<CharacterStudio />)
      await userEvent.click(await screen.findByText('Mina'))
      expect(screen.queryByRole('img')).toBeNull()
      c = character()
      act(() => api.emit({ type: 'character.changed', projectId, characterId: c.id }))
      await waitFor(() => expect(within(screen.getByTestId('variation-card')).getByRole('img')).toBeInTheDocument())
    })
  })
})
