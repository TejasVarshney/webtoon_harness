// Test helper: reads a ZIP the way a reader would, through the central directory. Store and deflate only.

import zlib from 'node:zlib'

export interface ZipEntry {
  name: string
  data: Buffer
  /** The CRC-32 recorded in the central directory. */
  crc: number
  /** The general purpose bit flags (bit 11 = UTF-8 name). */
  flags: number
}

/** Parse a whole ZIP held in memory, returning its entries in central-directory order. */
export function readZip(buf: Buffer): ZipEntry[] {
  let eocd = -1
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i
      break
    }
  }
  if (eocd < 0) throw new Error('No end of central directory record')
  const count = buf.readUInt16LE(eocd + 10)
  let pos = buf.readUInt32LE(eocd + 16)
  const entries: ZipEntry[] = []
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(pos) !== 0x02014b50) throw new Error('Bad central directory entry')
    const flags = buf.readUInt16LE(pos + 8)
    const method = buf.readUInt16LE(pos + 10)
    const crc = buf.readUInt32LE(pos + 16)
    const compressedSize = buf.readUInt32LE(pos + 20)
    const nameLength = buf.readUInt16LE(pos + 28)
    const extraLength = buf.readUInt16LE(pos + 30)
    const commentLength = buf.readUInt16LE(pos + 32)
    const localOffset = buf.readUInt32LE(pos + 42)
    const name = buf.toString('utf8', pos + 46, pos + 46 + nameLength)
    if (buf.readUInt32LE(localOffset) !== 0x04034b50) throw new Error(`Bad local header for ${name}`)
    const dataStart = localOffset + 30 + buf.readUInt16LE(localOffset + 26) + buf.readUInt16LE(localOffset + 28)
    const stored = buf.subarray(dataStart, dataStart + compressedSize)
    const data = method === 8 ? zlib.inflateRawSync(stored) : Buffer.from(stored)
    entries.push({ name, data, crc, flags })
    pos += 46 + nameLength + extraLength + commentLength
  }
  return entries
}
