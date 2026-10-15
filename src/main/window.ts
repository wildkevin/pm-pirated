import { BrowserWindow, ipcMain, type BrowserWindowConstructorOptions, type MenuItemConstructorOptions } from 'electron'
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

/** Clipboard writes are the sole renderer permission, and only for our own page. */
export function allowRendererPermission(permission: string, pageUrl: string, requestingUrl: string | undefined, loc: RendererLocation): boolean {
  return permission === 'clipboard-sanitized-write' && isTrustedUrl(pageUrl, loc) && (!requestingUrl || isTrustedUrl(requestingUrl, loc))
}

/** Leave close-tab accelerators to the renderer; production menus cannot reload away drafts. */
export function applicationMenuTemplate(platform = process.platform, development = false): MenuItemConstructorOptions[] {
  return [
    ...(platform === 'darwin' ? [{ label: 'PM Local', submenu: [{ role: 'about' }, { type: 'separator' }, { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' }, { type: 'separator' }, { role: 'quit' }] } as MenuItemConstructorOptions] : [{ label: 'File', submenu: [{ role: 'quit' }] } as MenuItemConstructorOptions]),
    { label: 'Edit', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
    { label: 'View', submenu: [{ role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { type: 'separator' }, { role: 'togglefullscreen' }, ...(development ? [{ type: 'separator' }, { role: 'reload' }, { role: 'toggleDevTools' }] as MenuItemConstructorOptions[] : [])] },
    { label: 'Window', submenu: [{ role: 'minimize' }, { role: 'zoom' }] },
  ]
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

/** Zoom steps match Chromium's (level 1 ≈ 120%); clamped to 50%–300%. */
export const ZOOM_MIN = -3.8
export const ZOOM_MAX = 6
export function nextZoom(level: number, key: string): number | null {
  if (key === '0' || key === 'Numpad0') return 0
  if (key === '=' || key === '+' || key === 'NumpadAdd') return Math.min(ZOOM_MAX, Math.round((level + 0.5) * 10) / 10)
  if (key === '-' || key === '_' || key === 'NumpadSubtract') return Math.max(ZOOM_MIN, Math.round((level - 0.5) * 10) / 10)
  return null
}

export function createMainWindow(onZoom: (level: number) => void = () => undefined, icon?: string): BrowserWindow {
  const win = new BrowserWindow({ ...mainWindowOptions(join(__dirname, '../preload/index.js')), icon })
  const loc = rendererLocation()
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.on('will-navigate', (e, url) => {
    if (!isTrustedUrl(url, loc)) e.preventDefault()
  })
  win.once('ready-to-show', () => win.show())
  // Ctrl/Cmd + = / - / 0 zoom (Electron's menu only reacts to Ctrl+Shift+= on Windows).
  win.webContents.on('before-input-event', (e, input) => {
    if (input.type !== 'keyDown' || !(input.control || input.meta) || input.alt) return
    const level = nextZoom(win.webContents.getZoomLevel(), input.code.startsWith('Numpad') ? input.code : input.key)
    if (level === null) return
    e.preventDefault()
    win.webContents.setZoomLevel(level)
    onZoom(level)
  })
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
