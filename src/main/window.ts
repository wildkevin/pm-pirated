import { BrowserWindow, ipcMain, type BrowserWindowConstructorOptions } from 'electron'
import { BEFORE_CLOSE, CLOSE_READY } from '../shared/ipc'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

export interface RendererLocation {
  devUrl?: string
  file: string
}

export function rendererLocation(): RendererLocation {
  return { devUrl: process.env.ELECTRON_RENDERER_URL, file: join(__dirname, '../renderer/index.html') }
}

/** True only for our own renderer page (dev server origin, or the bundled index.html). */
export function isTrustedUrl(url: string, loc: RendererLocation): boolean {
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return false
  }
  if (loc.devUrl) return u.origin === new URL(loc.devUrl).origin
  u.hash = ''
  u.search = ''
  return u.href.toLowerCase() === pathToFileURL(loc.file).href.toLowerCase()
}

export function mainWindowOptions(preload: string): BrowserWindowConstructorOptions {
  return {
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 560,
    title: 'PM Local',
    backgroundColor: '#FFFFFF',
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      webviewTag: false,
      spellcheck: false,
    },
  }
}

export function createMainWindow(): BrowserWindow {
  const win = new BrowserWindow(mainWindowOptions(join(__dirname, '../preload/index.js')))
  const loc = rendererLocation()
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.on('will-navigate', (e, url) => {
    if (!isTrustedUrl(url, loc)) e.preventDefault()
  })
  win.once('ready-to-show', () => win.show())
  // Let the renderer save open tabs (unsaved edits included) before the window goes away.
  let closing = false
  const reallyClose = () => {
    closing = true
    if (!win.isDestroyed()) win.close()
  }
  win.on('close', (e) => {
    if (closing) return
    e.preventDefault()
    ipcMain.once(CLOSE_READY, (ev) => ev.sender === win.webContents && reallyClose())
    setTimeout(reallyClose, 1000)
    win.webContents.send(BEFORE_CLOSE)
  })
  if (loc.devUrl) void win.loadURL(loc.devUrl)
  else void win.loadFile(loc.file)
  return win
}
