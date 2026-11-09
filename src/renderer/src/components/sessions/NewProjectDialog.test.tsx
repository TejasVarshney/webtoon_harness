import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { StyleEntry } from '@shared/ipc'
import { installFakeApi } from '../../test/fake-api'
import { NewProjectDialog } from './NewProjectDialog'

const styles: StyleEntry[] = [
  { id: 'korean-webtoon', name: 'Korean webtoon', text: 'Clean webtoon', builtin: true, edited: false },
  { id: 'watercolor', name: 'Watercolor', text: 'My edited wash', builtin: true, edited: true }
]

function setup(listFails = false) {
  const fake = installFakeApi({
    'styles:list': () => {
      if (listFails) throw new Error('disk full')
      return { styles, loadError: null }
    }
  })
  const onCreate = vi.fn(async () => undefined)
  render(<NewProjectDialog onCreate={onCreate} onCancel={() => undefined} />)
  return { ...fake, onCreate }
}

describe('NewProjectDialog', () => {
  it('offers the styles and preselects the first', async () => {
    setup()
    const select = (await screen.findByLabelText('Style')) as HTMLSelectElement
    expect(select.value).toBe('korean-webtoon')
    expect([...select.options].map((o) => o.text)).toEqual(['Korean webtoon', 'Watercolor'])
  })

  it('passes the chosen style text', async () => {
    const { onCreate } = setup()
    await userEvent.selectOptions(await screen.findByLabelText('Style'), 'watercolor')
    await userEvent.type(screen.getByLabelText('Title'), 'Moon')
    await userEvent.click(screen.getByRole('button', { name: 'Create' }))
    await waitFor(() => expect(onCreate).toHaveBeenCalledWith('Moon', 'My edited wash'))
  })

  it('still creates when the list fails', async () => {
    const { calls, onCreate } = setup(true)
    await waitFor(() => expect(calls.some((c) => c.channel === 'styles:list')).toBe(true))
    expect(screen.queryByLabelText('Style')).toBeNull()
    await userEvent.type(screen.getByLabelText('Title'), 'Moon')
    await userEvent.click(screen.getByRole('button', { name: 'Create' }))
    await waitFor(() => expect(onCreate).toHaveBeenCalledWith('Moon', undefined))
  })
})
