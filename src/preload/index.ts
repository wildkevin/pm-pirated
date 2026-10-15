import { contextBridge, ipcRenderer } from 'electron'
import { BEFORE_CLOSE, CAPTURE_EVENT, CHANNELS, CLOSE_READY, LOAD_EVENT, MOCK_EVENT, RUNNER_EVENT, type Api, type AppEvents } from '../shared/ipc'

const api = {
  ...Object.fromEntries(Object.entries(CHANNELS).map(([name, channel]) => [name, (...args: unknown[]) => ipcRenderer.invoke(channel, ...args)])),
  // The window is about to close: the renderer saves its state, then calls closeReady().
  onBeforeClose: (cb: () => void) => void ipcRenderer.on(BEFORE_CLOSE, () => cb()),
  closeReady: () => ipcRenderer.send(CLOSE_READY),
  onRunnerEvent: (cb: (e: unknown) => void) => void ipcRenderer.on(RUNNER_EVENT, (_e, payload) => cb(payload)),
  onMockEvent: (cb: (e: unknown) => void) => void ipcRenderer.on(MOCK_EVENT, (_e, payload) => cb(payload)),
  onCaptureEvent: (cb: (e: unknown) => void) => void ipcRenderer.on(CAPTURE_EVENT, (_e, payload) => cb(payload)),
  onLoadEvent: (cb: (e: unknown) => void) => void ipcRenderer.on(LOAD_EVENT, (_e, payload) => cb(payload)),
} as unknown as Api & AppEvents

contextBridge.exposeInMainWorld('api', api)
