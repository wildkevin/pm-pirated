import type { PmContainer, PmItem, PmVariable } from './format/types'

export type SendResult =
  | {
      ok: true
      code: number
      status: string
      headers: { key: string; value: string }[]
      body: Uint8Array
      /** Bytes on the wire: headers + body. */
      size: number
      timeMs: number
    }
  | { ok: false; error: string; code?: string }

export interface TestResult {
  name: string
  passed: boolean
  skipped: boolean
  error?: string
}

export interface LogEntry {
  level: 'log' | 'info' | 'warn' | 'error' | 'debug'
  /** Each console argument, already formatted for display. */
  args: string[]
  /** 'prerequest' | 'test' */
  source?: string
}

export interface SentRequest {
  method: string
  url: string
  headers: { key: string; value: string }[]
  body?: string
}

export interface CookieInfo {
  domain: string
  path: string
  key: string
  value: string
  expires?: string
  httpOnly: boolean
  secure: boolean
}

/** Everything one Send produces, as shown in the response pane and console. */
export interface RunReport {
  response: SendResult
  tests: TestResult[]
  logs: LogEntry[]
  scriptErrors: string[]
  sent?: SentRequest
  timeline?: ({ kind: 'log'; log: LogEntry } | { kind: 'request'; sent: SentRequest; response: SendResult })[]
  /** Cookies stored for the request's URL after the response. */
  cookies: CookieInfo[]
}

export interface ProxyRule {
  host: string
  port: number
  /** Which target protocols use this proxy. */
  protocols: ('http' | 'https')[]
  username?: string
  password?: string
  /** Hosts that bypass the proxy (comma separated in the UI). */
  bypass: string[]
}

export interface ClientCert {
  /** Host (optionally `host:port`) the certificate is sent to; `*` wildcards allowed. */
  host: string
  cert?: string
  key?: string
  pfx?: string
  passphrase?: string
}

export interface EngineOptions {
  timeoutMs: number
  maxResponseSizeMb: number
  strictSSL: boolean
  followRedirects: boolean
  sendPostmanToken: boolean
  useSystemProxy: boolean
  respectProxyEnv: boolean
  customProxy?: ProxyRule
  /** Postman's "Allow reading files outside working directory" (off by default). */
  allowFilesOutsideWorkingDir: boolean
  /** PEM file with extra trusted CAs (Windows store + user CA), or undefined. */
  extraCaFile?: string
  clientCerts: ClientCert[]
}

export interface SendSpec {
  item: PmItem
  /** Collection first, then folders down to the request's parent. */
  parents: PmContainer[]
  environment?: { name: string; values: PmVariable[] }
  globals: PmVariable[]
  /** Workspace `.pmlocal/cookies.json`. */
  cookieFile: string
  /** Relative file paths in bodies are resolved against this (the workspace root). */
  workingDir: string
  options: EngineOptions
}

export interface SendOutcome {
  report: RunReport
  /** Variable values after scripts ran, for persisting as current values. */
  variables: { environment?: PmVariable[]; globals: PmVariable[]; collection: PmVariable[] }
}

// --- Collection Runner ---

export interface RunnerSpec {
  /** v2.1 collection JSON (pruned to the selected requests); request `id`s are workspace node ids. */
  collection: Record<string, unknown>
  environment?: { name: string; values: PmVariable[] }
  globals: PmVariable[]
  /** One entry per iteration (CSV/JSON data file rows); empty = no data. */
  data: Record<string, unknown>[]
  iterationCount: number
  delayMs: number
  stopOnError: boolean
  /** Keep response bodies in the results (memory!). */
  persistResponses: boolean
  cookieFile: string
  workingDir: string
  options: EngineOptions
}

export interface RunnerItemResult {
  iteration: number
  requestId: string
  name: string
  method: string
  url: string
  code?: number
  status?: string
  timeMs?: number
  size?: number
  error?: string
  tests: TestResult[]
  scriptErrors: string[]
  logs: LogEntry[]
  sent?: SentRequest
  response?: { headers: { key: string; value: string }[]; body: string }
}

