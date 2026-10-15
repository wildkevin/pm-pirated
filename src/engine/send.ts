import runtime from 'postman-runtime'
import { CertificateList, Collection, ProxyConfig, ProxyConfigList, Url, VariableScope } from 'postman-collection'
import { randomUUID } from 'node:crypto'
import * as fs from 'node:fs'
import { isAbsolute, relative, resolve } from 'node:path'
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
export function toRuntimeUrl(url: PmUrl): unknown {
  const raw = ensureProtocol(rawUrl(url))
  if (typeof url === 'string') return raw
  return {
    ...Url.parse(raw),
    raw,
    // The visible raw URL contains only enabled params, preserving flag versus empty=.
    query: Url.parse(raw).query,
    ...(url.variable ? { variable: url.variable } : {}),
  }
}

/** Nest the request inside its collection/folder chain so auth, scripts and variables inherit. */
export function buildCollection(item: PmItem, parents: PmContainer[]): Record<string, unknown> {
  const request = { ...item, protocolProfileBehavior: { ...item.protocolProfileBehavior, disableBodyPruning: item.protocolProfileBehavior?.disableBodyPruning ?? true }, request: { ...item.request, url: toRuntimeUrl(item.request.url) } }
  let node: Record<string, unknown> = request
  for (let i = parents.length - 1; i >= 1; i--) {
    const { name, auth, event, description } = parents[i]
    node = { name, auth, event, description, item: [node] }
  }
  const root = parents[0] ?? { name: 'Request' }
  return { info: { name: root.name }, auth: root.auth, event: root.event, variable: root.variable ?? [], item: [node] }
}

export const toVars = (scope: { values: { toJSON(): { key: string; value: unknown; type?: string; disabled?: boolean }[] } }) =>
  scope.values.toJSON().map(
    // Types are not echoed back: main re-applies them (e.g. 'secret') from the workspace files.
    (v): PmVariable => ({ key: v.key, value: v.value == null ? '' : String(v.value), ...(v.disabled ? { disabled: true } : {}) }),
  )

export function formatArg(a: unknown): string {
  return typeof a === 'string' ? a : inspect(a, { depth: 6, breakLength: 120 })
}

/**
 * fs for request files: relative paths resolve against the workspace. Like Postman, files outside
 * it are refused unless the user allowed that in Settings (a shared collection must not be able to
 * upload ~/.ssh/id_rsa). Certificates configured in Settings are reachable only through `privateFiles`,
 * whose names are random per send, so a request body cannot name them.
 */
export function fileResolver(workingDir: string, allowOutside: boolean, privateFiles: Map<string, string> = new Map(), onError?: (error: Error) => void): unknown {
  const root = realOrSelf(workingDir)
  const check = (p: string): string => {
    const configured = privateFiles.get(p)
    if (configured) return configured
    const abs = resolve(workingDir, p)
    if (allowOutside) return abs
    const rel = relative(root, realOrSelf(abs))
    if (rel.startsWith('..') || isAbsolute(rel))
      throw new Error(`Reading ${p} is blocked: it is outside the workspace folder (Settings > General > Allow reading files outside working directory)`)
    return abs
  }
  return new Proxy(fs, {
    get(target, prop) {
      const value = (target as unknown as Record<string | symbol, unknown>)[prop]
      if (typeof value !== 'function') return value
      return (p: unknown, ...rest: unknown[]) => {
        if (typeof p !== 'string') return (value as (...a: unknown[]) => unknown).call(target, p, ...rest)
        let abs: string
        try {
          abs = check(p)
        } catch (e) {
          onError?.(e as Error)
          const cb = rest.at(-1)
          if (typeof cb === 'function') return void cb(e)
          throw e
        }
        const cb = rest.at(-1)
        if (typeof cb === 'function') rest[rest.length - 1] = (error: Error | null, ...args: unknown[]) => { if (error) onError?.(error); cb(error, ...args) }
        try { return (value as (...a: unknown[]) => unknown).call(target, abs, ...rest) }
        catch (error) { onError?.(error as Error); throw error }
      }
    },
  })
}

function realOrSelf(p: string): string {
  try {
    return fs.realpathSync(p)
  } catch {
    return p
  }
}

function proxyList(o: EngineOptions): unknown {
  const p = o.customProxy
  if (!p || !p.host) return undefined
  // Patterns need `:*` to match URLs with an explicit port (`*` alone only matches default ports).
  const match = `${p.protocols.join('+')}://*:*/*`
  // Settings hold plain host names (`api.corp`, `*.internal`); the SDK wants URL match patterns.
  const bypass = p.bypass.map((h) => (h.includes('://') ? h : `http+https://${h}:*/*`))
  return new ProxyConfigList({}, [
    {
      match,
      host: p.host,
      port: p.port,
      tunnel: false,
      bypass,
      ...(p.username ? { authenticate: true, username: p.username, password: p.password ?? '' } : {}),
    },
  ])
}

function certificateList(o: EngineOptions, privateName: (real: string) => string): unknown {
  if (!o.clientCerts.length) return undefined
  return new CertificateList(
    {},
    o.clientCerts.map((c) => ({
      matches: [`https://${c.host.includes(':') ? c.host : `${c.host}:*`}/*`],
      ...(c.cert ? { cert: { src: privateName(c.cert) } } : {}),
      ...(c.key ? { key: { src: privateName(c.key) } } : {}),
      ...(c.pfx ? { pfx: { src: privateName(c.pfx) } } : {}),
      ...(c.passphrase ? { passphrase: c.passphrase } : {}),
    })),
  )
}

