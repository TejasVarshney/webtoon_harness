import { inflateSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { encodeSolidPng } from './png'

describe('encodeSolidPng', () => {
  it('encodes a decodable PNG', () => {
    const png = encodeSolidPng(4, 6, [255, 0, 0])
    expect(png.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    expect(png.readUInt32BE(16)).toBe(4)
    expect(png.readUInt32BE(20)).toBe(6)
  })

  it('stores the fill color in the pixel data', () => {
    const png = encodeSolidPng(2, 2, [10, 20, 30])
    const idatLen = png.readUInt32BE(33)
    const raw = inflateSync(png.subarray(41, 41 + idatLen))
    expect([...raw.subarray(0, 7)]).toEqual([0, 10, 20, 30, 10, 20, 30])
    expect(png.subarray(png.length - 8, png.length - 4).toString('ascii')).toBe('IEND')
  })
})
