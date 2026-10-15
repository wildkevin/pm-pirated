// Runs the capture proxy process and applies its results (History / collection) for the open workspace.
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { CaptureFilter, CapturedExchange, FromProxy, ProxyMethods, ToProxy, UpstreamProxy } from '../shared/engine'
import { stableStringify } from '../shared/format/stableJson'
import type { PmItem, RawLanguage } from '../shared/format/types'
import type { CaptureEvent, CaptureState } from '../shared/ipc'
import {
  enableSystemProxy,
  ensureCa,
  isCaTrusted,
  readBackup,
  restoreSystemProxy,
  trustCa,
  untrustCa,
  type Exec,
} from './capture'
import type { Crypt } from './crypto'
import { RpcClient, type ChildProcess } from './engineClient'
import { writeFileAtomic } from './workspace/fsAtomic'
import { appendHistory } from './workspace/history'
import { createRequest } from './workspace/store'
import { randomUUID } from 'node:crypto'

export const execNoShell: Exec = (file, args) =>
  new Promise((resolve) => {
    execFile(file, args, { windowsHide: true, timeout: 60_000 }, (err, stdout) => {
      const code = err ? (typeof (err as NodeJS.ErrnoException & { code?: unknown }).code === 'number' ? Number((err as { code: number }).code) : 1) : 0
      resolve({ code, stdout: String(stdout ?? '') })
    })
  })

export class ProxyClient extends RpcClient<ProxyMethods, ToProxy, FromProxy> {
  onCapture: (e: CapturedExchange) => void = () => undefined
  constructor(
    spawn: () => ChildProcess<ToProxy, FromProxy>,
    private resolveUpstream: (url: string) => Promise<UpstreamProxy | null>,
    onCrash?: (code: number) => void,
  ) {
    super(spawn as never, onCrash)
  }
  protected handle(m: FromProxy, p: ChildProcess<ToProxy | { type: 'call'; id: string; method: string; params: unknown }, unknown>): void {
    if (m.type === 'capture') return this.onCapture(m.exchange)
    if (m.type === 'upstream')
      void this.resolveUpstream(m.url)
        .catch(() => null)
        .then((upstream) => p.postMessage({ type: 'upstreamReply', id: m.id, upstream }))
  }
}

const HIDE_ON_SAVE = /^(host|content-length|connection|proxy-connection|accept-encoding)$/i

/**
 * Captured text is data, not a template: `{{x}}` in a captured URL would otherwise be filled with your
 * variables when re-sent (to a host a web page chose). Braces in the URL are percent-encoded (same
 * meaning for servers).
 */
const neutralizeUrl = (url: string) => url.replace(/\{\{/g, '%7B%7B').replace(/\}\}/g, '%7D%7D')
export const hasTemplate = (e: CapturedExchange) => e.requestBody.includes('{{') || e.requestHeaders.some((h) => h.value.includes('{{') || h.key.includes('{{'))

/** A captured exchange as a request item (like Postman's capture → collection). */
export function exchangeToItem(e: CapturedExchange): PmItem {
  const u = new URL(e.url)
  const type = e.requestHeaders.find((h) => h.key.toLowerCase() === 'content-type')?.value ?? ''
  const language: RawLanguage = /json/i.test(type) ? 'json' : /xml/i.test(type) ? 'xml' : /html/i.test(type) ? 'html' : 'text'
  return {
    name: `${e.method} ${u.pathname}`,
    request: {
      method: e.method,
      url: neutralizeUrl(e.url),
      header: e.requestHeaders.filter((h) => !HIDE_ON_SAVE.test(h.key)),
      ...(e.requestBody ? { body: { mode: 'raw' as const, raw: e.requestBody, options: { raw: { language } } } } : {}),
    },
    response: [],
  }
}

interface Persisted {
  port: number
  decrypt: boolean
  filter: CaptureFilter
  destination: string
}

export class CaptureManager {
  private state: CaptureState
  private root: string | null = null

  constructor(
    private client: ProxyClient,
    private dir: string,
    private crypt: Crypt,
    private emit: (e: CaptureEvent) => void,
    private exec: Exec = execNoShell,
    private platform: NodeJS.Platform = process.platform,
  ) {
    this.state = {
      running: false,
      port: 5555,
      decrypt: false,
      filter: { includeHosts: [], excludeHosts: [], methods: [] },
      destination: 'history',
      systemProxy: false,
      systemProxySupported: platform === 'win32',
      caTrusted: null,
    }
    client.onCapture = (e) => void this.captured(e)
  }

  private backupFile = () => join(this.dir, 'system-proxy-backup.json')
  private optionsFile = () => join(this.dir, 'capture.json')

