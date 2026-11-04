import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { assetUrl } from '@shared/asset-url'
import type { Item, ItemUsage } from '@shared/types'
import { startEventSync } from '../../events'
import { initialAppState, useAppStore } from '../../stores/app-store'
import { initialCharactersState, useCharactersStore } from '../../stores/characters-store'
import { initialItemsState, useItemsStore } from '../../stores/items-store'
import { character } from '../../test/character-fixtures'
import { installFakeApi } from '../../test/fake-api'
import { PROJECT_ID as projectId, item, usage, withUsage } from '../../test/item-fixtures'
import { ItemStudio } from './ItemStudio'

const pistol = item()
const mina = character()
let stopSync: (() => void) | undefined

beforeEach(() => {
  useAppStore.setState({ ...initialAppState, projectId, sessionId: 'ses_0000000001' })
  useItemsStore.setState({ ...initialItemsState })
  useCharactersStore.setState({ ...initialCharactersState })
})
afterEach(() => stopSync?.())

function mount(handlers: Parameters<typeof installFakeApi>[0]) {
  const api = installFakeApi({ 'items:list': () => [pistol], 'characters:list': () => [mina], 'projects:open': () => ({ meta: {}, problems: [] }), ...handlers })
  stopSync = startEventSync()
  render(<ItemStudio />)
  return api
}

const itemForm = (): ReturnType<typeof within> => within(screen.getByTestId('item-form'))
const usageForm = (): ReturnType<typeof within> => within(screen.getByTestId('usage-form'))

async function openPistol(items: Item[], handlers: Parameters<typeof installFakeApi>[0] = {}) {
  const api = mount({ 'items:list': () => items, ...handlers })
  await userEvent.click(await screen.findByText('Ray Pistol'))
  return api
}

