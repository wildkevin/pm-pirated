import runtime from 'postman-runtime'
import { CertificateList, Collection, ProxyConfig, ProxyConfigList, Url, VariableScope } from 'postman-collection'
import * as fs from 'node:fs'
import { isAbsolute, resolve } from 'node:path'
import { inspect } from 'node:util'
import { rawUrl } from '../shared/format/url'
import type { PmContainer, PmItem, PmUrl, PmVariable } from '../shared/format/types'
import type {
  EngineOptions,
  LogEntry,
  ProxyJson,
  RunReport,
  SendOutcome,
  SendResult,
  SendSpec,
  SentRequest,
  TestResult,
} from '../shared/engine'
import { cookiesForUrl, jarFor, saveJar } from './cookies'

export interface SendHandle {
  result: Promise<SendOutcome>
  cancel(): void
}

export interface SendDeps {
  /** Resolves the OS proxy for a URL (main process asks Electron); null = direct. */
  resolveSystemProxy?(url: string): Promise<ProxyJson | null>
}

/** Like Postman: a URL typed without a scheme is sent over http. */
export function ensureProtocol(url: string): string {
  const u = url.trim()
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(u) || u.startsWith('{{') ? u : `http://${u}`
}

/** Our stored URL (string or {raw, query, variable}) → what postman-collection expects. */
function toRuntimeUrl(url: PmUrl): unknown {
  const raw = ensureProtocol(rawUrl(url))
  if (typeof url === 'string') return raw
  return {
    ...Url.parse(raw),
    raw,
    ...(url.query ? { query: url.query } : {}),
    ...(url.variable ? { variable: url.variable } : {}),
  }
}

/** Nest the request inside its collection/folder chain so auth, scripts and variables inherit. */
export function buildCollection(item: PmItem, parents: PmContainer[]): Record<string, unknown> {
  const request = { ...item, request: { ...item.request, url: toRuntimeUrl(item.request.url) } }
  let node: Record<string, unknown> = request
  for (let i = parents.length - 1; i >= 1; i--) {
    const { name, auth, event, description } = parents[i]
    node = { name, auth, event, description, item: [node] }
  }
  const root = parents[0] ?? { name: 'Request' }
  return { info: { name: root.name }, auth: root.auth, event: root.event, variable: root.variable ?? [], item: [node] }
}

const toVars = (scope: { values: { toJSON(): { key: string; value: unknown; type?: string; disabled?: boolean }[] } }) =>
  scope.values.toJSON().map(
    // Types are not echoed back: main re-applies them (e.g. 'secret') from the workspace files.
    (v): PmVariable => ({ key: v.key, value: v.value == null ? '' : String(v.value), ...(v.disabled ? { disabled: true } : {}) }),
  )

function formatArg(a: unknown): string {
  return typeof a === 'string' ? a : inspect(a, { depth: 6, breakLength: 120 })
}

/** fs whose path arguments are resolved against the workspace, for form-data/binary file bodies. */
function fileResolver(workingDir: string): unknown {
  return new Proxy(fs, {
    get(target, prop) {
      const value = (target as unknown as Record<string | symbol, unknown>)[prop]
      if (typeof value !== 'function') return value
      return (p: unknown, ...rest: unknown[]) =>
        (value as (...a: unknown[]) => unknown).call(target, typeof p === 'string' && !isAbsolute(p) ? resolve(workingDir, p) : p, ...rest)
    },
  })
}

function proxyList(o: EngineOptions): unknown {
  const p = o.customProxy
  if (!p || !p.host) return undefined
  const match = `${p.protocols.join('+')}://*/*`
  return new ProxyConfigList({}, [
    {
      match,
      host: p.host,
      port: p.port,
      tunnel: false,
      bypass: p.bypass,
      ...(p.username ? { authenticate: true, username: p.username, password: p.password ?? '' } : {}),
    },
  ])
}

function certificateList(o: EngineOptions): unknown {
  if (!o.clientCerts.length) return undefined
  return new CertificateList(
    {},
    o.clientCerts.map((c) => ({
      matches: [`https://${c.host.includes(':') ? c.host : `${c.host}:*`}/*`],
      ...(c.cert ? { cert: { src: c.cert } } : {}),
      ...(c.key ? { key: { src: c.key } } : {}),
      ...(c.pfx ? { pfx: { src: c.pfx } } : {}),
      ...(c.passphrase ? { passphrase: c.passphrase } : {}),
    })),
  )
}

function toResult(res: any): SendResult {
  const body: Buffer = res.stream ?? Buffer.alloc(0)
  return {
    ok: true,
    code: res.code,
    status: res.status,
    headers: res.headers.all().map((h: { key: string; value: string }) => ({ key: h.key, value: h.value })),
    body: new Uint8Array(body),
    size: res.size().total,
    timeMs: res.responseTime,
  }
}

