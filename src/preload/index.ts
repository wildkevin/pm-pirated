import { contextBridge, ipcRenderer } from 'electron'
import { CHANNELS, type Api } from '../shared/ipc'

const api = Object.fromEntries(
  Object.entries(CHANNELS).map(([name, channel]) => [name, (...args: unknown[]) => ipcRenderer.invoke(channel, ...args)]),
) as unknown as Api

contextBridge.exposeInMainWorld('api', api)
