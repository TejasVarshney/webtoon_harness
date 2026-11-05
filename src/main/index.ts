import { join } from 'node:path'
import { app, BrowserWindow, dialog, ipcMain, shell, type IpcMainInvokeEvent } from 'electron'
import { EVENT_CHANNEL } from '@shared/ipc'
import { electronImageOps } from './domain/electron-image-ops'
import { electronCodec } from './export/electron-codec'
import { createOffscreenCapturer } from './export/offscreen-capturer'
import type { ChooseExportTarget } from './ipc/handlers/export'
import { electronEncryptor } from './models/electron-encryptor'
import { registerIpc } from './ipc/register'
import { handleAssetProtocol, registerAssetScheme } from './protocol/asset-protocol'
import { createQuitGate } from './quit-gate'
import { createServices } from './services'

// Privileged schemes can only be registered before the app is ready.
registerAssetScheme()

const userDataOverride = process.env.WEBTOON_USER_DATA
if (userDataOverride) app.setPath('userData', userDataOverride)

// One app per user-data folder (the lock is keyed on it, so the path is set first): a second launch would run a
// second set of services over the same files. It quits, and the window that is already open comes forward.
const primary = app.requestSingleInstanceLock()
if (!primary) app.quit()
/** The app's own windows, without an export job's offscreen window. */
function appWindows(): BrowserWindow[] {
  return BrowserWindow.getAllWindows().filter((w) => !w.isDestroyed() && !w.webContents.isOffscreen())
}

app.on('second-instance', () => {
  const win = appWindows()[0]
  if (!win) return
  if (win.isMinimized()) win.restore()
  win.focus()
})

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    // Below this the sidebar, the chat and the strip no longer fit side by side.
    minWidth: 960,
    minHeight: 600,
    title: 'Webtoon AI Harness',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  // An export's hidden window keeps `window-all-closed` from firing, so closing the last visible window quits here
  // (the quit gate then cancels the export) rather than leaving the app running with no window.
  win.on('closed', () => {
    if (process.platform !== 'darwin' && appWindows().length === 0) app.quit()
  })

  // The window holds the privileged `window.api` bridge, so it must never leave the app's own page.
  win.webContents.on('will-navigate', (e) => e.preventDefault())
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })

  const devServerUrl = rendererUrl()
  if (devServerUrl) {
    void win.loadURL(devServerUrl)
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

/** The renderer dev server in development, or null to load the built pages. */
function rendererUrl(): string | null {
  const devServerUrl = process.env['ELECTRON_RENDERER_URL']
  return !app.isPackaged && devServerUrl ? devServerUrl : null
}

/**
 * The export save dialog over the window that asked: a folder for several outputs (`openDirectory`, which may
 * create one), a file otherwise. Resolves to the chosen absolute path, or null when dismissed.
 */
const chooseExportTarget: ChooseExportTarget = async (event, { kind, defaultPath, extension }) => {
  const win = BrowserWindow.fromWebContents((event as IpcMainInvokeEvent).sender) ?? BrowserWindow.getFocusedWindow()
  if (kind === 'folder') {
    const options = { title: 'Export to folder', defaultPath, properties: ['openDirectory', 'createDirectory'] as Array<'openDirectory' | 'createDirectory'> }
    const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
    return result.canceled || result.filePaths.length === 0 ? null : result.filePaths[0]
  }
  const options = {
    title: 'Export',
    defaultPath,
    filters: extension ? [{ name: extension.toUpperCase(), extensions: [extension] }] : []
  }
  const result = win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options)
  return result.canceled || !result.filePath ? null : result.filePath
}

if (primary) void app.whenReady().then(async () => {
  const projectsRoot = process.env.WEBTOON_PROJECTS_ROOT || join(app.getPath('documents'), 'Webtoon AI Harness', 'projects')
  let services: Awaited<ReturnType<typeof createServices>>
  try {
    services = await createServices({
      projectsRoot,
      userDataDir: app.getPath('userData'),
      trash: (absPath) => shell.trashItem(absPath),
      encryptor: electronEncryptor,
      templatesDir: join(app.getAppPath(), 'resources', 'agent-docs'),
      imageOps: electronImageOps,
      createCapturer: () => createOffscreenCapturer({ rendererUrl: rendererUrl(), rendererDir: join(__dirname, '../renderer') }),
      codec: electronCodec
    })
  } catch (error) {
    // A hand-edited, corrupt models.json / secrets.json is left untouched; tell the user rather than start half-wired.
    console.error('Failed to start services', error)
    dialog.showErrorBox('Webtoon AI Harness cannot start', error instanceof Error ? error.message : String(error))
    app.quit()
    return
  }
  registerIpc(ipcMain, services, {
    pickImageFiles: async (event, opts) => {
      const win = BrowserWindow.fromWebContents((event as IpcMainInvokeEvent).sender) ?? BrowserWindow.getFocusedWindow()
      const options = {
        title: opts?.title ?? (opts?.multiple === false ? 'Choose an image' : 'Attach images'),
        properties: (opts?.multiple === false ? ['openFile'] : ['openFile', 'multiSelections']) as Array<'openFile' | 'multiSelections'>,
        filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp'] }]
      }
      const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
      return result.canceled ? [] : result.filePaths
    },
    openPath: (absPath) => shell.openPath(absPath),
    chooseExportTarget,
    showItemInFolder: (absPath) => shell.showItemInFolder(absPath)
  })
  void services.plugins.startEnabled()
  const { agent, panelChat, plugins } = services
  // Quitting mid-run: abort so every loop persists results for its pending tool calls, then stop the plugins.
  app.on(
    'before-quit',
    createQuitGate({
      cancelRuns: () => {
        agent.cancelAll()
        panelChat.cancelAll()
      },
      stopPlugins: () => Promise.all([plugins.stopAll(), services.exports.shutdown()]).then(() => undefined),
      quit: () => app.quit()
    })
  )
  handleAssetProtocol(services.projects)
  services.bus.subscribe((event) => {
    for (const win of appWindows()) win.webContents.send(EVENT_CHANNEL, event)
  })

  createWindow()
  app.on('activate', () => {
    if (appWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
