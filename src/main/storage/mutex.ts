/**
 * Serializes async work per key (callers pass an absolute file path), so a read-modify-write on
 * one file never interleaves with another on the same file, while different files run in parallel.
 * Waiters run in submission order. A rejection reaches only its own caller; it never blocks the
 * queue behind it.
 */
export class KeyedMutex {
  /** Settled-never-rejecting tail of each key's queue; an entry is dropped once its queue drains. */
  private readonly tails = new Map<string, Promise<void>>()

  run<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(key) ?? Promise.resolve()
    const result = previous.then(() => fn())
    const tail = result.then(
      () => undefined,
      () => undefined
    )
    this.tails.set(key, tail)
    void tail.then(() => {
      if (this.tails.get(key) === tail) this.tails.delete(key)
    })
    return result
  }
}
