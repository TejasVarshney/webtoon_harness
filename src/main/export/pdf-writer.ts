// A small PDF writer for exports: one JPEG per page, nothing else (no text, fonts or compression).
// Streams to a file handle, so a long episode is never held in memory twice.

import { FileSink } from './file-sink'

/** One page: a JPEG and where it sits. All sizes are in pt, with `y` measured from the page top. */
export type PdfPage = {
  jpeg: Buffer
  pixelWidth: number
  pixelHeight: number
  page: { width: number; height: number }
  draw: { x: number; y: number; width: number; height: number }
}

const PAPER = { a4: { width: 595.28, height: 841.89 }, letter: { width: 612, height: 792 } } as const
const MARGIN = 36
/** A reading page's width: 0.75 pt per output px at scale 1, so 800 px become 600 pt. */
const READING_WIDTH = 600

/**
 * A reading page: 600 pt wide, as tall as the image at that width, with the image filling it. Sized from the image's
 * own pixels, so a 1280 px slice (2560 at High) is a 600×960 pt page.
 */
export function readingPage(jpeg: Buffer, px: { w: number; h: number }): PdfPage {
  const height = (px.h * READING_WIDTH) / px.w
  return {
    jpeg,
    pixelWidth: px.w,
    pixelHeight: px.h,
    page: { width: READING_WIDTH, height },
    draw: { x: 0, y: 0, width: READING_WIDTH, height }
  }
}

/** A print page: A4 or Letter with 36 pt margins, the image at the printable width (its height to scale) and top-aligned. */
export function printPage(paper: 'a4' | 'letter', jpeg: Buffer, px: { w: number; h: number }): PdfPage {
  const size = PAPER[paper]
  const width = size.width - 2 * MARGIN
  return {
    jpeg,
    pixelWidth: px.w,
    pixelHeight: px.h,
    page: { width: size.width, height: size.height },
    draw: { x: MARGIN, y: MARGIN, width, height: (px.h * width) / px.w }
  }
}

/** A number as PDF text: at most 2 decimals, no trailing zeros. */
function num(n: number): string {
  return String(Math.round(n * 100) / 100)
}

/** Writes PDF 1.4 objects as pages arrive; the page tree and cross-reference table go out on `close()`. */
export class PdfWriter {
  /** Byte offset of each object, by object number (index 0 is the free entry). */
  private readonly offsets: number[] = [0]
  private readonly pageIds: number[] = []

  private constructor(private readonly sink: FileSink) {}

  /** Create (or truncate) the file at `path` and write the header and catalog. */
  static async open(path: string): Promise<PdfWriter> {
    let writer!: PdfWriter
    await FileSink.openWith(path, async (sink) => {
      writer = new PdfWriter(sink)
      // The binary comment tells tools the file holds binary data.
      await sink.write(Buffer.from('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n', 'latin1'))
      await writer.object(1, '<< /Type /Catalog /Pages 2 0 R >>')
    })
    return writer
  }

  /** Append a page: its Page, Contents and Image objects, three per page, numbered from 3. */
  async addPage(p: PdfPage): Promise<void> {
    const first = 3 + this.pageIds.length * 3
    const { page, draw } = p
    const matrix = `${num(draw.width)} 0 0 ${num(draw.height)} ${num(draw.x)} ${num(page.height - draw.y - draw.height)} cm`
    const content = `q ${matrix} /Im Do Q`
    await this.object(
      first,
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${num(page.width)} ${num(page.height)}] ` +
        `/Resources << /XObject << /Im ${first + 2} 0 R >> >> /Contents ${first + 1} 0 R >>`
    )
    await this.stream(first + 1, '', Buffer.from(content, 'latin1'))
    await this.stream(
      first + 2,
      `/Type /XObject /Subtype /Image /Width ${p.pixelWidth} /Height ${p.pixelHeight} ` +
        '/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode ',
      p.jpeg
    )
    this.pageIds.push(first)
  }

  /** Write the page tree (object 2, reserved up front because Kids and Count are only known now), the xref and the trailer. */
  async close(): Promise<void> {
    const kids = this.pageIds.map((id) => `${id} 0 R`).join(' ')
    await this.object(2, `<< /Type /Pages /Kids [${kids}] /Count ${this.pageIds.length} >>`)
    const xrefAt = this.sink.offset
    const size = this.offsets.length
    let table = `xref\n0 ${size}\n0000000000 65535 f \n`
    for (let n = 1; n < size; n++) table += `${String(this.offsets[n]).padStart(10, '0')} 00000 n \n`
    table += `trailer\n<< /Size ${size} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`
    await this.write(Buffer.from(table, 'latin1'))
    await this.sink.close()
  }

  /** Close the handle and delete the file. Safe after a failed write, and safe to call twice. */
  async abort(): Promise<void> {
    await this.sink.abort()
  }

  private async object(id: number, body: string): Promise<void> {
    this.offsets[id] = this.sink.offset
    await this.write(Buffer.from(`${id} 0 obj\n${body}\nendobj\n`, 'latin1'))
  }

  private async stream(id: number, dict: string, data: Buffer): Promise<void> {
    this.offsets[id] = this.sink.offset
    await this.write(Buffer.from(`${id} 0 obj\n<< ${dict}/Length ${data.length} >>\nstream\n`, 'latin1'))
    await this.write(data)
    await this.write(Buffer.from('\nendstream\nendobj\n', 'latin1'))
  }

  private write(buf: Buffer): Promise<void> {
    return this.sink.write(buf)
  }
}
