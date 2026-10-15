// The only surface the renderer can reach (exposed as window.api by the preload).
import type { CookieInfo, RunReport } from './engine'
import type { PmContainer, PmItem, WorkspaceInfo } from './format/types'
import type { AppSettingsData } from './settings'

export interface Created {
  workspace: WorkspaceInfo
  id: string
}

export interface VariableRow {
  key: string
  type: 'default' | 'secret'
  initial: string
  current: string
  enabled: boolean
}

/** 'globals' | 'env:<environments/X.env.json>' | 'col:<collections/X>' */
export type ScopeRef = string

export interface ImportResult {
  kind: 'collection' | 'environment' | 'globals' | 'request'
  id: string
  name: string
  detail?: string
  /** For cURL: the request to open in a new tab. */
  item?: PmItem
}

export interface HistoryEntry {
  id: string
  ts: number
  name: string
  item: PmItem
  code?: number
  status?: string
  timeMs?: number
  error?: string
}

export interface UiTab {
  /** Request id, or null for an unsaved draft. */
  id: string | null
  item: PmItem
  /** Serialized item as last saved (absent for drafts). */
  saved?: string
}

export interface UiState {
  activeEnvironment: string | null
  tabs: UiTab[]
  activeIndex: number
}

export interface Api {
  // workspace
  /** Folder picker; opens the folder as a workspace, initialising it if needed. */
  openWorkspaceDialog(): Promise<WorkspaceInfo | null>
  /** The most recently used workspace, reopened at startup. */
  currentWorkspace(): Promise<WorkspaceInfo | null>
  refreshWorkspace(): Promise<WorkspaceInfo>

  // collections tree
  createCollection(name: string): Promise<Created>
  createFolder(parentId: string, name: string): Promise<Created>
  /** `item` is optional content (Save As of a draft). */
  createRequest(parentId: string, name: string, item?: PmItem): Promise<Created>
  /** Returns the node's new id (its file/folder is renamed to match). */
  renameNode(id: string, name: string): Promise<Created>
  deleteNode(id: string): Promise<WorkspaceInfo>
  readRequest(id: string): Promise<PmItem>
  saveRequest(id: string, item: PmItem): Promise<WorkspaceInfo>
  readContainer(id: string): Promise<PmContainer>
  saveContainer(id: string, data: Pick<PmContainer, 'auth' | 'event' | 'description'>): Promise<WorkspaceInfo>

  // variables & environments
  readVariables(scope: ScopeRef): Promise<VariableRow[]>
  saveVariables(scope: ScopeRef, rows: VariableRow[]): Promise<void>
  createEnvironment(name: string): Promise<Created>
  renameEnvironment(id: string, name: string): Promise<Created>
  deleteEnvironment(id: string): Promise<WorkspaceInfo>

  // per-workspace UI state
  readUiState(): Promise<UiState>
  saveUiState(state: UiState): Promise<void>

  // sending
  /** `requestId` null = unsaved draft (no collection context). */
  sendRequest(sendId: string, requestId: string | null, item: PmItem, environmentId: string | null): Promise<RunReport>
  cancelRequest(sendId: string): Promise<void>

  // history, cookies
  listHistory(): Promise<HistoryEntry[]>
  /** No id = clear all. */
  deleteHistory(id?: string): Promise<void>
  listCookies(): Promise<CookieInfo[]>
  deleteCookies(domain: string, path?: string, key?: string): Promise<void>
  /** `cookie` is a Set-Cookie style string, stored as if received from `url`. */
  setCookie(url: string, cookie: string): Promise<void>

  // import / export
  /** File picker; imports every selected file. */
  importFiles(): Promise<ImportResult[]>
  importText(text: string): Promise<ImportResult>
  exportCollection(id: string): Promise<boolean>
  exportEnvironment(id: string): Promise<boolean>

  // app
  getSettings(): Promise<AppSettingsData>
  saveSettings(settings: AppSettingsData): Promise<void>
  /** File picker for bodies/certificates; paths inside the workspace come back relative. */
  pickFile(title: string): Promise<string | null>
}

export const CHANNELS = {
  openWorkspaceDialog: 'workspace:openDialog',
  currentWorkspace: 'workspace:current',
  refreshWorkspace: 'workspace:refresh',
  createCollection: 'node:createCollection',
  createFolder: 'node:createFolder',
  createRequest: 'node:createRequest',
  renameNode: 'node:rename',
  deleteNode: 'node:delete',
  readRequest: 'request:read',
  saveRequest: 'request:save',
  readContainer: 'container:read',
  saveContainer: 'container:save',
  readVariables: 'variables:read',
  saveVariables: 'variables:save',
  createEnvironment: 'env:create',
  renameEnvironment: 'env:rename',
  deleteEnvironment: 'env:delete',
  readUiState: 'ui:read',
  saveUiState: 'ui:save',
  sendRequest: 'request:send',
  cancelRequest: 'request:cancel',
  listHistory: 'history:list',
  deleteHistory: 'history:delete',
  listCookies: 'cookies:list',
  deleteCookies: 'cookies:delete',
  setCookie: 'cookies:set',
  importFiles: 'import:files',
  importText: 'import:text',
  exportCollection: 'export:collection',
  exportEnvironment: 'export:environment',
  getSettings: 'settings:get',
  saveSettings: 'settings:save',
  pickFile: 'dialog:pickFile',
} as const satisfies Record<keyof Api, string>
