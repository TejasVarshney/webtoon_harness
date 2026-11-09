import { BrowserWindow } from 'electron'
import type { PackComposer, PackPlan } from './reference-pack'

/** How long one pack may take to draw. Past it the draw is given up, and the panel drops references instead. */
const DRAW_TIMEOUT_MS = 30_000

/**
 * What the drawing window runs: it decodes the sheets, fills the canvas with the background, fits each sheet into its
 * cell (centered, never cropped), writes each name centered in its band in bold (shrunk to fit a long name), and
 * resolves to the PNG as base64. The input goes in as a JSON string literal that `JSON.parse` reads, so no name is
 * ever read as code.
 */
function packScript(plan: PackPlan, sources: string[]): string {
  const input = JSON.stringify(JSON.stringify({ plan, sources }))
  return `(async ({ plan, sources }) => {
  const layout = plan.layout
  const images = await Promise.all(sources.map((src) => { const img = new Image(); img.src = src; return img.decode().then(() => img) }))
  const canvas = document.createElement('canvas')
  canvas.width = plan.width
  canvas.height = plan.height
  const g = canvas.getContext('2d')
  g.fillStyle = layout.background
  g.fillRect(0, 0, plan.width, plan.height)
  g.imageSmoothingEnabled = true
  g.imageSmoothingQuality = 'high'
  const font = (px) => 'bold ' + px + 'px ' + layout.fontFamily
  plan.cells.forEach((cell, i) => {
    const img = images[i]
    const scale = Math.min(cell.sheet.width / img.naturalWidth, cell.sheet.height / img.naturalHeight)
    const w = img.naturalWidth * scale
    const h = img.naturalHeight * scale
    g.drawImage(img, cell.sheet.x + (cell.sheet.width - w) / 2, cell.sheet.y + (cell.sheet.height - h) / 2, w, h)
    g.font = font(plan.fontPx)
    const room = cell.band.width * 0.94
    const wide = g.measureText(cell.name).width
    if (wide > room) g.font = font(Math.max(1, Math.floor((plan.fontPx * room) / wide)))
    g.fillStyle = layout.ink
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    g.fillText(cell.name, cell.band.x + cell.band.width / 2, cell.band.y + cell.band.height / 2)
  })
  return canvas.toDataURL('image/png').split(',')[1]
})(JSON.parse(${input}))`
}

function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Drawing the packed reference image took longer than ${ms / 1000} s`)), ms)
  })
  work.catch(() => undefined)
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer))
}

/**
 * `PackComposer` on a canvas in a hidden offscreen window, one per pack, closed once it is drawn. A canvas is used
 * rather than `nativeImage` because `nativeImage` can neither draw text nor decode WebP. The window has no preload and
 * loads nothing but a blank page; the sheets go in as data URLs.
 */
export const electronPackComposer: PackComposer = {
  async compose(plan, sheets) {
    const win = new BrowserWindow({
      show: false,
      width: 64,
      height: 64,
      webPreferences: { offscreen: true, sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false }
    })
    const wc = win.webContents
    wc.on('will-navigate', (e) => e.preventDefault())
    wc.setWindowOpenHandler(() => ({ action: 'deny' }))
    try {
      await wc.loadURL('about:blank')
      const sources = sheets.map((s) => `data:${s.mime};base64,${s.data.toString('base64')}`)
      const base64: unknown = await withTimeout(wc.executeJavaScript(packScript(plan, sources)), DRAW_TIMEOUT_MS)
      const png = typeof base64 === 'string' ? Buffer.from(base64, 'base64') : Buffer.alloc(0)
      if (png.length === 0) throw new Error('The packed reference image came out empty')
      return png
    } finally {
      win.destroy()
    }
  }
}
