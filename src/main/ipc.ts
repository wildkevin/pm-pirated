import { dialog, ipcMain, type BrowserWindow } from 'electron'
import { randomUUID } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { isAbsolute, join, relative } from 'node:path'
import type { SendSpec } from '../shared/engine'
import { sanitizeName } from '../shared/format/names'
import { stableStringify } from '../shared/format/stableJson'
import { rawUrl } from '../shared/format/url'
import { CHANNELS, type Api, type ImportResult } from '../shared/ipc'
import type { EngineClient } from './engineClient'
import { ARGS } from './ipcSchemas'
import { engineOptions } from './netconfig'
import type { SecretStore } from './secrets'
import type { AppSettings } from './settings'
import { isTrustedUrl, rendererLocation } from './window'
import { appendHistory, deleteHistory, listHistory } from './workspace/history'
import * as store from './workspace/store'
import { detect, exportCollection, exportEnvironment, importDetected } from './workspace/transfer'
import { readUiState, writeUiState } from './workspace/uiState'
import { Variables, createEnvironment, deleteEnvironment, renameEnvironment } from './workspace/variables'

export interface IpcDeps {
  win: BrowserWindow
  settings: AppSettings
  secrets: SecretStore
  engine: EngineClient
  /** Rebuilds the extra-CA bundle from settings; returns its path (or undefined). */
  caBundle(): Promise<string | undefined>
}

