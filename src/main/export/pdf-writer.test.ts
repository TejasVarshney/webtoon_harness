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
    const text = (await write([readingPage({ cssHeight: 1280 }, JPEG, { w: 800, h: 1280 }), printPage('a4', { cssHeight: 1177 }, JPEG, { w: 800, h: 1177 })])).toString('latin1')
    expect(text.startsWith('%PDF-1.4\n')).toBe(true)
    expect(text.match(/\/Type \/Page\b/g)).toHaveLength(2)
    expect(text).toContain('/Count 2')
    expect(text).toContain('/MediaBox [0 0 600 960]')
    expect(text).toContain('/MediaBox [0 0 595.28 841.89]')
  })

  it('embeds the JPEG bytes verbatim as a DCTDecode XObject with Width/Height', async () => {
    const buf = await write([readingPage({ cssHeight: 1280 }, JPEG, { w: 800, h: 1280 })])
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
      readingPage({ cssHeight: 1280 }, JPEG, { w: 800, h: 1280 }),
      readingPage({ cssHeight: 400 }, JPEG, { w: 800, h: 400 })
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

  it('printPage fits 800 CSS px to the A4 printable width and top-aligns it', () => {
    const page = printPage('a4', { cssHeight: 1177 }, JPEG, { w: 800, h: 1177 })
    expect(page.page).toEqual({ width: 595.28, height: 841.89 })
    expect(page.draw.x).toBe(36)
    expect(page.draw.y).toBe(36)
    expect(page.draw.width).toBeCloseTo(523.28, 2)
    expect(page.draw.height).toBeCloseTo((1177 * 523.28) / 800, 2)
    const letter = printPage('letter', { cssHeight: 1067 }, JPEG, { w: 800, h: 1067 })
    expect(letter.page).toEqual({ width: 612, height: 792 })
    expect(letter.draw.width).toBe(540)
  })

  it('readingPage sizes a 1280 CSS px slice to 600x960 pt', () => {
    const page = readingPage({ cssHeight: 1280 }, JPEG, { w: 800, h: 1280 })
    expect(page.page).toEqual({ width: 600, height: 960 })
    expect(page.draw).toEqual({ x: 0, y: 0, width: 600, height: 960 })
    expect(page).toMatchObject({ pixelWidth: 800, pixelHeight: 1280 })
  })

  it('abort deletes the file', async () => {
    const file = path.join(dir, 'a.pdf')
    const pdf = await PdfWriter.open(file)
    await pdf.addPage(readingPage({ cssHeight: 1280 }, JPEG, { w: 800, h: 1280 }))
    await pdf.abort()
    await expect(fs.promises.stat(file)).rejects.toThrow()
    await expect(pdf.abort()).resolves.toBeUndefined()
  })
})
