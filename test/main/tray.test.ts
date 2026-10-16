import { EventEmitter } from 'node:events'
import type { BrowserWindow } from 'electron'
import { expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  nativeImage: { createFromPath: () => ({ resize: () => ({}) }) },
  Menu: { buildFromTemplate: (items: unknown) => items },
  Tray: class extends EventEmitter {
    menu: any[] = []
    setToolTip() {}
    setContextMenu(menu: any[]) { this.menu = menu }
  },
}))

const { createWindowsTray } = await import('../../src/main/tray')

it('restores hidden/minimized windows from the tray and exits only on the Exit action', () => {
  const win = { isDestroyed: () => false, isMinimized: () => true, restore: vi.fn(), show: vi.fn(), focus: vi.fn() }
  const exit = vi.fn()
  const tray = createWindowsTray(win as unknown as BrowserWindow, 'icon.png', exit, 'win32')!
  tray.emit('click')
  expect(win.restore).toHaveBeenCalledOnce()
  expect(win.show).toHaveBeenCalledOnce()
  expect(win.focus).toHaveBeenCalledOnce()
  const menu = (tray as unknown as { menu: { label?: string; click?: () => void }[] }).menu
  menu.find(item => item.label === 'Show PM Local')!.click!()
  expect(win.show).toHaveBeenCalledTimes(2)
  expect(exit).not.toHaveBeenCalled()
  menu.find(item => item.label === 'Exit')!.click!()
  expect(exit).toHaveBeenCalledOnce()
})

it('keeps the existing behavior on other platforms', () => {
  expect(createWindowsTray({} as BrowserWindow, 'icon.png', vi.fn(), 'darwin')).toBeUndefined()
})
