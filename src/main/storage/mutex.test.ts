import { describe, expect, it } from 'vitest'
import { KeyedMutex } from './mutex'

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void
  const promise = new Promise<void>((r) => {
    resolve = r
  })
  return { promise, resolve }
}
const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 5))

describe('KeyedMutex', () => {
  it('serializes the same key in submission order', async () => {
    const m = new KeyedMutex()
    const log: string[] = []
    const gateA = deferred()
    const a = m.run('k', async () => {
      log.push('a:start')
      await gateA.promise
      log.push('a:end')
    })
    const b = m.run('k', async () => {
      log.push('b:start')
      log.push('b:end')
    })
    await tick()
    expect(log).toEqual(['a:start'])
    gateA.resolve()
    await Promise.all([a, b])
    expect(log).toEqual(['a:start', 'a:end', 'b:start', 'b:end'])
  })

  it('runs different keys in parallel', async () => {
    const m = new KeyedMutex()
    const log: string[] = []
    const gate = deferred()
    const a = m.run('one', async () => {
      log.push('one:start')
      await gate.promise
      log.push('one:end')
    })
    const b = m.run('two', async () => {
      log.push('two:start')
      await gate.promise
      log.push('two:end')
    })
    await tick()
    expect(log).toEqual(['one:start', 'two:start'])
    gate.resolve()
    await Promise.all([a, b])
    expect(log).toHaveLength(4)
  })

  it('returns the callback result', async () => {
    const m = new KeyedMutex()
    expect(await m.run('k', async () => 42)).toBe(42)
  })

  it('propagates a rejection to its caller without blocking later runs on the key', async () => {
    const m = new KeyedMutex()
    const failing = m.run('k', async () => {
      throw new Error('boom')
    })
    const next = m.run('k', async () => 'ok')
    await expect(failing).rejects.toThrow('boom')
    await expect(next).resolves.toBe('ok')
  })

  it('treats a synchronous throw as a rejection and keeps the key usable', async () => {
    const m = new KeyedMutex()
    const failing = m.run('k', () => {
      throw new Error('sync boom')
    })
    await expect(failing).rejects.toThrow('sync boom')
    await expect(m.run('k', async () => 1)).resolves.toBe(1)
  })

  it('serializes a read-modify-write across many concurrent callers', async () => {
    const m = new KeyedMutex()
    let value = 0
    await Promise.all(
      Array.from({ length: 25 }, () =>
        m.run('counter', async () => {
          const read = value
          await Promise.resolve()
          value = read + 1
        })
      )
    )
    expect(value).toBe(25)
  })
})
