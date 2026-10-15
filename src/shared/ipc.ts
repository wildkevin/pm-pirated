// The only surface the renderer can reach (exposed as window.api by the preload).
import type { CaptureFilter, CapturedExchange, CookieInfo, RunReport, RunnerItemResult, RunnerSummary } from './engine'
import type { MockDefinition, MockEvent, MockInfo, MockRoute, MockStatus } from './mock'
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

/** A variable as the request would see it, after scope precedence (environment > collection > globals). */
export interface ResolvedVariable {
  key: string
  value: string
  scope: 'environment' | 'collection' | 'globals'
  secret: boolean
}

/** OAuth 2.0 "Configure New Token" values, with variables already resolved. */
export interface OAuth2Config {
  grant_type?: string
  authUrl?: string
  accessTokenUrl?: string
  clientId?: string
  clientSecret?: string
  scope?: string
  state?: string
  redirect_uri?: string
  client_authentication?: string
  username?: string
  password?: string
  challengeAlgorithm?: string
}

export interface OAuth2Token {
  access_token: string
  token_type?: string
  refresh_token?: string
  expires_in?: number
  scope?: string
}

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
  /** For `{{var}}` highlighting and the environment quick look. */
  resolveVariables(requestId: string | null, environmentId: string | null): Promise<ResolvedVariable[]>
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
  /** Runs the OAuth 2.0 flow (login window for code/implicit grants) and returns the token. */
  getOAuth2Token(config: OAuth2Config): Promise<OAuth2Token>
  // collection runner
  /** Starts a run in the background; results arrive through onRunnerEvent. */
  startRun(config: RunConfig): Promise<string>
  stopRun(runId: string): Promise<void>
  previewDataFile(path: string): Promise<DataPreview>
  listRuns(): Promise<RunInfo[]>
  readRun(id: string): Promise<RunRecord>
  deleteRun(id: string): Promise<void>
  exportRun(id: string): Promise<boolean>

  // mock servers
  listMocks(): Promise<MockInfo[]>
  createMock(def: MockDefinition): Promise<{ mocks: MockInfo[]; id: string }>
  /** Saves the definition; a running mock restarts with it. */
  saveMock(id: string, def: MockDefinition): Promise<MockInfo[]>
  deleteMock(id: string): Promise<MockInfo[]>
  startMock(id: string): Promise<MockStatus>
  stopMock(id: string): Promise<MockStatus>
  mockRoutes(id: string): Promise<MockRoute[]>

  // capture proxy
  captureState(): Promise<CaptureState>
  startCapture(port: number, decrypt: boolean): Promise<CaptureState>
  stopCapture(): Promise<CaptureState>
  setCaptureOptions(filter: CaptureFilter, destination: string): Promise<CaptureState>
  setSystemProxy(on: boolean): Promise<CaptureState>
  trustCaptureCa(): Promise<CaptureState>
  untrustCaptureCa(): Promise<CaptureState>
  exportCaptureCa(): Promise<boolean>
  saveCaptured(exchange: CapturedExchange, parentId: string): Promise<Created>

  // load testing
  startLoadTest(config: LoadConfig): Promise<string>
  stopLoadTest(runId: string): Promise<void>
  listLoadTests(): Promise<LoadInfo[]>
  readLoadTest(id: string): Promise<LoadRecord>
  deleteLoadTest(id: string): Promise<void>

  // code snippets
  codeLanguages(): Promise<CodeLanguage[]>
  generateCode(requestId: string | null, item: PmItem, environmentId: string | null, language: string, variant: string): Promise<string>

  /** Save dialog for a response body; false when cancelled. */
  saveResponseBody(defaultName: string, body: Uint8Array): Promise<boolean>
  /** File picker for bodies/certificates; paths inside the workspace come back relative. */
  pickFile(title: string): Promise<string | null>
}

