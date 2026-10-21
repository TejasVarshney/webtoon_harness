import { join } from 'node:path'
import { app, BrowserWindow } from 'electron'

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

void app.whenReady().then(() => {
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
