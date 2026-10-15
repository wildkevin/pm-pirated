import { app, BrowserWindow, dialog, ipcMain, net } from 'electron'
import { randomUUID } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve } from 'node:path'
import type { CapturedExchange, LoadSpec, RunnerSpec, SendSpec } from '../shared/engine'
import type { PmAuth } from '../shared/format/types'
import { sanitizeName } from '../shared/format/names'
import { stableStringify } from '../shared/format/stableJson'
import { rawUrl } from '../shared/format/url'
import { CHANNELS, LOAD_EVENT, RUNNER_EVENT, type Api, type ImportResult, type LoadEvent, type LoadRecord, type ResolvedVariable, type RunnerEvent, type RunRecord } from '../shared/ipc'
import type { EngineClient } from './engineClient'
import { exchangeToItem, type CaptureManager } from './captureManager'
import { codeLanguages, generateCode } from './codegen'
import { deleteLoadRecord, listLoadRecords, readLoadRecord, saveLoadRecord, type LoadClient } from './loadtest'
import { buildRoutes, createDefinition, deleteDefinition, readDefinitions, saveDefinition, type MockManager } from './mocks'
import { ARGS } from './ipcSchemas'
import { buildRunCollection, deleteRun, listRuns, previewData, readDataFile, readRun, redactRecord, saveRun } from './runner'
import { getToken, parseCallback } from './oauth2'
import { engineOptions } from './netconfig'
import type { SecretStore } from './secrets'
import type { AppSettings } from './settings'
import { isTrustedUrl, rendererLocation } from './window'
import { appendHistory, deleteHistory, listHistory } from './workspace/history'
import * as store from './workspace/store'
import { WorkspaceError } from './workspace/store'
import { detect, exportCollection, exportEnvironment, importDetected } from './workspace/transfer'
import { readUiState, writeUiState } from './workspace/uiState'
import { Variables, createEnvironment, deleteEnvironment, renameEnvironment } from './workspace/variables'

export interface IpcDeps {
  win: BrowserWindow
  settings: AppSettings
  secrets: SecretStore
  engine: EngineClient
  mocks: MockManager
  capture: CaptureManager
  load: LoadClient
  /** Rebuilds the extra-CA bundle from settings; returns its path (or undefined). */
  caBundle(): Promise<string | undefined>
}