  /** Startup: load options; undo a system-proxy change left behind by a crash. */
  async init(): Promise<void> {
    try {
      const p = JSON.parse(await readFile(this.optionsFile(), 'utf8')) as Persisted
      this.state = { ...this.state, ...p }
    } catch {
      // first run
    }
    if (this.platform === 'win32' && existsSync(this.backupFile())) await restoreSystemProxy(this.exec, this.backupFile())
  }

  /** The workspace whose History / collections receive captured requests. */
  setWorkspace(root: string | null) {
    this.root = root
  }

  /** The Windows proxy settings from before capture took over (for resolving the upstream). */
  previousSystemSettings() {
    return this.state.systemProxy ? readBackup(this.backupFile()) : Promise.resolve(null)
  }

  get port() {
    return this.state.port
  }

  private async persist() {
    const { port, decrypt, filter, destination } = this.state
    await writeFileAtomic(this.optionsFile(), stableStringify({ port, decrypt, filter, destination } satisfies Persisted)).catch(() => undefined)
  }

  private update(patch: Partial<CaptureState>): CaptureState {
    this.state = { ...this.state, ...patch }
    this.emit({ state: this.state })
    return this.state
  }

  async getState(): Promise<CaptureState> {
    const ca = await ensureCa(this.dir, this.crypt)
    const caTrusted = await isCaTrusted(this.exec, this.platform, ca.thumbprint, ca.certPath).catch(() => null)
    return this.update({ caTrusted })
  }

  async start(port: number, decrypt: boolean, extraCa?: string): Promise<CaptureState> {
    try {
      const ca = await ensureCa(this.dir, this.crypt)
      const r = await this.client.call('start', { port, decrypt, ca: { cert: ca.cert, key: ca.key }, filter: this.state.filter, extraCa })
      this.update({ running: true, port: r.port, decrypt, error: undefined })
    } catch (e) {
      this.update({ running: false, port, decrypt, error: (e as Error).message })
    }
    await this.persist()
    return this.state
  }

  async stop(): Promise<CaptureState> {
    if (this.state.systemProxy) await this.setSystemProxy(false)
    await this.client.call('stop', {}).catch(() => undefined)
    return this.update({ running: false })
  }

  async setOptions(filter: CaptureFilter, destination: string): Promise<CaptureState> {
    await this.client.call('setFilter', { filter }).catch(() => undefined)
    this.update({ filter, destination })
    await this.persist()
    return this.state
  }

  async setSystemProxy(on: boolean): Promise<CaptureState> {
    if (this.platform !== 'win32') return this.update({ error: 'Set the proxy in your system or browser settings: 127.0.0.1:' + this.state.port })
    if (on && !this.state.running) return this.update({ error: 'Start the proxy first' })
    try {
      if (on) await enableSystemProxy(this.exec, this.backupFile(), this.state.port)
      else await restoreSystemProxy(this.exec, this.backupFile())
      return this.update({ systemProxy: on, error: undefined })
    } catch (e) {
      return this.update({ error: `Could not change the system proxy: ${(e as Error).message}` })
    }
  }

  async trust(): Promise<CaptureState> {
    const ca = await ensureCa(this.dir, this.crypt)
    try {
      await trustCa(this.exec, this.platform, ca.certPath)
      this.update({ error: undefined })
    } catch (e) {
      this.update({ error: (e as Error).message })
    }
    return this.getState()
  }

  async untrust(): Promise<CaptureState> {
    const ca = await ensureCa(this.dir, this.crypt)
    await untrustCa(this.exec, this.platform, ca.thumbprint, ca.certPath).catch(() => undefined)
    return this.getState()
  }

  async caCertificate(): Promise<string> {
    return (await ensureCa(this.dir, this.crypt)).cert
  }

  /** On quit: give Windows its proxy settings back. */
  async shutdown(): Promise<void> {
    if (this.platform === 'win32' && existsSync(this.backupFile())) await restoreSystemProxy(this.exec, this.backupFile())
    this.client.dispose()
  }

  private async captured(e: CapturedExchange) {
    let savedTo: string | undefined
    const dest = this.state.destination
    // Headers/bodies with {{ }} are only saved when the user chooses to (see neutralizeUrl).
    if (this.root && !e.tunnel && !e.error && dest !== 'none' && !hasTemplate(e)) {
      const item = exchangeToItem(e)
      try {
        if (dest === 'history') {
          await appendHistory(this.root, { id: randomUUID(), ts: e.ts, name: e.url, item, ...(e.status ? { code: e.status, timeMs: e.timeMs } : {}) })
          savedTo = 'history'
        } else {
          await createRequest(this.root, dest, item.name, item)
          savedTo = dest
        }
      } catch {
        savedTo = undefined
      }
    }
    this.emit({ exchange: e, ...(savedTo ? { savedTo } : {}) })
  }
}
