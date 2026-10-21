import { join } from 'node:path'
import { app, BrowserWindow, dialog, ipcMain, shell, type IpcMainInvokeEvent } from 'electron'
import { EVENT_CHANNEL } from '@shared/ipc'
import { electronImageOps } from './domain/electron-image-ops'
import { electronEncryptor } from './models/electron-encryptor'
import { registerIpc } from './ipc/register'
import { handleAssetProtocol, registerAssetScheme } from './protocol/asset-protocol'
import { createServices } from './services'

// Privileged schemes can only be registered before the app is ready.
registerAssetScheme()

const userDataOverride = process.env.WEBTOON_USER_DATA
if (userDataOverride) app.setPath('userData', userDataOverride)

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    title: 'Webtoon AI Harness',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  // The window holds the privileged `window.api` bridge, so it must never leave the app's own page.
  win.webContents.on('will-navigate', (e) => e.preventDefault())
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })

  const devServerUrl = process.env['ELECTRON_RENDERER_URL']
  if (!app.isPackaged && devServerUrl) {
    void win.loadURL(devServerUrl)
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

void app.whenReady().then(async () => {
  const projectsRoot = process.env.WEBTOON_PROJECTS_ROOT || join(app.getPath('documents'), 'Webtoon AI Harness', 'projects')
  let services: Awaited<ReturnType<typeof createServices>>
  try {
    services = await createServices({
      projectsRoot,
      userDataDir: app.getPath('userData'),
      trash: (absPath) => shell.trashItem(absPath),
      encryptor: electronEncryptor,
      templatesDir: join(app.getAppPath(), 'resources', 'agent-docs'),
      imageOps: electronImageOps
    })
  } catch (error) {
    // A hand-edited, corrupt models.json / secrets.json is left untouched; tell the user rather than start half-wired.
    console.error('Failed to start services', error)
    dialog.showErrorBox('Webtoon AI Harness cannot start', error instanceof Error ? error.message : String(error))
    app.quit()
    return
  }
  registerIpc(ipcMain, services, {
    pickImageFiles: async (event) => {
      const win = BrowserWindow.fromWebContents((event as IpcMainInvokeEvent).sender) ?? BrowserWindow.getFocusedWindow()
      const options = {
        title: 'Attach images',
        properties: ['openFile', 'multiSelections'] as Array<'openFile' | 'multiSelections'>,
        filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp'] }]
      }
      const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
      return result.canceled ? [] : result.filePaths
    }
  })
  const { agent } = services
  // Quitting mid-run: abort so every loop persists results for its pending tool calls.
  app.on('before-quit', () => agent.cancelAll())
  handleAssetProtocol(services.projects)
  services.bus.subscribe((event) => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send(EVENT_CHANNEL, event)
    }
  })

  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
