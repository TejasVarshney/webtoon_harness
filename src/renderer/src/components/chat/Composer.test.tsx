import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { initialAppState, useAppStore } from '../../stores/app-store'
import { installFakeApi } from '../../test/fake-api'
import { Composer } from './Composer'

beforeEach(() => {
  useAppStore.setState({ ...initialAppState, projectId: 'prj_aaaaaaaaaa' })
})

describe('Composer', () => {
  it('Enter sends, Shift+Enter inserts newline, Stop while running', async () => {
    const onSend = vi.fn()
    const onStop = vi.fn()
    const { rerender } = render(<Composer onSend={onSend} running={false} onStop={onStop} />)
    const input = screen.getByTestId('composer-input')

    await userEvent.type(input, 'a{Shift>}{Enter}{/Shift}b')
    expect(input).toHaveValue('a\nb')
    expect(onSend).not.toHaveBeenCalled()

    await userEvent.clear(input)
    await userEvent.type(input, 'hi{Enter}')
    expect(onSend).toHaveBeenCalledWith('hi', [])
    expect(input).toHaveValue('')

    expect(screen.queryByTestId('composer-stop')).toBeNull()
    rerender(<Composer onSend={onSend} running={true} onStop={onStop} />)
    expect(screen.queryByTestId('composer-send')).toBeNull()
    await userEvent.click(screen.getByTestId('composer-stop'))
    expect(onStop).toHaveBeenCalledTimes(1)
  })

  it('does not send blank text', async () => {
    const onSend = vi.fn()
    render(<Composer onSend={onSend} running={false} onStop={() => undefined} />)
    await userEvent.type(screen.getByTestId('composer-input'), '   {Enter}')
    expect(onSend).not.toHaveBeenCalled()
  })

  it('attaches picked images and sends their paths', async () => {
    const onSend = vi.fn()
    const { calls } = installFakeApi({ 'uploads:pickImages': () => ({ paths: ['uploads/upl_0000000001.png'] }) })
    render(<Composer onSend={onSend} running={false} onStop={() => undefined} />)
    await userEvent.click(screen.getByTestId('composer-attach'))
    await waitFor(() => expect(screen.getByText('upl_0000000001.png')).toBeInTheDocument())
    expect(calls[0]).toEqual({ channel: 'uploads:pickImages', req: { projectId: 'prj_aaaaaaaaaa' } })
    await userEvent.type(screen.getByTestId('composer-input'), 'look{Enter}')
    expect(onSend).toHaveBeenCalledWith('look', ['uploads/upl_0000000001.png'])
  })

  it('is controlled by its parent when given a value', async () => {
    const onSend = vi.fn()
    const onValueChange = vi.fn()
    const { rerender } = render(<Composer value="prefilled" onValueChange={onValueChange} onSend={onSend} running={false} onStop={() => undefined} />)
    const input = screen.getByTestId('composer-input')
    expect(input).toHaveValue('prefilled')
    await userEvent.type(input, '!')
    expect(onValueChange).toHaveBeenLastCalledWith('prefilled!')
    expect(input).toHaveValue('prefilled')
    rerender(<Composer value="changed from outside" onValueChange={onValueChange} onSend={onSend} running={false} onStop={() => undefined} />)
    expect(input).toHaveValue('changed from outside')
    await userEvent.type(input, '{Enter}')
    expect(onSend).toHaveBeenCalledWith('changed from outside', [])
    expect(onValueChange).toHaveBeenLastCalledWith('')
  })
})