export interface RunnerSummary {
  iterations: number
  durationMs: number
  requests: number
  testsPassed: number
  testsFailed: number
  errors: number
  avgResponseMs: number
  stopped: boolean
}

export interface RunnerOutcome {
  summary: RunnerSummary
  variables: { environment?: PmVariable[]; globals: PmVariable[]; collection: PmVariable[] }
}

/** JSON form of a postman-collection ProxyConfig. */
export interface ProxyJson {
  host: string
  port: number
  tunnel: boolean
  authenticate?: boolean
  username?: string
  password?: string
}

// Messages between main and the engine process.
export type EngineMethods = {
  send: { params: { sendId: string; spec: SendSpec }; result: SendOutcome }
  cancel: { params: { sendId: string }; result: void }
  'cookies.list': { params: { cookieFile: string }; result: CookieInfo[] }
  'cookies.delete': { params: { cookieFile: string; domain: string; path?: string; key?: string }; result: void }
  'cookies.set': { params: { cookieFile: string; url: string; cookie: string }; result: void }
  run: { params: { runId: string; spec: RunnerSpec }; result: RunnerOutcome }
  runStop: { params: { runId: string }; result: void }
}
export type EngineMethod = keyof EngineMethods

export type ToEngine =
  | { type: 'call'; id: string; method: EngineMethod; params: unknown }
  | { type: 'proxyReply'; id: string; proxy: ProxyJson | null }

export type FromEngine =
  | { type: 'reply'; id: string; result?: unknown; error?: string }
  | { type: 'proxy'; id: string; url: string }
  /** Streamed while a collection run is in progress. */
  | { type: 'runItem'; runId: string; item: RunnerItemResult }

// --- Capture proxy ---

export interface CaptureFilter {
  includeHosts: string[]
  excludeHosts: string[]
  methods: string[]
}

export interface CapturedExchange {
  id: number
  ts: number
  method: string
  url: string
  tunnel: boolean
  requestHeaders: { key: string; value: string }[]
  requestBody: string
  status?: number
  responseHeaders: { key: string; value: string }[]
  responseBody: string
  bodyTruncated: boolean
  timeMs: number
  error?: string
}

export interface UpstreamProxy {
  host: string
  port: number
  auth?: string
}

export type ProxyMethods = {
  start: { params: { port: number; decrypt: boolean; ca: { cert: string; key: string }; filter: CaptureFilter; extraCa?: string }; result: { port: number } }
  stop: { params: Record<string, never>; result: void }
  setFilter: { params: { filter: CaptureFilter }; result: void }
}
export type ToProxy = { type: 'call'; id: string; method: keyof ProxyMethods; params: unknown } | { type: 'upstreamReply'; id: string; upstream: UpstreamProxy | null }
export type FromProxy =
  | { type: 'reply'; id: string; result?: unknown; error?: string }
  | { type: 'capture'; exchange: CapturedExchange }
  | { type: 'upstream'; id: string; url: string }

// --- Load testing ---

export interface LoadSpec {
  collection: Record<string, unknown>
  environment?: { name: string; values: PmVariable[] }
  globals: PmVariable[]
  data: Record<string, unknown>[]
  profile: import('../loadtest/profile').LoadProfile
  cookieFile: string
  workingDir: string
  options: EngineOptions
}

export type LoadMethods = {
  start: { params: { runId: string; spec: LoadSpec }; result: import('../loadtest/metrics').LoadSummary }
  stop: { params: { runId: string }; result: void }
}
export type ToLoad = { type: 'call'; id: string; method: keyof LoadMethods; params: unknown } | { type: 'proxyReply'; id: string; proxy: ProxyJson | null }
export type FromLoad =
  | { type: 'reply'; id: string; result?: unknown; error?: string }
  | { type: 'tick'; runId: string; tick: import('../loadtest/metrics').Tick }
  | { type: 'proxy'; id: string; url: string }