export function registerIpc(deps: IpcDeps): void {
  const loc = rendererLocation()
  let root: string | undefined
  let vars: Variables | undefined
  let caFile: Promise<string | undefined> = deps.caBundle().catch(() => undefined)

  const ws = () => {
    if (!root) throw new Error('No workspace is open')
    return root
  }
  const variables = () => (vars ??= new Variables(ws(), deps.secrets))
  const reopen = () => store.openWorkspace(ws())
  const use = (dir: string) => {
    root = dir
    vars = new Variables(dir, deps.secrets)
  }
  const cookieFile = () => join(ws(), '.pmlocal', 'cookies.json')

  const handlers: Api = {
    async openWorkspaceDialog() {
      const res = await dialog.showOpenDialog(deps.win, { title: 'Open or create a workspace folder', properties: ['openDirectory', 'createDirectory'] })
      const dir = res.filePaths[0]
      if (res.canceled || !dir) return null
      const info = (await store.isWorkspace(dir)) ? await store.openWorkspace(dir) : await store.initWorkspace(dir)
      use(dir)
      await deps.settings.rememberWorkspace(dir)
      return info
    },
    async currentWorkspace() {
      const last = deps.settings.get().recentWorkspaces[0]
      if (!last || !(await store.isWorkspace(last))) return null
      use(last)
      return store.openWorkspace(last)
    },
    refreshWorkspace: () => reopen(),

    async createCollection(name) {
      const id = await store.createCollection(ws(), name)
      return { workspace: await reopen(), id }
    },
    async createFolder(parentId, name) {
      const id = await store.createFolder(ws(), parentId, name)
      return { workspace: await reopen(), id }
    },
    async createRequest(parentId, name, item) {
      const id = await store.createRequest(ws(), parentId, name, item)
      return { workspace: await reopen(), id }
    },
    async renameNode(id, name) {
      const newId = await store.renameNode(ws(), id, name)
      return { workspace: await reopen(), id: newId }
    },
    async deleteNode(id) {
      const scopeId = id.split('/').length === 2 ? await variables().scopeId(`col:${id}`) : undefined
      await store.deleteNode(ws(), id)
      if (scopeId) await variables().forget(scopeId)
      return reopen()
    },
    readRequest: (id) => store.readRequest(ws(), id),
    async saveRequest(id, item) {
      await store.saveRequest(ws(), id, item)
      return reopen()
    },
    readContainer: (id) => store.readContainer(ws(), id),
    async saveContainer(id, data) {
      await store.saveContainer(ws(), id, data)
      return reopen()
    },

    readVariables: (scope) => variables().read(scope),
    saveVariables: (scope, rows) => variables().write(scope, rows),
    async createEnvironment(name) {
      const id = await createEnvironment(ws(), name)
      return { workspace: await reopen(), id }
    },
    async renameEnvironment(id, name) {
      const newId = await renameEnvironment(ws(), id, name)
      return { workspace: await reopen(), id: newId }
    },
    async deleteEnvironment(id) {
      await deleteEnvironment(ws(), id, variables())
      return reopen()
    },

    readUiState: () => readUiState(ws()),
    saveUiState: (s) => writeUiState(ws(), s),

    async sendRequest(sendId, requestId, item, environmentId) {
      const dir = ws()
      const v = variables()
      const chain = requestId ? await store.loadChain(dir, requestId) : undefined
      const parents = chain?.parents ?? []
      if (chain) parents[0] = { ...parents[0], variable: await v.effective(`col:${chain.collectionId}`) }
      const envName = environmentId ? (await store.openWorkspace(dir)).environments.find((e) => e.id === environmentId)?.name : undefined
      const spec: SendSpec = {
        item,
        parents,
        ...(environmentId ? { environment: { name: envName ?? 'Environment', values: await v.effective(`env:${environmentId}`) } } : {}),
        globals: await v.effective('globals'),
        cookieFile: cookieFile(),
        workingDir: dir,
        options: engineOptions(deps.settings.get(), await caFile),
      }
      const outcome = await deps.engine.call('send', { sendId, spec })
      const { report, variables: after } = outcome
      // Persist what scripts changed; a damaged file must not hide the response.
      await Promise.all([
        environmentId && after.environment ? v.applyChanges(`env:${environmentId}`, after.environment) : undefined,
        v.applyChanges('globals', after.globals),
        chain ? v.applyChanges(`col:${chain.collectionId}`, after.collection) : undefined,
      ]).catch((e) => report.scriptErrors.push(`Could not save variable changes: ${(e as Error).message}`))
      const res = report.response
      await appendHistory(dir, {
        id: randomUUID(),
        ts: Date.now(),
        name: rawUrl(item.request.url) || item.name,
        item,
        ...(res.ok ? { code: res.code, status: res.status, timeMs: res.timeMs } : { error: res.error }),
      }).catch(() => undefined)
      return report
    },
    async cancelRequest(sendId) {
      await deps.engine.call('cancel', { sendId })
    },

    listHistory: () => listHistory(ws()),
    deleteHistory: (id) => deleteHistory(ws(), id),
    listCookies: () => deps.engine.call('cookies.list', { cookieFile: cookieFile() }),
    deleteCookies: (domain, path, key) => deps.engine.call('cookies.delete', { cookieFile: cookieFile(), domain, path, key }),
    setCookie: (url, cookie) => deps.engine.call('cookies.set', { cookieFile: cookieFile(), url, cookie }),

    async importFiles() {
      const res = await dialog.showOpenDialog(deps.win, {
        title: 'Import',
        properties: ['openFile', 'multiSelections'],
        filters: [{ name: 'Postman exports', extensions: ['json'] }, { name: 'All files', extensions: ['*'] }],
      })
      if (res.canceled) return []
      const results: ImportResult[] = []
      for (const file of res.filePaths) {
        const d = detect(await readFile(file, 'utf8'))
        results.push(await importDetected(ws(), d, variables()))
      }
      return results
    },
    importText: async (text) => importDetected(ws(), detect(text), variables()),
    async exportCollection(id) {
      const doc = await exportCollection(ws(), id)
      return saveJson(deps.win, `${sanitizeName(String(doc.info.name))}.postman_collection.json`, doc)
    },
    async exportEnvironment(id) {
      const doc = await exportEnvironment(ws(), id)
      return saveJson(deps.win, `${sanitizeName(String(doc.name ?? 'environment'))}.postman_environment.json`, doc)
    },

    getSettings: async () => deps.settings.get(),
    async saveSettings(s) {
      await deps.settings.save(s)
      caFile = deps.caBundle().catch(() => undefined)
    },
    async pickFile(title) {
      const res = await dialog.showOpenDialog(deps.win, { title, properties: ['openFile'] })
      const file = res.filePaths[0]
      if (res.canceled || !file) return null
      if (!root) return file
      const rel = relative(root, file)
      return rel && !rel.startsWith('..') && !isAbsolute(rel) ? rel.split('\\').join('/') : file
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

async function saveJson(win: BrowserWindow, defaultName: string, doc: unknown): Promise<boolean> {
  const res = await dialog.showSaveDialog(win, { title: 'Export', defaultPath: defaultName, filters: [{ name: 'JSON', extensions: ['json'] }] })
  if (res.canceled || !res.filePath) return false
  await writeFile(res.filePath, stableStringify(doc))
  return true
}
