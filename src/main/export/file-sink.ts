// The file plumbing the ZIP and PDF writers share: sequential writes through a handle, and an abort that cleans up.

import fs from 'node:fs'

/** A file written front to back. Tracks the write position, and can be aborted to leave nothing behind. */
export class FileSink {
  private position = 0
  private isOpen = true

  private constructor(
    private readonly path: string,
    private readonly handle: fs.promises.FileHandle
  ) {}

  /** Create (or truncate) the file at `path`. */
  static async open(path: string): Promise<FileSink> {
    return new FileSink(path, await fs.promises.open(path, 'w'))
  }

  /**
   * Open `path`, run `init` on the sink, and return the sink. If `init` fails the handle is closed and the
   * file removed before the error is rethrown, so a failed open leaves nothing behind.
   */
  static async openWith(path: string, init: (sink: FileSink) => Promise<void>): Promise<FileSink> {
    const sink = await FileSink.open(path)
    try {
      await init(sink)
    } catch (err) {
      await sink.abort()
      throw err
    }
    return sink
  }

  /** The number of bytes written so far, which is the offset of the next write. */
  get offset(): number {
    return this.position
  }

  /** Append `buf`. Throws if the file accepts no bytes, rather than looping forever. */
  async write(buf: Buffer): Promise<void> {
    let done = 0
    while (done < buf.length) {
      const { bytesWritten } = await this.handle.write(buf, done, buf.length - done, this.position + done)
      if (bytesWritten === 0) throw new Error(`Could not write to ${this.path}`)
      done += bytesWritten
    }
    this.position += buf.length
  }

  /** Close the file, keeping it. */
  async close(): Promise<void> {
    this.isOpen = false
    await this.handle.close()
  }

  /** Close the handle and delete the file. Safe after a failed write, and safe to call twice. */
  async abort(): Promise<void> {
    if (this.isOpen) {
      this.isOpen = false
      await this.handle.close().catch(() => undefined)
    }
    await fs.promises.rm(this.path, { force: true })
  }
}