const isCollectionId = (id: string) => id.split('/').length === 2

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
    const switched = root !== dir
    root = dir
    vars = new Variables(dir, deps.secrets)
    // Mocks belong to a workspace: stop the old ones, start this one's auto-start mocks.
    if (switched) void deps.mocks.stopAll().then(() => deps.mocks.autoStart(dir)).catch(() => undefined)
    deps.capture.setWorkspace(dir)
  }
  /** Saved examples may have changed: running mocks serving that collection reload their routes. */
  const examplesChanged = (id: string) => void deps.mocks.refresh(ws(), store.collectionOf(id)).catch(() => undefined)
  const cookieFile = () => join(ws(), '.pmlocal', 'cookies.json')

  // Files the user picked in a dialog this session; other paths from the window must be in the workspace.
  const pickedFiles = new Set<string>()
  // Folders the user picked on the create-workspace page; the window may only create workspaces there.
  const pickedFolders = new Set<string>()
  const defaultLocation = () => join(app.getPath('documents'), 'PM Local')
  const dataFilePath = (path: string) => {
    const abs = resolve(ws(), path)
    const rel = relative(ws(), abs)
    if (pickedFiles.has(abs) || (rel && !rel.startsWith('..') && !isAbsolute(rel))) return abs
    throw new Error('Choose the data file with Select File')
  }

  // Load tests in progress: ticks stream to the window and are kept for the saved record.
  const loads = new Map<string, LoadRecord>()
  const sendLoad = (e: LoadEvent) => {
    if (!deps.win.isDestroyed()) deps.win.webContents.send(LOAD_EVENT, e)
  }
  deps.load.onTick = (runId, tick) => {
    loads.get(runId)?.ticks.push(tick)
    sendLoad({ runId, tick })
  }

  // Collection runs in progress; results stream to the window and are saved when done.
  const runs = new Map<string, RunRecord>()
  const sendRunner = (e: RunnerEvent) => {
    if (!deps.win.isDestroyed()) deps.win.webContents.send(RUNNER_EVENT, e)
  }
  deps.engine.onRunItem = (runId, item) => {
    runs.get(runId)?.results.push(item)
    sendRunner({ runId, item })
  }

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
    defaultWorkspaceLocation: async () => defaultLocation(),
    async pickFolder(purpose) {
      const res = await dialog.showOpenDialog(deps.win, {
        title: purpose === 'location' ? 'Choose where to create the workspace' : 'Choose your project folder',
        properties: ['openDirectory', 'createDirectory'],
      })
      const dir = res.filePaths[0]
      if (res.canceled || !dir) return null
      pickedFolders.add(resolve(dir))
      return dir
    },
    async createWorkspace(input) {
      const name = input.name.trim()
      let dir: string
      if (input.setup === 'blank') {
        const location = resolve(input.location)
        if (location !== defaultLocation() && !pickedFolders.has(location)) throw new WorkspaceError('Choose the location with the folder picker')
        dir = await store.createWorkspaceIn(location, name)
      } else {
        dir = resolve(input.folder)
        if (!pickedFolders.has(dir)) throw new WorkspaceError('Choose the folder with the folder picker')
        // An existing workspace is opened as it is; any other folder becomes one (its files are untouched).
        if (!(await store.isWorkspace(dir))) await store.initWorkspace(dir, name)
      }
      use(dir)
      await deps.settings.rememberWorkspace(dir)
      return store.openWorkspace(dir)
    },
    listWorkspaces: () => Promise.all(deps.settings.get().recentWorkspaces.map(async (root) => ({ root, name: await store.workspaceName(root) }))),
    forgetWorkspace: (dir) => deps.settings.forgetWorkspace(dir),
    async openRecentWorkspace(dir) {
      // Only folders the user already opened through the picker.
      if (!deps.settings.get().recentWorkspaces.includes(dir)) throw new WorkspaceError('Not a recent workspace')
      if (!(await store.isWorkspace(dir))) throw new WorkspaceError(`${dir} is no longer a workspace folder`)
      use(dir)
      await deps.settings.rememberWorkspace(dir)
      return store.openWorkspace(dir)
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
      examplesChanged(id)
      return { workspace: await reopen(), id }
    },
    async renameNode(id, name) {
      const newId = await store.renameNode(ws(), id, name)
      if (isCollectionId(id)) await variables().move(`col:${id}`, `col:${newId}`)
      // Mocks serving the renamed collection/folder follow it.
      for (const m of await readDefinitions(ws()))
        if (m.def.target === id || m.def.target.startsWith(`${id}/`)) await saveDefinition(ws(), m.id, { ...m.def, target: newId + m.def.target.slice(id.length) })
      return { workspace: await reopen(), id: newId }
    },
    async duplicateNode(id) {
      const newId = await store.duplicateNode(ws(), id)
      return { workspace: await reopen(), id: newId }
    },
    async deleteNode(id) {
      await store.deleteNode(ws(), id)
      examplesChanged(id)
      if (isCollectionId(id)) await variables().forget(`col:${id}`)
      return reopen()
    },
    readRequest: (id) => store.readRequest(ws(), id),
    async saveRequest(id, item) {
      await store.saveRequest(ws(), id, item)
      examplesChanged(id)
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
      const newId = await renameEnvironment(ws(), id, name, variables())
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
    async resolveVariables(requestId, environmentId) {
      const v = variables()
      const scopes: [ResolvedVariable['scope'], string][] = [['globals', 'globals']]
      if (requestId) scopes.push(['collection', `col:${store.collectionOf(requestId)}`])
      if (environmentId) scopes.push(['environment', `env:${environmentId}`])
      const out = new Map<string, ResolvedVariable>()
      for (const [scope, ref] of scopes)
        for (const r of await v.effective(ref).catch(() => []))
          out.set(r.key, { key: r.key, value: r.value, scope, secret: r.type === 'secret' })
      return [...out.values()]
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
      const certsChanged = JSON.stringify(deps.settings.get().certificates) !== JSON.stringify(s.certificates)
      await deps.settings.save(s)
      if (certsChanged) caFile = deps.caBundle().catch(() => undefined)
    },
    getOAuth2Token: (config) =>
      getToken(config, {
        authorize: (url, redirectUri) => authorizeInWindow(deps.win, url, redirectUri),
        async fetch(url, init) {
          const res = await net.fetch(url, init)
          return { ok: res.ok, status: res.status, text: () => res.text(), contentType: res.headers.get('content-type') ?? '' }
        },
      }),
    async startRun(config) {
      const dir = ws()
      const v = variables()
      const runId = `${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`
      const collection = await buildRunCollection(dir, config.target, config.requestIds)
      const collectionId = store.collectionOf(config.target)
      collection.variable = await v.effective(`col:${collectionId}`)
      const env = config.environmentId ? (await store.openWorkspace(dir)).environments.find((e) => e.id === config.environmentId) : undefined
      const data = config.dataFile ? await readDataFile(dataFilePath(config.dataFile)) : []
      const record: RunRecord = {
        id: runId,
        name: (await store.readContainer(dir, config.target)).name,
        target: config.target,
        startedAt: Date.now(),
        environment: env?.name ?? null,
        config,
        summary: null,
        results: [],
      }
      runs.set(runId, record)
      // Secret variable values, masked in the saved results (live results are not masked).
      const secretValues = async () =>
        [
          ...(await v.effective('globals')),
          ...(await v.effective(`col:${collectionId}`)),
          ...(env ? await v.effective(`env:${env.id}`) : []),
        ]
          .filter((x) => x.type === 'secret')
          .map((x) => x.value)
      const secretsBefore = await secretValues()
      const spec: RunnerSpec = {
        collection,
        ...(env ? { environment: { name: env.name, values: await v.effective(`env:${env.id}`) } } : {}),
        globals: await v.effective('globals'),
        data,
        iterationCount: config.iterations,
        delayMs: config.delayMs,
        stopOnError: config.stopOnError,
        persistResponses: config.persistResponses,
        cookieFile: cookieFile(),
        workingDir: dir,
        options: engineOptions(deps.settings.get(), await caFile),
      }
      void deps.engine.call('run', { runId, spec }).then(
        async ({ summary, variables: after }) => {
          record.summary = summary
          if (config.keepVariables)
            await Promise.all([
              env && after.environment ? v.applyChanges(`env:${env.id}`, after.environment) : undefined,
              v.applyChanges('globals', after.globals),
              v.applyChanges(`col:${collectionId}`, after.collection),
            ]).catch((e) => (record.error = `Could not save variable changes: ${(e as Error).message}`))
          await saveRun(dir, redactRecord(record, [...secretsBefore, ...(await secretValues().catch(() => []))])).catch(() => undefined)
          runs.delete(runId)
          sendRunner({ runId, done: summary })
        },
        async (e: Error) => {
          record.error = e.message
          await saveRun(dir, redactRecord(record, secretsBefore)).catch(() => undefined)
          runs.delete(runId)
          sendRunner({ runId, error: e.message })
        },
      )
      return runId
    },
    async stopRun(runId) {
      await deps.engine.call('runStop', { runId })
    },
    // Picked files inside the workspace come back relative to it.
    previewDataFile: (path) => previewData(dataFilePath(path)),
    listRuns: () => listRuns(ws()),
    readRun: (id) => readRun(ws(), id),
    deleteRun: (id) => deleteRun(ws(), id),
    async exportRun(id) {
      const record = await readRun(ws(), id)
      return saveJson(deps.win, `${sanitizeName(record.name)}.postman_test_run.json`, record)
    },
    codeLanguages: async () => codeLanguages(),
    async startLoadTest(config) {
      const dir = ws()
      const v = variables()
      const runId = `${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`
      const collection = await buildRunCollection(dir, config.target, config.requestIds)
      collection.variable = await v.effective(`col:${store.collectionOf(config.target)}`)
      const env = config.environmentId ? (await store.openWorkspace(dir)).environments.find((e) => e.id === config.environmentId) : undefined
      const record: LoadRecord = {
        id: runId,
        name: (await store.readContainer(dir, config.target)).name,
        startedAt: Date.now(),
        profile: config.profile,
        environment: env?.name ?? null,
        summary: null,
        ticks: [],
      }
      loads.set(runId, record)
      const spec: LoadSpec = {
        collection,
        ...(env ? { environment: { name: env.name, values: await v.effective(`env:${env.id}`) } } : {}),
        globals: await v.effective('globals'),
        data: config.dataFile ? await readDataFile(dataFilePath(config.dataFile)) : [],
        profile: config.profile,
        cookieFile: cookieFile(),
        workingDir: dir,
        options: engineOptions(deps.settings.get(), await caFile),
      }
      void deps.load.call('start', { runId, spec }).then(
        async (summary) => {
          record.summary = summary
          await saveLoadRecord(dir, record).catch(() => undefined)
          loads.delete(runId)
          sendLoad({ runId, done: summary })
        },
        async (e: Error) => {
          record.error = e.message
          await saveLoadRecord(dir, record).catch(() => undefined)
          loads.delete(runId)
          sendLoad({ runId, error: e.message })
        },
      )
      return runId
    },
    async stopLoadTest(runId) {
      await deps.load.call('stop', { runId })
    },
    listLoadTests: () => listLoadRecords(ws()),
    readLoadTest: (id) => readLoadRecord(ws(), id),
    deleteLoadTest: (id) => deleteLoadRecord(ws(), id),
    captureState: () => deps.capture.getState(),
    async startCapture(port, decrypt) {
      const bundle = await caFile
      return deps.capture.start(port, decrypt, bundle ? await readFile(bundle, 'utf8') : undefined)
    },
    stopCapture: () => deps.capture.stop(),
    setCaptureOptions: (filter, destination) => {
      if (destination !== 'history' && destination !== 'none') store.resolveInside(ws(), destination)
      return deps.capture.setOptions(filter, destination)
    },
    setSystemProxy: (on) => deps.capture.setSystemProxy(on),
    trustCaptureCa: () => deps.capture.trust(),
    untrustCaptureCa: () => deps.capture.untrust(),
    async exportCaptureCa() {
      const res = await dialog.showSaveDialog(deps.win, { title: 'Export CA certificate', defaultPath: 'PM Local Proxy CA.crt' })
      if (res.canceled || !res.filePath) return false
      await writeFile(res.filePath, await deps.capture.caCertificate())
      return true
    },
    async saveCaptured(exchange, parentId) {
      const item = exchangeToItem(exchange as CapturedExchange)
      const id = await store.createRequest(ws(), parentId, item.name, item)
      return { workspace: await reopen(), id }
    },
    listMocks: () => deps.mocks.list(ws()),
    async createMock(def) {
      const id = await createDefinition(ws(), def)
      return { mocks: await deps.mocks.list(ws()), id }
    },
    async saveMock(id, def) {
      await saveDefinition(ws(), id, def)
      if (deps.mocks.isRunning(id)) {
        await deps.mocks.stop(id)
        await deps.mocks.start(ws(), id)
      }
      return deps.mocks.list(ws())
    },
    async deleteMock(id) {
      await deps.mocks.stop(id)
      await deleteDefinition(ws(), id)
      return deps.mocks.list(ws())
    },
    startMock: (id) => deps.mocks.start(ws(), id),
    stopMock: (id) => deps.mocks.stop(id),
    async mockRoutes(id) {
      const def = (await readDefinitions(ws())).find((d) => d.id === id)
      if (!def) throw new Error('Mock server not found')
      return buildRoutes(ws(), def.def.target)
    },
    async generateCode(requestId, item, environmentId, language, variant) {
      const dir = ws()
      const v = variables()
      let inherited: PmAuth | undefined
      let vars = await v.effective('globals')
      if (requestId) {
        const chain = await store.loadChain(dir, requestId)
        inherited = [...chain.parents].reverse().find((p) => p.auth)?.auth
        vars = [...vars, ...(await v.effective(`col:${chain.collectionId}`))]
      }
      if (environmentId) vars = [...vars, ...(await v.effective(`env:${environmentId}`))]
      return generateCode(item, inherited, vars, language, variant)
    },
    async saveResponseBody(defaultName, body) {
      const res = await dialog.showSaveDialog(deps.win, { title: 'Save response', defaultPath: sanitizeName(defaultName) })
      if (res.canceled || !res.filePath) return false
      await writeFile(res.filePath, body)
      return true
    },
    async pickFile(title) {
      const res = await dialog.showOpenDialog(deps.win, { title, properties: ['openFile'] })
      const file = res.filePaths[0]
      if (res.canceled || !file) return null
      pickedFiles.add(resolve(file))
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

/**
 * Shows the provider's login page in an isolated window (own session, no preload, sandboxed) and
 * resolves with the callback URL as soon as the browser is sent there — it is never actually loaded.
 */
function authorizeInWindow(parent: BrowserWindow, authUrl: string, redirectUri: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const win = new BrowserWindow({
      parent,
      modal: true,
      width: 520,
      height: 720,
      title: 'Get New Access Token',
      autoHideMenuBar: true,
      webPreferences: { partition: 'oauth2', sandbox: true, contextIsolation: true, nodeIntegration: false },
    })
    let done = false
    const finish = (fn: () => void) => {
      if (done) return
      done = true
      fn()
      if (!win.isDestroyed()) win.close()
    }
    const check = (e: { preventDefault(): void }, url: string) => {
      if (!parseCallback(url, redirectUri)) return
      e.preventDefault()
      finish(() => resolve(url))
    }
    win.webContents.on('will-redirect', check)
    win.webContents.on('will-navigate', check)
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    win.on('closed', () => finish(() => reject(new Error('Authentication window was closed'))))
    win.loadURL(authUrl).catch(() => undefined)
  })
}
