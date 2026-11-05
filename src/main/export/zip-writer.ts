// A store-only ZIP writer, enough for a CBZ: pages are already compressed images, so there is no deflate.
// Streams to a file handle, so a long episode is never held in memory twice.

import fs from 'node:fs'
import zlib from 'node:zlib'

const LIMIT = 0xffffffff
/** 1980-01-01 00:00:00 in DOS time, fixed so the same pages always give the same bytes. */
const DOS_TIME = 0
const DOS_DATE = (1 << 5) | 1
const UTF8_NAME = 0x0800

interface Entry {
  name: Buffer
  crc: number
  size: number
  offset: number
}

/** Writes entries one at a time, then the central directory on `close()`. No ZIP64, so it stops at 4 GB. */
export class ZipWriter {
  private readonly entries: Entry[] = []
  private offset = 0
  private isOpen = true

  private constructor(
    private readonly path: string,
    private readonly handle: fs.promises.FileHandle
  ) {}

  /** Create (or truncate) the file at `path`. */
  static async open(path: string): Promise<ZipWriter> {
    return new ZipWriter(path, await fs.promises.open(path, 'w'))
  }

  /** Append one stored entry. */
  async add(name: string, data: Buffer): Promise<void> {
    const nameBytes = Buffer.from(name, 'utf8')
    const header = Buffer.alloc(30)
    header.writeUInt32LE(0x04034b50, 0)
    header.writeUInt16LE(20, 4) // version needed
    header.writeUInt16LE(UTF8_NAME, 6)
    header.writeUInt16LE(0, 8) // method 0: store
    header.writeUInt16LE(DOS_TIME, 10)
    header.writeUInt16LE(DOS_DATE, 12)
    const crc = zlib.crc32(data)
    header.writeUInt32LE(crc, 14)
    header.writeUInt32LE(data.length, 18) // compressed size
    header.writeUInt32LE(data.length, 22) // uncompressed size
    header.writeUInt16LE(nameBytes.length, 26)
    header.writeUInt16LE(0, 28) // no extra field
    const entry: Entry = { name: nameBytes, crc, size: data.length, offset: this.offset }
    await this.write(header)
    await this.write(nameBytes)
    await this.write(data)
    this.entries.push(entry)
  }

  /** Write the central directory and end record, and close the file. */
  async close(): Promise<void> {
    const directoryStart = this.offset
    for (const e of this.entries) {
      const h = Buffer.alloc(46)
      h.writeUInt32LE(0x02014b50, 0)
      h.writeUInt16LE(20, 4) // version made by
      h.writeUInt16LE(20, 6) // version needed
      h.writeUInt16LE(UTF8_NAME, 8)
      h.writeUInt16LE(0, 10) // method 0: store
      h.writeUInt16LE(DOS_TIME, 12)
      h.writeUInt16LE(DOS_DATE, 14)
      h.writeUInt32LE(e.crc, 16)
      h.writeUInt32LE(e.size, 20)
      h.writeUInt32LE(e.size, 24)
      h.writeUInt16LE(e.name.length, 28)
      h.writeUInt32LE(e.offset, 42)
      await this.write(h)
      await this.write(e.name)
    }
    const directorySize = this.offset - directoryStart
    const end = Buffer.alloc(22)
    end.writeUInt32LE(0x06054b50, 0)
    end.writeUInt16LE(this.entries.length, 8)
    end.writeUInt16LE(this.entries.length, 10)
    end.writeUInt32LE(directorySize, 12)
    end.writeUInt32LE(directoryStart, 16)
    await this.write(end)
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

  private async write(buf: Buffer): Promise<void> {
    // The 16-bit entry count in the end record has no ZIP64 fallback either.
    if (this.offset + buf.length > LIMIT || this.entries.length >= 0xffff) throw new Error('CBZ is over 4 GB')
    let done = 0
    while (done < buf.length) {
      const { bytesWritten } = await this.handle.write(buf, done, buf.length - done, this.offset + done)
      done += bytesWritten
    }
    this.offset += buf.length
  }
}
