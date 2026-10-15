import { BrowserWindow, type BrowserWindowConstructorOptions } from 'electron'
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
  if (loc.devUrl) void win.loadURL(loc.devUrl)
  else void win.loadFile(loc.file)
  return win
}
