import { join } from 'node:path'
import { app, BrowserWindow, ipcMain, shell } from 'electron'
import { EVENT_CHANNEL } from '@shared/ipc'
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

  const devServerUrl = process.env['ELECTRON_RENDERER_URL']
  if (!app.isPackaged && devServerUrl) {
    void win.loadURL(devServerUrl)
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

void app.whenReady().then(async () => {
  const projectsRoot = process.env.WEBTOON_PROJECTS_ROOT || join(app.getPath('documents'), 'Webtoon AI Harness', 'projects')
  const services = await createServices({
    projectsRoot,
    userDataDir: app.getPath('userData'),
    trash: (absPath) => shell.trashItem(absPath)
  })
  registerIpc(ipcMain, services)
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
