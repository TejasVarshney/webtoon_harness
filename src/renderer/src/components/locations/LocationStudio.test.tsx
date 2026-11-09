import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { assetUrl } from '@shared/asset-url'
import type { Location } from '@shared/types'
import { startEventSync } from '../../events'
import { initialAppState, useAppStore } from '../../stores/app-store'
import { initialLocationsState, useLocationsStore } from '../../stores/locations-store'
import { PROJECT_ID as projectId } from '../../test/character-fixtures'
import { installFakeApi } from '../../test/fake-api'
import { location, locationState } from '../../test/location-fixtures'
import { LAYOUT_HINT, LAYOUT_SAVED } from './LocationForm'
import { LocationStudio } from './LocationStudio'

// The twin of ItemStudio.test.tsx for what the Locations tab does.

const stockroom = location()
let stopSync: (() => void) | undefined

beforeEach(() => {
  useAppStore.setState({ ...initialAppState, projectId, sessionId: 'ses_0000000001' })
  useLocationsStore.setState({ ...initialLocationsState })
})
afterEach(() => stopSync?.())

function mount(handlers: Parameters<typeof installFakeApi>[0]) {
  const api = installFakeApi({ 'locations:list': () => [stockroom], 'projects:open': () => ({ meta: {}, problems: [] }), ...handlers })
  stopSync = startEventSync()
  render(<LocationStudio />)
  return api
}

const form = (): ReturnType<typeof within> => within(screen.getByTestId('location-form'))

async function openStockroom(locations: Location[], handlers: Parameters<typeof installFakeApi>[0] = {}) {
  const api = mount({ 'locations:list': () => locations, ...handlers })
  await userEvent.click(await screen.findByText('Back stockroom'))
  return api
}

describe('LocationStudio', () => {
  it('lists active locations as cards with their base picture, and archived ones on request', async () => {
    const drawing = location({ id: 'loc_0000000002', name: 'Rooftop', states: [locationState({ id: 'lst_0000000002', locationId: 'loc_0000000002', status: 'pending', imagePath: null })] })
    const old = location({ id: 'loc_0000000003', name: 'Old flat', archived: true })
    const { calls } = mount({ 'locations:list': () => [stockroom, drawing, old] })
    const cards = await screen.findAllByTestId('location-card')
    expect(cards).toHaveLength(2)
    expect(calls.find((c) => c.channel === 'locations:list')).toEqual({ channel: 'locations:list', req: { projectId, includeArchived: true } })
    expect(within(cards[0]).getByRole('img')).toHaveAttribute('src', assetUrl(projectId, stockroom.states[0].imagePath!))
    expect(within(cards[0]).getByText('1 state')).toBeInTheDocument()
    expect(within(cards[1]).getByText('Generating…')).toBeInTheDocument()
    await userEvent.click(screen.getByLabelText('Show archived'))
    expect(screen.getAllByTestId('location-card')).toHaveLength(3)
  })

  it('shows the empty state, and asks for a project first', async () => {
    mount({ 'locations:list': () => [] })
    expect(await screen.findByText('No locations yet. Create one, or ask the agent to.')).toBeInTheDocument()
  })

  it('creates a location from its name and layout, which draws the base picture, and opens it', async () => {
    const created = location({ id: 'loc_0000000009', name: 'Night bus stop', layout: 'Streetlight at frame-left.' })
    let listed: Location[] = []
    const { calls } = mount({
      'locations:list': () => listed,
      'locations:create': () => {
        listed = [created]
        return created
      }
    })
    await userEvent.click(await screen.findByRole('button', { name: 'New location' }))
    expect(form().getByText(LAYOUT_HINT)).toBeInTheDocument()
    const save = form().getByRole('button', { name: 'Create location' })
    await userEvent.type(form().getByLabelText('Name'), 'Night bus stop')
    expect(save).toBeDisabled()
    await userEvent.type(form().getByLabelText('Layout'), 'Streetlight at frame-left.')
    await userEvent.click(save)
    await waitFor(() =>
      expect(calls.find((c) => c.channel === 'locations:create')?.req).toEqual({
        projectId,
        input: { name: 'Night bus stop', aliases: [], notes: '', layout: 'Streetlight at frame-left.' },
        generateBase: true
      })
    )
    expect(await screen.findByRole('heading', { name: 'Night bus stop' })).toBeInTheDocument()
  })

  it('saves only the changed fields, and says the pictures need redrawing after a layout change', async () => {
    const { calls } = await openStockroom([stockroom], { 'locations:update': () => stockroom })
    await userEvent.clear(form().getByLabelText('Layout'))
    await userEvent.type(form().getByLabelText('Layout'), 'Back door at frame-right.')
    await userEvent.click(form().getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(calls.find((c) => c.channel === 'locations:update')?.req).toEqual({ projectId, locationId: stockroom.id, patch: { layout: 'Back door at frame-right.' } }))
    expect(await screen.findByRole('status')).toHaveTextContent(LAYOUT_SAVED)
  })

  it('adds a state without a picture unless asked, and offers to draw one later', async () => {
    const night = locationState({ id: 'lst_0000000002', name: 'Night', kind: 'state', delta: 'embers only', status: 'failed', error: 'No image yet: upload one or regenerate', imagePath: null })
    let listed = [stockroom]
    const { calls } = await openStockroom(listed, {
      'locations:list': () => listed,
      'locations:addState': () => {
        listed = [{ ...stockroom, states: [...stockroom.states, night] }]
        return night
      },
      'locations:generateState': () => ({ ...night, status: 'pending', error: null })
    })
    await userEvent.click(screen.getByTestId('state-add'))
    const stateForm = within(screen.getByTestId('state-form'))
    await userEvent.type(stateForm.getByLabelText('Name'), 'Night')
    await userEvent.type(stateForm.getByLabelText('What changes'), 'embers only')
    expect(stateForm.getByLabelText('Draw its own picture')).not.toBeChecked()
    await userEvent.click(stateForm.getByRole('button', { name: 'Create state' }))
    await waitFor(() =>
      expect(calls.find((c) => c.channel === 'locations:addState')?.req).toEqual({ projectId, locationId: stockroom.id, input: { name: 'Night', delta: 'embers only' }, generate: false })
    )
    const cards = await screen.findAllByTestId('state-card')
    expect(cards).toHaveLength(2)
    // A state never drawn is not shown as a failure: panels use the base picture.
    expect(within(cards[1]).getByText('Uses the base picture')).toBeInTheDocument()
    expect(within(cards[1]).queryByText('No image yet: upload one or regenerate')).toBeNull()
    await userEvent.click(within(cards[1]).getByRole('button', { name: 'Draw picture' }))
    await waitFor(() => expect(calls.some((c) => c.channel === 'locations:generateState')).toBe(true))
    expect(within(cards[0]).queryByRole('button', { name: 'Delete' })).toBeNull()
  })

  it('shows why a delete was refused', async () => {
    await openStockroom([stockroom], {
      'locations:delete': () => {
        throw new Error('This location is used by 1 panel(s): pnl_0000000001. Archive it instead.')
      }
    })
    await userEvent.click(screen.getByRole('button', { name: 'Delete location' }))
    await userEvent.click(await screen.findByRole('button', { name: /confirm|yes|delete/i }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Archive it instead.')
  })
})
