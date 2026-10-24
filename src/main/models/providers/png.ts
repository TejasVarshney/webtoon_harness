import { crc32, deflateSync } from 'node:zlib'

function chunk(type: string, data: Buffer): Buffer {
  const typeAndData = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const out = Buffer.alloc(typeAndData.length + 8)
  out.writeUInt32BE(data.length, 0)
  typeAndData.copy(out, 4)
  out.writeUInt32BE(crc32(typeAndData), out.length - 4)
  return out
}

/** A valid 8-bit RGB PNG filled with one color. */
export function encodeSolidPng(width: number, height: number, rgb: [number, number, number]): Buffer {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 2 // color type: truecolor
  const stride = 1 + width * 3
  const raw = Buffer.alloc(stride * height)
  for (let y = 0; y < height; y++) {
    const row = y * stride // filter byte stays 0
    for (let x = 0; x < width; x++) {
      raw[row + 1 + x * 3] = rgb[0]
      raw[row + 2 + x * 3] = rgb[1]
      raw[row + 3 + x * 3] = rgb[2]
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0))
  ])
}
