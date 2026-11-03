import { describe, expect, it, vi } from 'vitest'
import { createQuitGate } from './quit-gate'

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

function setup(opts: { cancel?: () => void; stopPlugins?: () => Promise<void> } = {}) {
  const deps = {
    cancelRuns: vi.fn(opts.cancel ?? (() => {})),
    stopPlugins: vi.fn(opts.stopPlugins ?? (() => Promise.resolve())),
    quit: vi.fn()
  }
  return { deps, onBeforeQuit: createQuitGate(deps) }
}

const event = () => ({ preventDefault: vi.fn() })

describe('createQuitGate', () => {
  it('holds the first quit back until the plugins stopped, then quits and lets the next one pass', async () => {
    const { deps, onBeforeQuit } = setup()
    const first = event()
    onBeforeQuit(first)
    expect(first.preventDefault).toHaveBeenCalled()
    expect(deps.cancelRuns).toHaveBeenCalledOnce()
    expect(deps.stopPlugins).toHaveBeenCalledOnce()
    await flush()
    expect(deps.quit).toHaveBeenCalledOnce()
    const second = event()
    onBeforeQuit(second)
    expect(second.preventDefault).not.toHaveBeenCalled()
  })

  it('ignores a repeat quit while the plugins are stopping', () => {
    const { deps, onBeforeQuit } = setup({ stopPlugins: () => new Promise(() => {}) })
    onBeforeQuit(event())
    const again = event()
    onBeforeQuit(again)
    expect(again.preventDefault).toHaveBeenCalled()
    expect(deps.stopPlugins).toHaveBeenCalledOnce()
  })

  it('still stops the plugins and quits when cancelling the runs throws', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    const failure = new Error('cancel failed')
    const { deps, onBeforeQuit } = setup({
      cancel: () => {
        throw failure
      }
    })
    expect(() => onBeforeQuit(event())).not.toThrow()
    expect(deps.stopPlugins).toHaveBeenCalledOnce()
    await flush()
    expect(deps.quit).toHaveBeenCalledOnce()
    expect(logged).toHaveBeenCalledWith('Could not cancel the runs at quit', failure)
    logged.mockRestore()
  })

  it('quits even when stopping the plugins rejects', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    const failure = new Error('stuck')
    const { deps, onBeforeQuit } = setup({ stopPlugins: () => Promise.reject(failure) })
    onBeforeQuit(event())
    await flush()
    expect(deps.quit).toHaveBeenCalledOnce()
    expect(logged).toHaveBeenCalledWith('Could not stop the plugins at quit', failure)
    logged.mockRestore()
  })
})
