import { act, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChatMessage } from '@shared/types'
import { initialAppState, useAppStore } from '../../stores/app-store'
import { useChatStore } from '../../stores/chat-store'
import { MessageList } from './MessageList'

const T = 'ses_0000000001'
const NOW = '2026-10-21T10:00:00.000Z'

function assistant(id: string, text: string, toolCalls: { id: string; name: string; input: unknown }[] = []): ChatMessage {
  return {
    id,
    role: 'assistant',
    text,
    toolCalls,
    stopReason: toolCalls.length > 0 ? 'tool_use' : 'end',
    model: { endpointId: 'end_0000000000', modelId: 'mock-text' },
    raw: null,
    createdAt: NOW
  }
}

beforeEach(() => {
  useAppStore.setState({ ...initialAppState, projectId: 'prj_aaaaaaaaaa' })
  useChatStore.setState({ messages: {}, streaming: {}, notices: {} })
})

describe('MessageList', () => {
  it('streams deltas into the in-progress bubble', () => {
    render(<MessageList threadKey={T} />)
    act(() => {
      useChatStore.getState().applyAgentEvent(T, { kind: 'text-delta', runId: 'run_1', text: 'Hel' })
      useChatStore.getState().applyAgentEvent(T, { kind: 'text-delta', runId: 'run_1', text: 'lo' })
    })
    expect(screen.getByTestId('message-assistant')).toHaveTextContent('Hello')
    act(() => useChatStore.getState().applyAgentEvent(T, { kind: 'message', runId: 'run_1', message: assistant('msg_0000000001', 'Hello') }))
    expect(screen.getAllByTestId('message-assistant')).toHaveLength(1)
    expect(useChatStore.getState().streaming[T]).toBe('')
  })

  it('appends a local error notice when a run finishes with an error', () => {
    render(<MessageList threadKey={T} />)
    act(() =>
      useChatStore.getState().applyAgentEvent(T, {
        kind: 'run-finished',
        runId: 'run_1',
        outcome: 'error',
        error: "No model assigned to role 'agent'. Open Settings → Models."
      })
    )
    expect(screen.getByRole('alert')).toHaveTextContent("No model assigned to role 'agent'")
  })

  it('panel thumbnails select the panel', async () => {
    useChatStore.setState({
      messages: {
        [T]: [
          assistant('msg_0000000001', 'Drawing', [{ id: 'c1', name: 'create_panel', input: { description: 'A moonlit rooftop' } }]),
          {
            id: 'msg_0000000002',
            role: 'tool',
            results: [{ toolCallId: 'c1', name: 'create_panel', ok: true, content: 'ok', images: ['panels/pnl_0000000001/ver_0000000001.png'] }],
            createdAt: NOW
          }
        ]
      }
    })
    render(<MessageList threadKey={T} />)
    const card = screen.getByTestId('tool-card')
    expect(card).toHaveTextContent('create_panel')
    expect(card).toHaveTextContent('ok')
    const image = screen.getByTestId('tool-image')
    expect(image.querySelector('img')).toHaveAttribute('src', 'webtoon-asset://prj_aaaaaaaaaa/panels/pnl_0000000001/ver_0000000001.png')
    await userEvent.click(image)
    expect(useAppStore.getState().selectedPanelId).toBe('pnl_0000000001')
  })

  it('shows a running tool call without a result', () => {
    useChatStore.setState({ messages: { [T]: [assistant('msg_0000000001', '', [{ id: 'c1', name: 'get_story', input: {} }])] } })
    render(<MessageList threadKey={T} />)
    expect(screen.getByTestId('tool-card')).toHaveAttribute('data-status', 'running')
    expect(screen.queryByTestId('message-assistant')).toBeNull()
  })

  it('hides the state snapshot', () => {
    useChatStore.setState({
      messages: {
        [T]: [{ id: 'msg_0000000001', role: 'user', text: 'Hi there', imagePaths: [], stateSnapshot: '<project_state>secret</project_state>', createdAt: NOW }]
      }
    })
    render(<MessageList threadKey={T} />)
    expect(screen.getByTestId('message-user')).toHaveTextContent('Hi there')
    expect(document.body.textContent).not.toContain('<project_state>')
    expect(document.body.textContent).not.toContain('secret')
  })

  it('renders assistant markdown without raw html', () => {
    useChatStore.setState({ messages: { [T]: [assistant('msg_0000000001', '**bold** <script>alert(1)</script> <b>raw</b>')] } })
    render(<MessageList threadKey={T} />)
    const bubble = screen.getByTestId('message-assistant')
    expect(bubble.querySelector('strong')).toHaveTextContent('bold')
    expect(bubble.querySelector('script')).toBeNull()
    expect(bubble.querySelector('b')).toBeNull()
  })

  it('opens markdown links through window.open instead of navigating', () => {
    useChatStore.setState({ messages: { [T]: [assistant('msg_0000000001', '[x](https://remote.example/a) and [y](javascript:alert(1))')] } })
    const open = vi.spyOn(window, 'open').mockReturnValue(null)
    render(<MessageList threadKey={T} />)
    const notPrevented = fireEvent.click(screen.getByRole('link', { name: 'x' }))
    expect(notPrevented).toBe(false)
    expect(open).toHaveBeenCalledWith('https://remote.example/a')
    expect(screen.queryByRole('link', { name: 'y' })).toBeNull()
    open.mockRestore()
  })
})
