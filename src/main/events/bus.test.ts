import { describe, expect, it, vi } from 'vitest'
import type { AppEvent } from '@shared/types'
import { EventBus } from './bus'

const changed: AppEvent = { type: 'project.changed', projectId: 'prj_0000000001' }

describe('EventBus', () => {
  it('delivers an event to every subscriber, in subscription order', () => {
    const bus = new EventBus()
    const seen: string[] = []
    bus.subscribe((e) => seen.push(`a:${e.type}`))
    bus.subscribe((e) => seen.push(`b:${e.type}`))
    bus.emit(changed)
    expect(seen).toEqual(['a:project.changed', 'b:project.changed'])
  })

  it('stops delivering after unsubscribe, and unsubscribing twice is harmless', () => {
    const bus = new EventBus()
    const fn = vi.fn()
    const unsubscribe = bus.subscribe(fn)
    bus.emit(changed)
    unsubscribe()
    unsubscribe()
    bus.emit(changed)
    expect(fn).toHaveBeenCalledTimes(1)
    expect(fn).toHaveBeenCalledWith(changed)
  })

  it('treats the same function subscribed twice as two subscriptions', () => {
    const bus = new EventBus()
    const fn = vi.fn()
    const first = bus.subscribe(fn)
    bus.subscribe(fn)
    first()
    bus.emit(changed)
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('keeps delivering when a subscriber throws, and reports the failure', () => {
    const bus = new EventBus()
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const after = vi.fn()
    bus.subscribe(() => {
      throw new Error('boom')
    })
    bus.subscribe(after)
    expect(() => bus.emit(changed)).not.toThrow()
    expect(after).toHaveBeenCalledWith(changed)
    expect(error).toHaveBeenCalledTimes(1)
    error.mockRestore()
  })

  it('lets a subscriber unsubscribe itself or another one mid-emit without skipping anyone', () => {
    const bus = new EventBus()
    const seen: string[] = []
    const unsubscribeFirst = bus.subscribe(() => {
      seen.push('first')
      unsubscribeFirst()
    })
    bus.subscribe(() => seen.push('second'))
    bus.emit(changed)
    bus.emit(changed)
    expect(seen).toEqual(['first', 'second', 'second'])
  })
})
