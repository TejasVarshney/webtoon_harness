import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { PdfWriter, printPage, readingPage } from './pdf-writer'

let dir: string
beforeEach(async () => {
  dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'pdf writer '))
})
afterEach(async () => {
  await fs.promises.rm(dir, { recursive: true, force: true })
})

// The writer embeds the bytes without decoding them, so a JPEG-shaped blob with non-text bytes is enough.
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x80, 0x81, 0xff, 0xd9])

async function write(pages: ReturnType<typeof readingPage>[]): Promise<Buffer> {
  const file = path.join(dir, 'a.pdf')
  const pdf = await PdfWriter.open(file)
  for (const p of pages) await pdf.addPage(p)
  await pdf.close()
  return fs.promises.readFile(file)
}

describe('PdfWriter', () => {
  it('writes one page per addPage with its MediaBox', async () => {
    const text = (await write([readingPage(JPEG, { w: 800, h: 1280 }), printPage('a4', JPEG, { w: 1600, h: 2354 })])).toString('latin1')
    expect(text.startsWith('%PDF-1.4\n')).toBe(true)
    expect(text.match(/\/Type \/Page\b/g)).toHaveLength(2)
    expect(text).toContain('/Count 2')
    expect(text).toContain('/MediaBox [0 0 600 960]')
    expect(text).toContain('/MediaBox [0 0 595.28 841.89]')
  })

  it('embeds the JPEG bytes verbatim as a DCTDecode XObject with Width/Height', async () => {
    const buf = await write([readingPage(JPEG, { w: 800, h: 1280 })])
    expect(buf.indexOf(JPEG)).toBeGreaterThan(0)
    const text = buf.toString('latin1')
    expect(text).toContain('/Subtype /Image')
    expect(text).toContain('/Width 800')
    expect(text).toContain('/Height 1280')
    expect(text).toContain('/ColorSpace /DeviceRGB')
    expect(text).toContain('/BitsPerComponent 8')
    expect(text).toContain('/Filter /DCTDecode')
    expect(text).toContain(`/Length ${JPEG.length}`)
  })

  it('points every xref entry at its "n 0 obj"', async () => {
    const buf = await write([
      readingPage(JPEG, { w: 800, h: 1280 }),
      readingPage(JPEG, { w: 800, h: 400 })
    ])
    const text = buf.toString('latin1')
    const startxref = Number(/startxref\n(\d+)\n%%EOF\n$/.exec(text)?.[1])
    expect(text.slice(startxref, startxref + 4)).toBe('xref')
    const [first, count] = /^xref\n(\d+) (\d+)\n/.exec(text.slice(startxref))!.slice(1).map(Number)
    expect(first).toBe(0)
    expect(count).toBe(1 + 2 + 2 * 3) // free entry, catalog + pages, three objects per page
    const table = startxref + text.slice(startxref).indexOf('\n', 5) + 1
    for (let n = 1; n < count; n++) {
      const entry = text.slice(table + n * 20, table + n * 20 + 20)
      expect(entry).toMatch(/^\d{10} 00000 n \n$/)
      const offset = Number(entry.slice(0, 10))
      expect(text.slice(offset).startsWith(`${n} 0 obj\n`)).toBe(true)
    }
  })

  it('printPage fits the image to the A4 or Letter printable width and top-aligns it', () => {
    const page = printPage('a4', JPEG, { w: 1600, h: 2353 })
    expect(page.page).toEqual({ width: 595.28, height: 841.89 })
    expect(page.draw.x).toBe(36)
    expect(page.draw.y).toBe(36)
    expect(page.draw.width).toBeCloseTo(523.28, 2)
    // Sized from the image, not from CSS: a 647 CSS px A4 slice is 2353 px at scale 2, within the 769.89 pt printable height.
    expect(page.draw.height).toBeCloseTo((2353 * 523.28) / 1600, 2)
    expect(page.draw.height).toBeLessThanOrEqual(841.89 - 72)
    expect(page).toMatchObject({ pixelWidth: 1600, pixelHeight: 2353 })
    const letter = printPage('letter', JPEG, { w: 1600, h: 2131 })
    expect(letter.page).toEqual({ width: 612, height: 792 })
    expect(letter.draw.width).toBe(540)
    expect(letter.draw.height).toBeLessThanOrEqual(792 - 72)
  })

  it('readingPage sizes a 1280 px slice to 600x960 pt at either scale', () => {
    const page = readingPage(JPEG, { w: 800, h: 1280 })
    expect(page.page).toEqual({ width: 600, height: 960 })
    expect(page.draw).toEqual({ x: 0, y: 0, width: 600, height: 960 })
    expect(page).toMatchObject({ pixelWidth: 800, pixelHeight: 1280 })
    const high = readingPage(JPEG, { w: 1600, h: 2560 })
    expect(high.page).toEqual({ width: 600, height: 960 })
    expect(high).toMatchObject({ pixelWidth: 1600, pixelHeight: 2560 })
    // A short last slice: 0.75 pt per px at scale 1.
    expect(readingPage(JPEG, { w: 800, h: 520 }).page).toEqual({ width: 600, height: 390 })
  })

  it('abort deletes the file', async () => {
    const file = path.join(dir, 'a.pdf')
    const pdf = await PdfWriter.open(file)
    await pdf.addPage(readingPage(JPEG, { w: 800, h: 1280 }))
    await pdf.abort()
    await expect(fs.promises.stat(file)).rejects.toThrow()
    await expect(pdf.abort()).resolves.toBeUndefined()
  })
})
