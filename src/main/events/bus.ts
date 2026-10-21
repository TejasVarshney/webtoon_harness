import type { AppEvent } from '@shared/types'

export type AppEventListener = (event: AppEvent) => void

/**
 * In-process publish/subscribe for `AppEvent`s (spec §4). Services emit after a mutation has been
 * written; the IPC layer subscribes once and broadcasts to every window.
 *
 * Delivery is synchronous, in subscription order, over a snapshot of the subscribers. A listener
 * that throws is reported and skipped: the mutation that emitted has already been persisted, so a
 * misbehaving subscriber must not turn it into a failure for the caller.
 */
export class EventBus {
  /** One entry per subscription (not per function), so the same function can subscribe twice. */
  private readonly subscriptions = new Set<{ readonly listener: AppEventListener }>()

  emit(event: AppEvent): void {
    for (const { listener } of [...this.subscriptions]) {
      try {
        listener(event)
      } catch (error) {
        console.error(`EventBus: a subscriber threw while handling ${event.type}`, error)
      }
    }
  }

  /** Returns the function that removes this subscription; calling it again does nothing. */
  subscribe(listener: AppEventListener): () => void {
    const subscription = { listener }
    this.subscriptions.add(subscription)
    return () => {
      this.subscriptions.delete(subscription)
    }
  }
}