function toSent(request: any): SentRequest {
  const body = request.body
  let text: string | undefined
  if (body && !body.isEmpty?.()) {
    if (body.mode === 'raw') text = String(body.raw ?? '')
    else if (body.mode === 'graphql') text = JSON.stringify(body.graphql ?? {})
    else if (body.mode === 'urlencoded' || body.mode === 'formdata')
      text = (body[body.mode]?.all?.() ?? [])
        .filter((p: any) => !p.disabled)
        .map((p: any) => `${p.key}=${p.type === 'file' ? `<file ${p.src}>` : p.value}`)
        .join('&')
    else if (body.mode === 'file') text = `<file ${body.file?.src ?? ''}>`
  }
  return {
    method: request.method,
    url: request.url.toString(),
    headers: request.headers.all().map((h: any) => ({ key: h.key, value: String(h.value) })),
    ...(text !== undefined ? { body: text } : {}),
  }
}

export function startSend(spec: SendSpec, deps: SendDeps = {}): SendHandle {
  let resolveResult!: (r: SendOutcome) => void
  const result = new Promise<SendOutcome>((r) => (resolveResult = r))
  const report: RunReport = { response: { ok: false, error: 'No response received' }, tests: [], logs: [], scriptErrors: [], cookies: [] }
  const environment = spec.environment ? new VariableScope({ name: spec.environment.name, values: spec.environment.values }) : undefined
  const globals = new VariableScope({ values: spec.globals })
  let collectionVariables: PmVariable[] = spec.parents[0]?.variable ?? []
  let settled = false
  const finish = () => {
    if (settled) return
    settled = true
    if (report.sent) report.cookies = cookiesForUrl(spec.cookieFile, report.sent.url)
    resolveResult({
      report,
      variables: { ...(environment ? { environment: toVars(environment) } : {}), globals: toVars(globals), collection: collectionVariables },
    })
  }
  let run: { abort(): void } | undefined
  let cancelled = false

  if (!rawUrl(spec.item.request.url).trim()) {
    report.response = { ok: false, error: 'Enter a URL' }
    finish()
    return { result, cancel: () => undefined }
  }

  const o = spec.options
  const collection = new Collection(buildCollection(spec.item, spec.parents))
  const runOptions: Record<string, unknown> = {
    environment,
    globals,
    timeout: { request: o.timeoutMs },
    fileResolver: fileResolver(spec.workingDir),
    ignoreProxyEnvironmentVariables: !o.respectProxyEnv,
    proxies: proxyList(o),
    certificates: certificateList(o),
    requester: {
      cookieJar: jarFor(spec.cookieFile),
      strictSSL: o.strictSSL,
      followRedirects: o.followRedirects,
      implicitTraceHeader: o.sendPostmanToken,
      ...(o.maxResponseSizeMb > 0 ? { maxResponseSize: o.maxResponseSizeMb * 1024 * 1024 } : {}),
      ...(o.extraCaFile ? { extendedRootCA: o.extraCaFile } : {}),
    },
  }
  if (o.useSystemProxy && deps.resolveSystemProxy) {
    const ask = deps.resolveSystemProxy
    runOptions.systemProxy = (url: unknown, cb: (err: Error | null, proxy?: unknown) => void) => {
      ask(String(url)).then(
        (p) => cb(null, p ? new ProxyConfig({ match: '<all_urls>', ...p }) : undefined),
        () => cb(null, undefined),
      )
    }
  }

  const scriptResult = (results: any[] | undefined) => {
    for (const r of results ?? []) {
      if (r?.error) report.scriptErrors.push(r.error.message ?? String(r.error))
      const cv = r?.result?.collectionVariables
      if (cv?.values) collectionVariables = toVars(new VariableScope(cv))
    }
  }

  new runtime.Runner().run(collection, runOptions, (err, r) => {
    if (err) {
      report.response = { ok: false, error: err.message }
      return finish()
    }
    if (cancelled) return finish()
    run = r
    r.start({
      console(cursor: { scriptId?: string } | undefined, level: LogEntry['level'], ...args: unknown[]) {
        report.logs.push({ level, args: args.map(formatArg) })
      },
      assertion(_cursor: unknown, assertions: any[]) {
        for (const a of assertions)
          report.tests.push({ name: a.name, passed: !!a.passed, skipped: !!a.skipped, ...(a.error ? { error: a.error.message } : {}) } satisfies TestResult)
      },
      prerequest(_err: unknown, _cursor: unknown, results: any[]) {
        scriptResult(results)
      },
      test(_err: unknown, _cursor: unknown, results: any[]) {
        scriptResult(results)
      },
      request(_err: unknown, _cursor: unknown, _response: unknown, request: any) {
        if (request) report.sent = toSent(request)
      },
      response(err: NodeJS.ErrnoException | null, _cursor: unknown, res: unknown) {
        report.response = err ? { ok: false, error: err.message, code: err.code } : toResult(res)
      },
      done(err: Error | null) {
        if (err) report.response = { ok: false, error: err.message }
        saveJar(spec.cookieFile)
        finish()
      },
    })
  })

  return {
    result,
    cancel() {
      cancelled = true
      run?.abort()
      report.response = { ok: false, error: 'Request cancelled' }
      finish()
    },
  }
}
