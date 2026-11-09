import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import type { StyleEntry, StyleUsage } from '@shared/ipc'
import type { ProjectMeta } from '@shared/types'
import { initialAppState, useAppStore } from '../../stores/app-store'
import { installFakeApi } from '../../test/fake-api'
import { StyleButton } from './StyleButton'

const P = 'prj_aaaaaaaaaa'
const NOW = '2026-10-21T10:00:00.000Z'
const KOREAN = 'Clean webtoon'

function meta(stylePreset: string): ProjectMeta {
  return { id: P, title: 'Moon', logline: '', stylePreset, defaultAspect: '2:3', autopilotPanels: 4, consistencyRetries: 1, createdAt: NOW, updatedAt: NOW }
}

function library(): StyleEntry[] {
  return [
    { id: 'korean-webtoon', name: 'Korean webtoon', text: KOREAN, builtin: true, edited: false },
    { id: 'watercolor', name: 'Watercolor', text: 'Wet wash', builtin: true, edited: true },
    { id: 'sty_0000000001', name: 'Mine', text: 'Ink wash', builtin: false, edited: false }
  ]
}

interface Options {
  stylePreset?: string
  usage?: StyleUsage
  loadError?: string | null
  listFails?: boolean
  createFails?: string
}

/** A fake library that really changes, so a test sees what the dialog shows after a save. */
function setup(o: Options = {}) {
  let styles = library()
  const fake = installFakeApi({
    'styles:list': () => {
      if (o.listFails) throw new Error('disk full')
      return { styles, loadError: o.loadError ?? null }
    },
    'styles:usage': () => o.usage ?? { sheets: 0, panels: 0 },
    'styles:apply': (req: { styleId: string }) => meta(styles.find((s) => s.id === req.styleId)!.text),
    'styles:create': (req: { name: string; text: string }) => {
      if (o.createFails) throw new Error(o.createFails)
      const created = { id: 'sty_0000000002', ...req, builtin: false, edited: false }
      styles = [...styles, created]
      return created
    },
    'styles:update': (req: { id: string; patch: { name?: string; text?: string } }) => {
      styles = styles.map((s) => (s.id === req.id ? { ...s, ...req.patch, edited: s.builtin } : s))
      return styles.find((s) => s.id === req.id)!
    },
    'styles:reset': (req: { id: string }) => {
      styles = styles.map((s) => (s.id === req.id ? { ...s, edited: false } : s))
      return styles.find((s) => s.id === req.id)!
    },
    'styles:delete': (req: { id: string }) => {
      styles = styles.filter((s) => s.id !== req.id)
    }
  })
  useAppStore.setState({ ...initialAppState, projects: [meta(o.stylePreset ?? KOREAN)], projectId: P })
  render(<StyleButton />)
  return fake
}

const button = () => screen.getByTestId('style-button')
const row = (name: string): HTMLElement => {
  const found = screen.getAllByTestId('style-row').find((r) => within(r).queryByText(name) !== null)
  if (!found) throw new Error(`no row for ${name}`)
  return found
}
async function openDialog() {
  await waitFor(() => expect(button().textContent).not.toBe('Style: Custom'))
  await userEvent.click(button())
  await screen.findByRole('dialog', { name: 'Art style' })
  await screen.findAllByTestId('style-row')
}
const inRow = (name: string, label: string) => within(row(name)).getByRole('button', { name: label })

beforeEach(() => {
  useAppStore.setState({ ...initialAppState })
})

describe('StyleButton', () => {
  it('shows the current style name on the button', async () => {
    setup()
    await waitFor(() => expect(button().textContent).toBe('Style: Korean webtoon'))
  })

  it('shows Custom when no style matches', async () => {
    const { calls } = setup({ stylePreset: 'Something else' })
    await waitFor(() => expect(calls.some((c) => c.channel === 'styles:list')).toBe(true))
    expect(button().textContent).toBe('Style: Custom')
  })

  it('stays usable when the list fails', async () => {
    const { calls } = setup({ listFails: true })
    await waitFor(() => expect(calls.some((c) => c.channel === 'styles:list')).toBe(true))
    expect(button().textContent).toBe('Style: Custom')
    await userEvent.click(button())
    expect((await screen.findByRole('alert')).textContent).toContain('disk full')
  })

  it('renders nothing without a project', () => {
    installFakeApi({})
    render(<StyleButton />)
    expect(screen.queryByTestId('style-button')).toBeNull()
  })
})

