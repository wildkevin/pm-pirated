import { contextBridge, ipcRenderer } from 'electron'
import { BEFORE_CLOSE, CHANNELS, CLOSE_READY, type Api, type AppEvents } from '../shared/ipc'

const api = {
  ...Object.fromEntries(Object.entries(CHANNELS).map(([name, channel]) => [name, (...args: unknown[]) => ipcRenderer.invoke(channel, ...args)])),
  // The window is about to close: the renderer saves its state, then calls closeReady().
  onBeforeClose: (cb: () => void) => void ipcRenderer.on(BEFORE_CLOSE, () => cb()),
  closeReady: () => ipcRenderer.send(CLOSE_READY),
} as unknown as Api & AppEvents

contextBridge.exposeInMainWorld('api', api)