describe('ItemStudio', () => {
  it('lists active items as cards and hides archived ones until "Show archived"', async () => {
    const pending = item({ id: 'itm_0000000002', name: 'Scroll', ownerId: mina.id, usages: [usage({ id: 'use_0000000002', itemId: 'itm_0000000002', status: 'pending', imagePath: null })] })
    const archived = item({ id: 'itm_0000000003', name: 'Old Pistol', archived: true })
    const { calls } = mount({ 'items:list': () => [pistol, pending, archived] })
    const cards = await screen.findAllByTestId('item-card')
    expect(cards).toHaveLength(2)
    expect(calls.find((c) => c.channel === 'items:list')).toEqual({ channel: 'items:list', req: { projectId, includeArchived: true } })
    expect(within(cards[0]).getByText('Ray Pistol')).toBeInTheDocument()
    expect(within(cards[0]).getByText('No owner')).toBeInTheDocument()
    expect(within(cards[0]).getByRole('img')).toHaveAttribute('src', assetUrl(projectId, pistol.usages[0].imagePath!))
    expect(within(cards[1]).getByText('Mina')).toBeInTheDocument()
    expect(within(cards[1]).queryByRole('img')).toBeNull()
    expect(within(cards[1]).getByText(/generating/i)).toBeInTheDocument()

    await userEvent.click(screen.getByLabelText('Show archived'))
    expect(screen.getAllByTestId('item-card')).toHaveLength(3)
    expect(screen.getByText('Archived')).toBeInTheDocument()
  })

  it('shows the empty state', async () => {
    mount({ 'items:list': () => [] })
    expect(await screen.findByText('No items yet. Create one, or ask the agent to.')).toBeInTheDocument()
  })

  it('asks for a project first', () => {
    useAppStore.setState({ projectId: null })
    installFakeApi({})
    render(<ItemStudio />)
    expect(screen.getByText(/create a project/i)).toBeInTheDocument()
  })

  it('shows a load failure', async () => {
    mount({
      'items:list': () => {
        throw new Error('disk on fire')
      }
    })
    expect(await screen.findByRole('alert')).toHaveTextContent('disk on fire')
  })

  it('reloads the list on an item.changed event, and shows AI-created usages live', async () => {
    let current: Item[] = [pistol]
    const api = installFakeApi({ 'items:list': () => current, 'characters:list': () => [mina], 'projects:open': () => ({ meta: {}, problems: [] }) })
    stopSync = startEventSync()
    render(<ItemStudio />)
    await screen.findByText('Ray Pistol')
    current = [withUsage(pistol, 'Firing')]
    api.emit({ type: 'item.changed', projectId, itemId: pistol.id })
    await userEvent.click(screen.getByText('Ray Pistol'))
    expect(await screen.findAllByTestId('usage-card')).toHaveLength(2)

    current = [item({ id: 'itm_0000000002', name: 'Scroll' })]
    api.emit({ type: 'item.changed', projectId, itemId: 'itm_0000000002' })
    await waitFor(() => expect(useItemsStore.getState().items.map((i) => i.name)).toEqual(['Scroll']))
  })

  describe('item form', () => {
    it('creates an item with the base image requested, then opens it', async () => {
      const created = item({ id: 'itm_0000000009', name: 'Scroll', ownerId: mina.id, usages: [usage({ id: 'use_0000000009', itemId: 'itm_0000000009', status: 'pending', imagePath: null })] })
      let list: Item[] = [pistol]
      const { calls } = mount({ 'items:list': () => list, 'items:create': () => ((list = [pistol, created]), created) })
      await screen.findByText('Ray Pistol')
      await userEvent.click(screen.getByRole('button', { name: 'New item' }))
      const form = itemForm()
      expect(screen.getByTestId('item-form-save')).toBeDisabled()
      await userEvent.type(screen.getByTestId('item-form-name'), 'Scroll')
      await userEvent.type(form.getByLabelText('Aliases'), 'Map, The Scroll ,')
      await userEvent.selectOptions(form.getByLabelText('Owner'), mina.id)
      await userEvent.type(form.getByLabelText('Notes'), 'found in the cellar')
      await userEvent.type(screen.getByTestId('item-form-lock'), 'Aged scroll with a red wax seal')
      await userEvent.click(screen.getByTestId('item-form-save'))

      expect(calls.find((c) => c.channel === 'items:create')?.req).toEqual({
        projectId,
        generateBase: true,
        input: { name: 'Scroll', aliases: ['Map', 'The Scroll'], ownerId: mina.id, notes: 'found in the cellar', appearanceLock: 'Aged scroll with a red wax seal' }
      })
      // The new item opens in the detail view with its base pending.
      expect(await screen.findByRole('heading', { name: 'Scroll' })).toBeInTheDocument()
      expect(screen.getAllByTestId('usage-card')).toHaveLength(1)
    })

    it('offers only active characters as owner, plus Nobody, and sends null for Nobody', async () => {
      const retired = character({ id: 'chr_0000000002', name: 'Retired', archived: true })
      const { calls } = mount({ 'characters:list': () => [mina, retired] })
      await screen.findByText('Ray Pistol')
      await userEvent.click(screen.getByRole('button', { name: 'New item' }))
      const owner = itemForm().getByLabelText('Owner')
      await waitFor(() => expect(within(owner).getAllByRole('option').map((o) => o.textContent)).toEqual(['Nobody', 'Mina']))
      expect(owner).toHaveValue('')
      await userEvent.type(screen.getByTestId('item-form-name'), 'Scroll')
      await userEvent.type(screen.getByTestId('item-form-lock'), 'x')
      await userEvent.click(screen.getByTestId('item-form-save'))
      await waitFor(() => expect(calls.some((c) => c.channel === 'items:create')).toBe(true))
      expect(calls.find((c) => c.channel === 'items:create')?.req).toMatchObject({ input: { ownerId: null } })
    })

    it('shows a create failure and stays on the form', async () => {
      mount({
        'items:create': () => {
          throw new Error('An item named "Scroll" already exists')
        }
      })
      await screen.findByText('Ray Pistol')
      await userEvent.click(screen.getByRole('button', { name: 'New item' }))
      await userEvent.type(screen.getByTestId('item-form-name'), 'Scroll')
      await userEvent.type(screen.getByTestId('item-form-lock'), 'x')
      await userEvent.click(screen.getByTestId('item-form-save'))
      expect(await screen.findByRole('alert')).toHaveTextContent('An item named "Scroll" already exists')
      expect(screen.getByTestId('item-form-name')).toHaveValue('Scroll')
    })

    it('counts the words of the appearance lock against the 25–70 hint', async () => {
      await openPistol([pistol])
      const hint = screen.getByTestId('lock-word-count')
      expect(hint).toHaveTextContent('7 words')
      expect(hint).toHaveTextContent('25–70 words')
      expect(hint).toHaveAttribute('data-in-range', 'false')
      await userEvent.clear(screen.getByTestId('item-form-lock'))
      await userEvent.type(screen.getByTestId('item-form-lock'), Array.from({ length: 26 }, (_, i) => `w${i}`).join(' '))
      expect(hint).toHaveTextContent('26 words')
      expect(hint).toHaveAttribute('data-in-range', 'true')
    })

    it('saves only the fields the user changed', async () => {
      const { calls } = await openPistol([pistol], { 'items:update': () => pistol })
      const save = screen.getByTestId('item-form-save')
      expect(save).toBeDisabled()
      await userEvent.type(itemForm().getByLabelText('Notes'), 'heavy')
      await userEvent.type(itemForm().getByLabelText('Aliases'), 'Zapper')
      await userEvent.selectOptions(itemForm().getByLabelText('Owner'), mina.id)
      expect(save).toBeEnabled()
      await userEvent.click(save)
      expect(calls.find((c) => c.channel === 'items:update')?.req).toEqual({
        projectId,
        itemId: pistol.id,
        patch: { aliases: ['Zapper'], ownerId: mina.id, notes: 'heavy' }
      })
    })

    it('clears the owner back to Nobody with null', async () => {
      const owned = item({ ownerId: mina.id })
      const { calls } = await openPistol([owned], { 'items:update': () => owned })
      await waitFor(() => expect(itemForm().getByLabelText('Owner')).toHaveValue(mina.id))
      await userEvent.selectOptions(itemForm().getByLabelText('Owner'), '')
      await userEvent.click(screen.getByTestId('item-form-save'))
      expect(calls.find((c) => c.channel === 'items:update')?.req).toMatchObject({ patch: { ownerId: null } })
    })

    it('keeps unsaved edits when the AI changes another field, and adopts AI changes to untouched fields', async () => {
      let current: Item[] = [pistol]
      const api = installFakeApi({ 'items:list': () => current, 'characters:list': () => [mina], 'projects:open': () => ({ meta: {}, problems: [] }), 'items:update': () => pistol })
      stopSync = startEventSync()
      render(<ItemStudio />)
      await userEvent.click(await screen.findByText('Ray Pistol'))
      await userEvent.type(screen.getByTestId('item-form-name'), ' Mk2')

      current = [item({ appearanceLock: 'NEW LOCK', notes: 'dented', updatedAt: '2026-10-21T11:00:00.000Z' })]
      api.emit({ type: 'item.changed', projectId, itemId: pistol.id })
      await waitFor(() => expect(screen.getByTestId('item-form-lock')).toHaveValue('NEW LOCK'))
      expect(itemForm().getByLabelText('Notes')).toHaveValue('dented')
      expect(screen.getByTestId('item-form-name')).toHaveValue('Ray Pistol Mk2')

      await userEvent.click(screen.getByTestId('item-form-save'))
      expect(api.calls.find((c) => c.channel === 'items:update')?.req).toMatchObject({ patch: { name: 'Ray Pistol Mk2' } })
    })

    it('archives and unarchives', async () => {
      let list: Item[] = [pistol]
      const { calls } = mount({
        'items:list': () => list,
        'items:archive': () => ((list = [{ ...pistol, archived: true }]), undefined),
        'items:unarchive': () => ((list = [pistol]), undefined)
      })
      await userEvent.click(await screen.findByText('Ray Pistol'))
      await userEvent.click(screen.getByRole('button', { name: 'Archive' }))
      expect(calls.find((c) => c.channel === 'items:archive')?.req).toEqual({ projectId, itemId: pistol.id })
      await userEvent.click(await screen.findByRole('button', { name: 'Unarchive' }))
      expect(calls.find((c) => c.channel === 'items:unarchive')?.req).toEqual({ projectId, itemId: pistol.id })
      expect(await screen.findByRole('button', { name: 'Archive' })).toBeInTheDocument()
    })

    it('deletes after a confirmation and shows the refusal for an item in use', async () => {
      const { calls } = await openPistol([pistol], {
        'items:delete': () => {
          throw new Error('This item is used by 1 panel(s): pnl_0000000001. Archive it instead.')
        }
      })
      await userEvent.click(screen.getByRole('button', { name: 'Delete item' }))
      expect(calls.some((c) => c.channel === 'items:delete')).toBe(false)
      await userEvent.click(screen.getByRole('button', { name: 'Confirm delete' }))
      expect(await screen.findByRole('alert')).toHaveTextContent('Archive it instead.')
      expect(calls.find((c) => c.channel === 'items:delete')?.req).toEqual({ projectId, itemId: pistol.id })
    })

    it('goes back to the list', async () => {
      await openPistol([pistol])
      await userEvent.click(screen.getByRole('button', { name: 'Back to items' }))
      expect(screen.getByTestId('item-card')).toBeInTheDocument()
    })
  })

  describe('usages', () => {
    it('adds an action usage through the form and requests its image', async () => {
      const { calls } = await openPistol([pistol], { 'items:addUsage': () => usage({ id: 'use_0000000002', status: 'pending', imagePath: null }) })
      expect(screen.queryByTestId('usage-form')).toBeNull()
      await userEvent.click(screen.getByTestId('usage-add'))
      const form = usageForm()
      expect(form.getByLabelText('Kind')).toHaveValue('action')
      expect(within(form.getByLabelText('Kind')).getAllByRole('option').map((o) => [o.getAttribute('value'), o.textContent])).toEqual([
        ['state', 'State'],
        ['action', 'Action']
      ])
      expect(form.getByRole('button', { name: 'Create usage' })).toBeDisabled()
      await userEvent.type(form.getByLabelText('Name'), 'Firing')
      await userEvent.type(form.getByLabelText('How it is used / what changes'), 'both hands, finger on the trigger')
      await userEvent.click(form.getByRole('button', { name: 'Create usage' }))
      expect(calls.find((c) => c.channel === 'items:addUsage')?.req).toEqual({
        projectId,
        itemId: pistol.id,
        input: { name: 'Firing', kind: 'action', delta: 'both hands, finger on the trigger' },
        generate: true
      })
      await waitFor(() => expect(screen.queryByTestId('usage-form')).toBeNull())
    })

    it('adds a state usage', async () => {
      const { calls } = await openPistol([pistol], { 'items:addUsage': () => usage({ id: 'use_0000000002' }) })
      await userEvent.click(screen.getByTestId('usage-add'))
      await userEvent.type(usageForm().getByLabelText('Name'), 'Broken')
      await userEvent.selectOptions(usageForm().getByLabelText('Kind'), 'state')
      await userEvent.click(usageForm().getByRole('button', { name: 'Create usage' }))
      expect(calls.find((c) => c.channel === 'items:addUsage')?.req).toMatchObject({ input: { name: 'Broken', kind: 'state', delta: '' } })
    })

    it('keeps the form open and shows the error when adding fails', async () => {
      await openPistol([pistol], {
        'items:addUsage': () => {
          throw new Error('A usage named "Firing" already exists')
        }
      })
      await userEvent.click(screen.getByTestId('usage-add'))
      await userEvent.type(usageForm().getByLabelText('Name'), 'Firing')
      await userEvent.click(usageForm().getByRole('button', { name: 'Create usage' }))
      expect(await screen.findByRole('alert')).toHaveTextContent('already exists')
      expect(screen.getByTestId('usage-form')).toBeInTheDocument()
    })

    it('shows the kind, an image or a status, and the right actions on each card', async () => {
      let i = withUsage(pistol, 'Folded', { kind: 'state' })
      i = withUsage(i, 'Swinging', { status: 'pending', imagePath: null })
      i = withUsage(i, 'Scanning', { status: 'failed', imagePath: null, error: 'quota exceeded' })
      await openPistol([i])
      const cards = screen.getAllByTestId('usage-card')
      expect(cards).toHaveLength(4)
      const [base, state, pending, failed] = cards.map((el) => within(el))

      expect(base.getByRole('img')).toHaveAttribute('src', assetUrl(projectId, pistol.usages[0].imagePath!))
      expect(base.getByText('At rest')).toBeInTheDocument()
      expect(base.getByText('Base')).toBeInTheDocument()
      expect(base.queryByRole('button', { name: 'Delete' })).toBeNull()
      expect(base.getByRole('button', { name: 'Upload' })).toBeInTheDocument()
      expect(base.getByRole('button', { name: 'Regenerate' })).toBeInTheDocument()

      expect(state.getByText('State')).toBeInTheDocument()
      expect(state.getByRole('button', { name: 'Delete' })).toBeInTheDocument()

      expect(pending.getByText('Action')).toBeInTheDocument()
      expect(pending.queryByRole('img')).toBeNull()
      expect(pending.getByText(/generating/i)).toBeInTheDocument()
      expect(pending.queryByRole('button', { name: 'Regenerate' })).toBeNull()
      expect(pending.getByRole('button', { name: 'Upload' })).toBeDisabled()

      expect(failed.queryByRole('img')).toBeNull()
      expect(failed.getByText('Failed')).toBeInTheDocument()
      expect(failed.getByText('quota exceeded')).toBeInTheDocument()
      expect(failed.getByRole('button', { name: 'Regenerate' })).toBeInTheDocument()
    })

    it('shows the error of a failed usage and regenerates it', async () => {
      const failed = withUsage(pistol, 'Firing', { status: 'failed', imagePath: null, error: 'boom' })
      const { calls } = await openPistol([failed], { 'items:generateUsage': () => usage({ status: 'pending' }) })
      const card = within(screen.getAllByTestId('usage-card')[1])
      expect(card.getByText('boom')).toBeInTheDocument()
      await userEvent.click(card.getByRole('button', { name: 'Regenerate' }))
      expect(calls.find((c) => c.channel === 'items:generateUsage')?.req).toEqual({ projectId, itemId: pistol.id, usageId: 'use_0000000002' })
    })

    it('keeps showing the previous image on a usage whose regeneration failed', async () => {
      await openPistol([item({ usages: [usage({ status: 'failed', error: 'timeout' })] })])
      const card = within(screen.getByTestId('usage-card'))
      expect(card.getByRole('img')).toBeInTheDocument()
      expect(card.getByText('timeout')).toBeInTheDocument()
      expect(card.getByRole('button', { name: 'Regenerate' })).toBeInTheDocument()
    })

    it('uploads an image, and does nothing visible when the dialog is cancelled', async () => {
      let result: unknown = null
      const { calls } = await openPistol([pistol], { 'items:uploadUsageImage': () => result })
      await userEvent.click(screen.getByRole('button', { name: 'Upload' }))
      await waitFor(() => expect(calls.filter((c) => c.channel === 'items:uploadUsageImage')).toHaveLength(1))
      expect(calls.find((c) => c.channel === 'items:uploadUsageImage')?.req).toEqual({ projectId, itemId: pistol.id, usageId: 'use_0000000001' })
      expect(screen.queryByRole('alert')).toBeNull()

      result = usage()
      await userEvent.click(screen.getByRole('button', { name: 'Upload' }))
      await waitFor(() => expect(calls.filter((c) => c.channel === 'items:uploadUsageImage')).toHaveLength(2))
    })

    it('shows an upload failure', async () => {
      await openPistol([pistol], {
        'items:uploadUsageImage': () => {
          throw new Error('Unsupported image type: use png, jpg or webp')
        }
      })
      await userEvent.click(screen.getByRole('button', { name: 'Upload' }))
      expect(await screen.findByRole('alert')).toHaveTextContent('png, jpg or webp')
    })

    it('deletes a non-base usage after confirmation', async () => {
      const i = withUsage(pistol, 'Firing')
      const { calls } = await openPistol([i], { 'items:deleteUsage': () => undefined })
      const card = within(screen.getAllByTestId('usage-card')[1])
      await userEvent.click(card.getByRole('button', { name: 'Delete' }))
      expect(calls.some((x) => x.channel === 'items:deleteUsage')).toBe(false)
      await userEvent.click(card.getByRole('button', { name: 'Confirm delete' }))
      expect(calls.find((x) => x.channel === 'items:deleteUsage')?.req).toEqual({ projectId, itemId: pistol.id, usageId: i.usages[1].id })
    })

    it('updates the grid when the base image finishes generating', async () => {
      let i = item({ usages: [usage({ status: 'pending', imagePath: null })] })
      const api = await openPistol([i], { 'items:list': () => [i] })
      expect(within(screen.getByTestId('usage-card')).queryByRole('img')).toBeNull()
      i = item()
      api.emit({ type: 'item.changed', projectId, itemId: pistol.id })
      expect(await within(screen.getByTestId('usage-card')).findByRole('img')).toBeInTheDocument()
    })
  })

  describe('sheet check', () => {
    const open = async (check: ItemUsage['check']) => {
      mount({ 'items:list': () => [item({ usages: [usage({ check })] })] })
      await userEvent.click(await screen.findByText('Ray Pistol'))
      return within(await screen.findByTestId('usage-card'))
    }

    it('flags a failed sheet and lists its issues', async () => {
      const card = await open({ passed: false, issues: ['Barrel ring is red, lock says cyan', 'Grip is wooden'], skipped: false })
      const badge = card.getByTestId('sheet-check-failed')
      expect(badge).toHaveTextContent('Check failed')
      expect(badge).toHaveAttribute('title', 'Barrel ring is red, lock says cyan\nGrip is wooden')
      expect(card.getByText('Barrel ring is red, lock says cyan')).toBeInTheDocument()
      expect(card.queryByTestId('sheet-check-passed')).toBeNull()
    })

    it('marks a passed sheet as checked', async () => {
      const card = await open({ passed: true, issues: [], skipped: false })
      expect(card.getByTestId('sheet-check-passed')).toHaveTextContent('Checked')
      expect(card.queryByTestId('sheet-check-failed')).toBeNull()
    })

    it.each([null, { passed: false, issues: ['x'], skipped: true }])('shows nothing for an unchecked or skipped sheet (%j)', async (check) => {
      const card = await open(check)
      expect(card.queryByTestId('sheet-check-failed')).toBeNull()
      expect(card.queryByTestId('sheet-check-passed')).toBeNull()
    })
  })
})