describe('StyleDialog', () => {
  it('marks the current style and lists the others', async () => {
    setup()
    await openDialog()
    expect(screen.getAllByTestId('style-row')).toHaveLength(3)
    expect(row('Korean webtoon').textContent).toContain('Current')
    expect(within(row('Korean webtoon')).queryByRole('button', { name: 'Use' })).toBeNull()
    expect(inRow('Mine', 'Use')).toBeTruthy()
  })

  it('switches at once when the project has no art', async () => {
    const { calls } = setup()
    await openDialog()
    await userEvent.click(inRow('Watercolor', 'Use'))
    await waitFor(() => expect(button().textContent).toBe('Style: Watercolor'))
    expect(calls.find((c) => c.channel === 'styles:apply')?.req).toEqual({ projectId: P, styleId: 'watercolor' })
    expect(screen.queryByRole('dialog', { name: 'Art style' })).toBeNull()
  })

  it('warns before switching when the project has art', async () => {
    const { calls } = setup({ usage: { sheets: 3, panels: 12 } })
    await openDialog()
    await userEvent.click(inRow('Watercolor', 'Use'))
    await screen.findByText('3 sheets and 12 panels were drawn in the current style. New images will use the new style, and references drawn in the old one may not match. Nothing is redrawn automatically.')
    expect(calls.some((c) => c.channel === 'styles:apply')).toBe(false)
    await userEvent.click(screen.getByRole('button', { name: 'Switch style' }))
    await waitFor(() => expect(button().textContent).toBe('Style: Watercolor'))
    expect(calls.filter((c) => c.channel === 'styles:apply')).toHaveLength(1)
  })

  it('uses the singular for one', async () => {
    setup({ usage: { sheets: 1, panels: 1 } })
    await openDialog()
    await userEvent.click(inRow('Watercolor', 'Use'))
    await screen.findByText(/^1 sheet and 1 panel were drawn in the current style\./)
  })

  it('cancelling the warning changes nothing', async () => {
    const { calls } = setup({ usage: { sheets: 3, panels: 0 } })
    await openDialog()
    await userEvent.click(inRow('Watercolor', 'Use'))
    await userEvent.click(await screen.findByRole('button', { name: 'Cancel' }))
    expect(calls.some((c) => c.channel === 'styles:apply')).toBe(false)
    expect(screen.getAllByTestId('style-row')).toHaveLength(3)
    expect(button().textContent).toBe('Style: Korean webtoon')
  })

  it('adds a style', async () => {
    const { calls } = setup()
    await openDialog()
    await userEvent.click(screen.getByRole('button', { name: 'Add style' }))
    await userEvent.type(screen.getByLabelText('Name'), 'Rainy')
    await userEvent.type(screen.getByLabelText('Description'), 'Blue wash')
    await userEvent.click(screen.getByRole('button', { name: 'Save style' }))
    await waitFor(() => expect(screen.getAllByTestId('style-row')).toHaveLength(4))
    expect(calls.find((c) => c.channel === 'styles:create')?.req).toEqual({ name: 'Rainy', text: 'Blue wash' })
  })

  it('shows a rejected style inline and keeps what was typed', async () => {
    setup({ createFails: 'A style name needs 1 to 40 characters.' })
    await openDialog()
    await userEvent.click(screen.getByRole('button', { name: 'Add style' }))
    await userEvent.type(screen.getByLabelText('Name'), 'Rainy')
    await userEvent.type(screen.getByLabelText('Description'), 'Blue wash')
    await userEvent.click(screen.getByRole('button', { name: 'Save style' }))
    expect((await screen.findByRole('alert')).textContent).toBe('A style name needs 1 to 40 characters.')
    expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('Rainy')
    expect((screen.getByLabelText('Description') as HTMLTextAreaElement).value).toBe('Blue wash')
  })

  it('edits a built-in and offers reset once edited', async () => {
    const { calls } = setup()
    await openDialog()
    expect(within(row('Korean webtoon')).queryByRole('button', { name: 'Reset to default' })).toBeNull()
    await userEvent.click(inRow('Korean webtoon', 'Edit'))
    const description = screen.getByLabelText('Description') as HTMLTextAreaElement
    expect(description.value).toBe(KOREAN)
    await userEvent.clear(description)
    await userEvent.type(description, 'Sharper ink')
    await userEvent.click(screen.getByRole('button', { name: 'Save style' }))
    await screen.findByText('Sharper ink')
    expect(calls.find((c) => c.channel === 'styles:update')?.req).toEqual({ id: 'korean-webtoon', patch: { name: 'Korean webtoon', text: 'Sharper ink' } })
    expect(inRow('Korean webtoon', 'Reset to default')).toBeTruthy()
  })

  it('resets an edited built-in', async () => {
    const { calls } = setup()
    await openDialog()
    await userEvent.click(inRow('Watercolor', 'Reset to default'))
    await waitFor(() => expect(within(row('Watercolor')).queryByRole('button', { name: 'Reset to default' })).toBeNull())
    expect(calls.find((c) => c.channel === 'styles:reset')?.req).toEqual({ id: 'watercolor' })
  })

  it('only custom styles can be deleted, after confirming', async () => {
    const { calls } = setup()
    await openDialog()
    expect(within(row('Watercolor')).queryByRole('button', { name: 'Delete' })).toBeNull()
    await userEvent.click(inRow('Mine', 'Delete'))
    expect(calls.some((c) => c.channel === 'styles:delete')).toBe(false)
    await userEvent.click(inRow('Mine', 'Confirm delete'))
    await waitFor(() => expect(screen.getAllByTestId('style-row')).toHaveLength(2))
    expect(calls.find((c) => c.channel === 'styles:delete')?.req).toEqual({ id: 'sty_0000000001' })
  })

  it('shows a library load error', async () => {
    setup({ loadError: 'styles.json is corrupt' })
    await openDialog()
    expect(screen.getByRole('alert').textContent).toContain('styles.json is corrupt')
  })

  it('closes without changing anything', async () => {
    const { calls } = setup()
    await openDialog()
    await userEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(screen.queryByRole('dialog', { name: 'Art style' })).toBeNull()
    expect(calls.some((c) => c.channel === 'styles:apply')).toBe(false)
  })
})