export function toResult(res: any): SendResult {
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

export function toSent(request: any): SentRequest {
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


/** What a single send and a collection run share: scopes, network, files and cookies. */
export interface RunContext {
  cookieFile: string
  workingDir: string
  options: EngineOptions
}

export function runtimeOptions(
  ctx: RunContext,
  scopes: { environment?: unknown; globals: unknown },
  deps: SendDeps,
  onFileError?: (error: Error) => void,
): Record<string, unknown> {
  const o = ctx.options
  const privateFiles = new Map<string, string>()
  const privatePrefix = `pmlocal-private-${randomUUID()}`
  const privateName = (real: string) => {
    const name = `${privatePrefix}/${privateFiles.size}`
    privateFiles.set(name, real)
    return name
  }
  const runOptions: Record<string, unknown> = {
    environment: scopes.environment,
    globals: scopes.globals,
    timeout: { request: o.timeoutMs },
    fileResolver: fileResolver(o.workingDirectory || ctx.workingDir, o.allowFilesOutsideWorkingDir, privateFiles, onFileError),
    ignoreProxyEnvironmentVariables: !o.respectProxyEnv,
    proxies: proxyList(o),
    certificates: certificateList(o, privateName),
    requester: {
      cookieJar: jarFor(ctx.cookieFile),
      disableCookies: o.disableCookies ?? false,
      protocolVersion: o.httpVersion ?? 'auto',
      implicitCacheControl: o.sendNoCache ?? true,
      ...(o.tlsKeyLogFile ? { sslKeyLogFile: o.tlsKeyLogFile } : {}),
      useWhatWGUrlParser: !!(ctx as Partial<SendSpec>).item?.protocolProfileBehavior?.disableUrlEncoding,
      strictSSL: o.strictSSL,
      followRedirects: o.followRedirects,
      implicitTraceHeader: o.sendPostmanToken,
      ...(o.maxResponseSizeMb > 0 ? { maxResponseSize: o.maxResponseSizeMb * 1024 * 1024 } : {}),
      ...(o.extraCaFile ? { extendedRootCA: privateName(o.extraCaFile) } : {}),
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
  return runOptions
}

export function startSend(spec: SendSpec, deps: SendDeps = {}): SendHandle {
  let resolveResult!: (r: SendOutcome) => void
  const result = new Promise<SendOutcome>((r) => (resolveResult = r))
  const report: RunReport = { response: { ok: false, error: 'No response received' }, tests: [], logs: [], scriptErrors: [], cookies: [], timeline: [] }
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

  const collection = new Collection(buildCollection(spec.item, spec.parents))
  let fileError: Error | undefined
  const runOptions = { ...runtimeOptions(spec, { environment, globals }, deps, error => { fileError = error }), stopOnError: true }

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
        const log = { level, args: args.map(formatArg) }
        report.logs.push(log)
        report.timeline!.push({ kind: 'log', log })
      },
      assertion(_cursor: unknown, assertions: any[]) {
        for (const a of assertions)
          report.tests.push({ name: a.name, passed: !!a.passed, skipped: !!a.skipped, ...(a.error ? { error: a.error.message } : {}) } satisfies TestResult)
      },
      prerequest(_err: unknown, _cursor: unknown, results: any[]) {
        scriptResult(results)
        if (report.scriptErrors.length) report.response = { ok: false, error: 'Before request script failed; request was not sent.' }
      },
      test(_err: unknown, _cursor: unknown, results: any[]) {
        scriptResult(results)
      },
      beforeRequest(_err: unknown, _cursor: unknown, request: any, _item: unknown, controls: { abort(): void }) {
        try {
          if (fileError) throw fileError
          const body = request.body
          if (!body?.disabled && body?.mode === 'graphql' && body.graphql?.variables?.trim()) {
            const parsed = JSON.parse(body.graphql.variables)
            if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') throw new Error('GraphQL variables must be a JSON object.')
          }
        } catch (error) {
          controls.abort()
          report.response = { ok: false, error: `Cannot send request body: ${error instanceof Error ? error.message : String(error)}` }
          finish()
        }
      },
      request(err: NodeJS.ErrnoException | null, _cursor: unknown, response: any, request: any) {
        if (request) {
          const sent = toSent(request)
          if (!(_cursor as { scriptId?: string })?.scriptId && spec.item.protocolProfileBehavior?.disableBodyPruning === false && /^(GET|HEAD)$/i.test(request.method)) delete sent.body
          report.timeline!.push({ kind: 'request', sent, response: err ? { ok: false, error: err.message, code: err.code } : toResult(response) })
        }
      },
      response(err: NodeJS.ErrnoException | null, cursor: { source?: string }, res: unknown, request: any) {
        if (cursor?.source) return // pm.sendRequest/auth calls have their own timeline row.
        if (request) {
          report.sent = toSent(request)
          if (spec.item.protocolProfileBehavior?.disableBodyPruning === false && /^(GET|HEAD)$/i.test(request.method)) delete report.sent.body
        }
        report.response = err ? { ok: false, error: err.message, code: err.code } : toResult(res)
      },
      done(err: Error | null) {
        if (err && !settled) report.response = { ok: false, error: err.message }
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
