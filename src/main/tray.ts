import { Menu, nativeImage, Tray, type BrowserWindow } from 'electron'

export function restoreWindow(win: BrowserWindow): void {
  if (win.isDestroyed()) return
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
}

export function createWindowsTray(win: BrowserWindow, icon: string, exit: () => void, platform = process.platform): Tray | undefined {
  if (platform !== 'win32') return
  const tray = new Tray(nativeImage.createFromPath(icon).resize({ width: 16, height: 16 }))
  const show = () => restoreWindow(win)
  tray.setToolTip('PM Local')
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Show PM Local', click: show },
    { type: 'separator' },
    { label: 'Exit', click: exit },
  ]))
  tray.on('click', show)
  tray.on('double-click', show)
  return tray
}
