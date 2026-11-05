import { join } from 'node:path'
import { BrowserWindow } from 'electron'
import type { ExportSnapshot, ViewLayout } from '@shared/types'
import type { Slice } from './slice-plan'
import { snapshotScript } from './snapshot-script'
import type { StripCapturer } from './types'

/** The export view's width in CSS px, and the window's starting height. */
const WIDTH = 800
const HEIGHT = 1280
const JPEG_QUALITY = 90
/** A capture is one scroll and one screenshot; this long means the window has stopped painting. */
const CAPTURE_TIMEOUT_MS = 30000
const CANCELLED = 'Export cancelled'
const CRASHED = 'The export window stopped unexpectedly'

export interface OffscreenCapturerOptions {
  /** The renderer dev server (`ELECTRON_RENDERER_URL`), or null to load the built page from `rendererDir`. */
  rendererUrl: string | null
  /** The folder holding the built `export.html`. */
  rendererDir: string
}

/**
 * The `StripCapturer` of spec §3: an offscreen window with no preload, driven over the DevTools protocol. Each slice
 * sets the viewport to the slice's height at the export scale, scrolls to its top, waits two frames and takes a
 * screenshot. `close()` (or a crash) rejects whatever call is in flight at once.
 */
export function createOffscreenCapturer(opts: OffscreenCapturerOptions): StripCapturer {
  let win: BrowserWindow | null = null
  let closed = false
  /** Set once the window's renderer is gone; every later call fails with it. */
  let failure: Error | null = null
  /** The reject of every call in flight. */
  const aborts = new Set<(error: Error) => void>()

  const abortAll = (error: Error): void => {
    for (const abort of [...aborts]) abort(error)
  }

  /**
   * `work`, unless the capturer is closed, the window crashes or `timeout` passes first. The work goes on after
   * losing (it then fails on the destroyed window), so its outcome is swallowed rather than left unhandled.
   */
  function guarded<T>(work: () => Promise<T>, timeout?: { ms: number; message: string }): Promise<T> {
    if (closed) return Promise.reject(new Error(CANCELLED))
    if (failure) return Promise.reject(failure)
    return new Promise<T>((resolve, reject) => {
      let timer: NodeJS.Timeout | undefined
      const settle = (): void => {
        aborts.delete(abort)
        clearTimeout(timer)
      }
      const abort = (error: Error): void => {
        settle()
        reject(error)
      }
      aborts.add(abort)
      if (timeout) timer = setTimeout(() => abort(new Error(timeout.message)), timeout.ms)
      const running = work()
      running.catch(() => undefined)
      running.then(
        (value) => {
          settle()
          resolve(value)
        },
        (error: unknown) => {
          settle()
          reject(error instanceof Error ? error : new Error(String(error)))
        }
      )
    })
  }

  function openWindow(): BrowserWindow {
    if (!win || win.isDestroyed()) throw new Error('The export window is not open')
    return win
  }

  return {
    // No awaits: a cancel cannot land halfway through and leave a window behind.
    async open() {
      if (closed) throw new Error(CANCELLED)
      if (win) return
      win = new BrowserWindow({
        show: false,
        width: WIDTH,
        height: HEIGHT,
        webPreferences: {
          offscreen: true,
          sandbox: true,
          contextIsolation: true,
          nodeIntegration: false,
          backgroundThrottling: false
        }
      })
      const wc = win.webContents
      // As the main window: the page never navigates away, and opens nothing (it has nothing to click).
      wc.on('will-navigate', (e) => e.preventDefault())
      wc.setWindowOpenHandler(() => ({ action: 'deny' }))
      wc.on('render-process-gone', () => {
        failure = new Error(CRASHED)
        abortAll(failure)
      })
      wc.setFrameRate(60)
      wc.debugger.attach('1.3')
    },

    render(snapshot, timeoutMs) {
      const number = snapshot.episode.number
      return guarded(
        async () => {
          const w = openWindow()
          const wc = w.webContents
          try {
            if (opts.rendererUrl) await wc.loadURL(`${opts.rendererUrl}/export.html`)
            else await wc.loadFile(join(opts.rendererDir, 'export.html'))
          } catch (error) {
            throw new Error(`The export page could not be loaded: ${messageOf(error)}`)
          }
          // Overrides outlive a page load: start every episode from the full-height viewport at scale 1.
          await wc.debugger.sendCommand('Emulation.setScrollbarsHidden', { hidden: true })
          await wc.debugger.sendCommand('Emulation.setDeviceMetricsOverride', { width: WIDTH, height: HEIGHT, deviceScaleFactor: 1, mobile: false })
          // The page's rejection comes back as data, so its message reaches the user as written.
          const result = (await wc.executeJavaScript(
            `Promise.resolve().then(() => ${snapshotScript(snapshot)}).then((layout) => ({ layout }), (e) => ({ error: String((e && e.message) || e) }))`
          )) as { layout?: ViewLayout; error?: string }
          if (result.error !== undefined) throw new Error(episodeMessage(number, result.error))
          if (!isLayout(result.layout)) throw new Error(`Episode ${number}: the export view returned no layout`)
          return result.layout
        },
        { ms: timeoutMs, message: `Episode ${number} took longer than ${Math.round(timeoutMs / 1000)} s to draw` }
      )
    },

    capture(slice: Slice, scale, format) {
      return guarded(
        async () => {
          const wc = openWindow().webContents
          await wc.debugger.sendCommand('Emulation.setDeviceMetricsOverride', { width: WIDTH, height: slice.height, deviceScaleFactor: scale, mobile: false })
          const scrolled = (await wc.executeJavaScript(
            `scrollTo(0, ${slice.top}); new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(scrollY))))`
          )) as number
          // A scroll the page clamped would repeat an earlier part of the strip in this slice.
          if (scrolled !== slice.top) throw new Error(`The export view could not scroll to ${slice.top} px (it stopped at ${scrolled} px)`)
          const shot = (await wc.debugger.sendCommand('Page.captureScreenshot', format === 'jpeg' ? { format, quality: JPEG_QUALITY } : { format })) as {
            data: string
          }
          return Buffer.from(shot.data, 'base64')
        },
        { ms: CAPTURE_TIMEOUT_MS, message: 'The export window stopped drawing' }
      )
    },

    async close() {
      if (closed) return
      closed = true
      abortAll(new Error(CANCELLED))
      const w = win
      win = null
      if (!w || w.isDestroyed()) return
      try {
        if (w.webContents.debugger.isAttached()) w.webContents.debugger.detach()
      } catch (error) {
        console.warn('Export: detaching the debugger failed', error)
      }
      w.destroy()
    }
  }
}

/** The view names a failed image as `Panel 4: ...`; the user is told `Episode 2, panel 4: ...`. */
function episodeMessage(number: number, error: string): string {
  const panel = /^Panel (\d+): (.*)$/s.exec(error)
  return panel ? `Episode ${number}, panel ${panel[1]}: ${panel[2]}` : `Episode ${number}: ${error}`
}

function isLayout(v: unknown): v is ViewLayout {
  const l = v as ViewLayout | undefined
  return typeof l?.totalHeight === 'number' && Array.isArray(l.rows)
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
