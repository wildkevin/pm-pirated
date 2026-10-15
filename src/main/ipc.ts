import { dialog, ipcMain, type BrowserWindow } from 'electron'
import { CHANNELS, type Api } from '../shared/ipc'
import type { EngineClient } from './engineClient'
import { ARGS } from './ipcSchemas'
import type { AppSettings } from './settings'
import { isTrustedUrl, rendererLocation } from './window'
import * as store from './workspace/store'

export function registerIpc(deps: { win: BrowserWindow; settings: AppSettings; engine: EngineClient }): void {
  const loc = rendererLocation()
  let root: string | undefined
  const ws = () => {
    if (!root) throw new Error('No workspace is open')
    return root
  }
  const reopen = () => store.openWorkspace(ws())

  const handlers: Api = {
    async openWorkspaceDialog() {
      const res = await dialog.showOpenDialog(deps.win, {
        title: 'Open or create a workspace folder',
        properties: ['openDirectory', 'createDirectory'],
      })
      const dir = res.filePaths[0]
      if (res.canceled || !dir) return null
      const info = (await store.isWorkspace(dir)) ? await store.openWorkspace(dir) : await store.initWorkspace(dir)
      root = dir
      await deps.settings.rememberWorkspace(dir)
      return info
    },
    async currentWorkspace() {
      const last = deps.settings.get().recentWorkspaces[0]
      if (!last || !(await store.isWorkspace(last))) return null
      root = last
      return store.openWorkspace(last)
    },
    async createCollection(name) {
      const id = await store.createCollection(ws(), name)
      return { workspace: await reopen(), id }
    },
    async createFolder(parentId, name) {
      const id = await store.createFolder(ws(), parentId, name)
      return { workspace: await reopen(), id }
    },
    async createRequest(parentId, name) {
      const id = await store.createRequest(ws(), parentId, name)
      return { workspace: await reopen(), id }
    },
    async renameNode(id, name) {
      await store.renameNode(ws(), id, name)
      return reopen()
    },
    async deleteNode(id) {
      await store.deleteNode(ws(), id)
      return reopen()
    },
    readRequest: (id) => store.readRequest(ws(), id),
    async saveRequest(id, item) {
      await store.saveRequest(ws(), id, item)
      return reopen()
    },
    sendRequest: (sendId, item) => deps.engine.send(sendId, item),
    async cancelRequest(sendId) {
      deps.engine.cancel(sendId)
    },
  }

  for (const key of Object.keys(CHANNELS) as (keyof Api)[]) {
    ipcMain.handle(CHANNELS[key], async (e, ...args: unknown[]) => {
      if (!e.senderFrame || !isTrustedUrl(e.senderFrame.url, loc)) throw new Error('Rejected IPC from untrusted frame')
      const parsed = ARGS[key].parse(args) as unknown[]
      return (handlers[key] as (...a: unknown[]) => Promise<unknown>)(...parsed)
    })
  }
}