/** Not request/response calls: the close handshake that lets the UI save unsaved tab state. */
export interface AppEvents {
  onBeforeClose(cb: () => void): void
  closeReady(): void
  onRunnerEvent(cb: (e: RunnerEvent) => void): void
  onMockEvent(cb: (e: MockEvent) => void): void
  onCaptureEvent(cb: (e: CaptureEvent) => void): void
  onLoadEvent(cb: (e: LoadEvent) => void): void
}
export const BEFORE_CLOSE = 'app:before-close'
export const RUNNER_EVENT = 'runner:event'
export const MOCK_EVENT = 'mocks:event'
export const CAPTURE_EVENT = 'capture:event'
export const LOAD_EVENT = 'load:event'
export const CLOSE_READY = 'app:close-ready'

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
  resolveVariables: 'variables:resolve',
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
  saveResponseBody: 'dialog:saveResponse',
  getOAuth2Token: 'oauth2:getToken',
  startRun: 'runner:start',
  stopRun: 'runner:stop',
  previewDataFile: 'runner:previewData',
  listRuns: 'runner:list',
  readRun: 'runner:read',
  deleteRun: 'runner:delete',
  exportRun: 'runner:export',
  codeLanguages: 'code:languages',
  listMocks: 'mocks:list',
  createMock: 'mocks:create',
  saveMock: 'mocks:save',
  deleteMock: 'mocks:delete',
  startMock: 'mocks:start',
  stopMock: 'mocks:stop',
  mockRoutes: 'mocks:routes',
  captureState: 'capture:state',
  startLoadTest: 'load:start',
  stopLoadTest: 'load:stop',
  listLoadTests: 'load:list',
  readLoadTest: 'load:read',
  deleteLoadTest: 'load:delete',
  startCapture: 'capture:start',
  stopCapture: 'capture:stop',
  setCaptureOptions: 'capture:options',
  setSystemProxy: 'capture:systemProxy',
  trustCaptureCa: 'capture:trust',
  untrustCaptureCa: 'capture:untrust',
  exportCaptureCa: 'capture:exportCa',
  saveCaptured: 'capture:save',
  generateCode: 'code:generate',
} as const satisfies Record<keyof Api, string>

// --- Collection Runner ---

export interface RunConfig {
  /** Collection or folder id. */
  target: string
  /** Selected requests, in tree order. */
  requestIds: string[]
  environmentId: string | null
  iterations: number
  delayMs: number
  dataFile: string | null
  persistResponses: boolean
  keepVariables: boolean
  stopOnError: boolean
}

export interface RunInfo {
  id: string
  name: string
  startedAt: number
  summary: RunnerSummary | null
}

export interface RunRecord extends RunInfo {
  target: string
  environment: string | null
  config: RunConfig
  results: RunnerItemResult[]
  error?: string
}

export type RunnerEvent =
  | { runId: string; item: RunnerItemResult }
  | { runId: string; done: RunnerSummary }
  | { runId: string; error: string }

export interface DataPreview {
  rows: Record<string, unknown>[]
  count: number
  columns: string[]
}

export interface CodeLanguage {
  key: string
  label: string
  variants: string[]
  syntax: string
}

// --- Capture proxy ---

export interface CaptureState {
  running: boolean
  port: number
  decrypt: boolean
  filter: import('./engine').CaptureFilter
  /** 'history', 'none', or a collection/folder id to save captured requests into. */
  destination: string
  systemProxy: boolean
  /** Only Windows can switch the system proxy from the app. */
  systemProxySupported: boolean
  caTrusted: boolean | null
  error?: string
}

export type CaptureEvent = { exchange: import('./engine').CapturedExchange; savedTo?: string } | { state: CaptureState }

// --- Load testing ---

export interface LoadConfig {
  target: string
  requestIds: string[]
  environmentId: string | null
  profile: import('../loadtest/profile').LoadProfile
  dataFile: string | null
}

export interface LoadInfo {
  id: string
  name: string
  startedAt: number
  profile: import('../loadtest/profile').LoadProfile
  summary: import('../loadtest/metrics').LoadSummary | null
}

export interface LoadRecord extends LoadInfo {
  environment: string | null
  ticks: import('../loadtest/metrics').Tick[]
  error?: string
}

export type LoadEvent =
  | { runId: string; tick: import('../loadtest/metrics').Tick }
  | { runId: string; done: import('../loadtest/metrics').LoadSummary }
  | { runId: string; error: string }
