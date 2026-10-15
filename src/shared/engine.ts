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
}
export type EngineMethod = keyof EngineMethods

export type ToEngine =
  | { type: 'call'; id: string; method: EngineMethod; params: unknown }
  | { type: 'proxyReply'; id: string; proxy: ProxyJson | null }

export type FromEngine =
  | { type: 'reply'; id: string; result?: unknown; error?: string }
  | { type: 'proxy'; id: string; url: string }
