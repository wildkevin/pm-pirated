// Capture proxy: forwards HTTP, tunnels or (optionally) decrypts HTTPS, and records each exchange.
import http from 'node:http'
import https from 'node:https'
import net from 'node:net'
import tls from 'node:tls'
import type { AddressInfo } from 'node:net'
import type { CaptureFilter, CapturedExchange, UpstreamProxy } from '../shared/engine'
import { LeafFactory, type Pem } from './certs'

/** Bodies kept per captured exchange. */
const MAX_CAPTURE = 1024 * 1024

export type Upstream = UpstreamProxy
export type { CaptureFilter, CapturedExchange }

export interface ProxyConfig {
  port: number
  decrypt: boolean
  ca: Pem
  filter: CaptureFilter
  /** PEM bundle trusted when talking to real servers (corporate CAs), in addition to Node's. */
  extraCa?: string
  /** For tests: trust any upstream certificate. */
  insecureUpstream?: boolean
}

export interface ProxyDeps {
  resolveUpstream(url: string): Promise<Upstream | null>
  onCapture(e: CapturedExchange): void
}

export interface RunningProxy {
  port: number
  setFilter(f: CaptureFilter): void
  close(): Promise<void>
}

const globMatch = (pattern: string, host: string) => {
  const p = pattern.trim().toLowerCase()
  if (!p) return false
  if (!p.includes('*')) return host.includes(p)
  return new RegExp(`^${p.split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`).test(host)
}

export function shouldRecord(f: CaptureFilter, method: string, host: string): boolean {
  const h = host.toLowerCase()
  if (f.includeHosts.some((x) => x.trim()) && !f.includeHosts.some((p) => globMatch(p, h))) return false
  if (f.excludeHosts.some((p) => globMatch(p, h))) return false
  if (f.methods.length && !f.methods.includes(method.toUpperCase())) return false
  return true
}

const toList = (h: http.IncomingHttpHeaders) =>
  Object.entries(h).flatMap(([key, v]) => (Array.isArray(v) ? v.map((value) => ({ key, value })) : v === undefined ? [] : [{ key, value: String(v) }]))

/** Collects up to MAX_CAPTURE bytes of a stream without changing what flows through it. */
function tap() {
  const chunks: Buffer[] = []
  let size = 0
  let truncated = false
  return {
    push(d: Buffer) {
      if (size >= MAX_CAPTURE) return void (truncated = true)
      const take = d.subarray(0, MAX_CAPTURE - size)
      chunks.push(take)
      size += take.length
      if (take.length < d.length) truncated = true
    },
    text: () => Buffer.concat(chunks).toString('utf8'),
    truncated: () => truncated,
  }
}

const HOP_BY_HOP = /^(proxy-connection|proxy-authorization|connection|keep-alive|te|trailer|upgrade)$/i

/** Opens a TCP connection to host:port, through an upstream proxy's CONNECT if there is one. */
function connectThrough(upstream: Upstream | null, host: string, port: number): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    if (!upstream) {
      const s = net.connect(port, host, () => resolve(s))
      s.once('error', reject)
      return
    }
    const req = http.request({
      host: upstream.host,
      port: upstream.port,
      method: 'CONNECT',
      path: `${host}:${port}`,
      headers: { Host: `${host}:${port}`, ...(upstream.auth ? { 'Proxy-Authorization': `Basic ${Buffer.from(upstream.auth).toString('base64')}` } : {}) },
    })
    req.once('connect', (res, socket) => {
      if (res.statusCode === 200) resolve(socket)
      else {
        socket.destroy()
        reject(new Error(`Upstream proxy refused CONNECT: ${res.statusCode}`))
      }
    })
    req.once('error', reject)
    req.end()
  })
}

export function startCaptureProxy(config: ProxyConfig, deps: ProxyDeps): Promise<RunningProxy> {
  let filter = config.filter
  let seq = 0
  const leaves = new LeafFactory(config.ca)
  const sockets = new Set<net.Socket>()
  const ca = config.extraCa ? [...tls.rootCertificates, config.extraCa] : undefined

  /** Forwards one (plain or decrypted) request to the real server and records it. */
  async function forward(req: http.IncomingMessage, res: http.ServerResponse, target: URL) {
    // URL parses the authority safely; keep the original request-target bytes for forwarding.
    const incoming = req.url ?? '/'
    const path = incoming.startsWith('/') ? incoming : incoming.replace(/^[a-z][a-z0-9+.-]*:\/\/[^/?#]+/i, '') || '/'
    const wirePath = path.startsWith('?') ? '/' + path : path
    const wireUrl = target.origin + wirePath
    const started = Date.now()
    const record = shouldRecord(filter, req.method ?? 'GET', target.hostname)
    const reqTap = tap()
    const resTap = tap()
    const exchange: CapturedExchange = {
      id: ++seq,
      ts: started,
      method: req.method ?? 'GET',
      url: wireUrl,
      tunnel: false,
      requestHeaders: toList(req.headers).filter((h) => !HOP_BY_HOP.test(h.key)),
      requestBody: '',
      responseHeaders: [],
      responseBody: '',
      bodyTruncated: false,
      timeMs: 0,
    }
    const done = (error?: string) => {
      if (!record) return
      exchange.requestBody = reqTap.text()
      exchange.responseBody = resTap.text()
      exchange.bodyTruncated = reqTap.truncated() || resTap.truncated()
      exchange.timeMs = Date.now() - started
      if (error) exchange.error = error
      deps.onCapture(exchange)
    }
    const headers = Object.fromEntries(Object.entries(req.headers).filter(([k]) => !HOP_BY_HOP.test(k)))
    const secure = target.protocol === 'https:'
    const port = Number(target.port) || (secure ? 443 : 80)
    let upstream: Upstream | null = null
    try {
      upstream = await deps.resolveUpstream(target.toString())
    } catch {
      upstream = null
    }

    const onResponse = (up: http.IncomingMessage) => {
      exchange.status = up.statusCode
      exchange.responseHeaders = toList(up.headers)
      res.writeHead(up.statusCode ?? 502, up.statusMessage, Object.fromEntries(Object.entries(up.headers).filter(([k]) => !HOP_BY_HOP.test(k))))
      up.on('data', (d: Buffer) => resTap.push(d))
      up.pipe(res)
      up.on('end', () => done())
    }
    const onError = (e: Error) => {
      if (!res.headersSent) res.writeHead(502, { 'Content-Type': 'text/plain' })
      res.end(`PM Local capture proxy could not reach ${target.host}: ${e.message}`)
      done(e.message)
    }

    let upReq: http.ClientRequest
    if (!secure && upstream) {
      // Plain HTTP through an upstream proxy: absolute-form request line.
      upReq = http.request({
        host: upstream.host,
        port: upstream.port,
        method: req.method,
        path: wireUrl,
        headers: { ...headers, ...(upstream.auth ? { 'Proxy-Authorization': `Basic ${Buffer.from(upstream.auth).toString('base64')}` } : {}) },
      })
    } else if (!secure) {
      upReq = http.request({ host: target.hostname, port, method: req.method, path: wirePath, headers })
    } else {
      const socket = upstream ? await connectThrough(upstream, target.hostname, port).catch((e: Error) => (onError(e), null)) : undefined
      if (socket === null) return
      upReq = https.request({
        host: target.hostname,
        port,
        method: req.method,
        path: wirePath,
        headers,
        servername: net.isIP(target.hostname) ? undefined : target.hostname,
        ca,
        rejectUnauthorized: !config.insecureUpstream,
        // createConnection is only honoured without an agent (agent: false would silently bypass it).
        ...(socket
          ? {
              createConnection: () =>
                tls.connect({ socket, host: target.hostname, ...(net.isIP(target.hostname) ? {} : { servername: target.hostname }), ca, rejectUnauthorized: !config.insecureUpstream }),
            }
          : { agent: false }),
      })
    }
    upReq.on('response', onResponse)
    upReq.on('error', onError)
    req.on('data', (d: Buffer) => reqTap.push(d))
    req.pipe(upReq)
  }

  // Decrypted HTTPS requests arrive here (never listening on a port itself).
  const inner = http.createServer((req, res) => {
    const host = (req.socket as tls.TLSSocket & { pmTarget?: string }).pmTarget ?? req.headers.host ?? ''
    void forward(req, res, new URL(req.url ?? '/', `https://${host}`))
  })

  const server = http.createServer((req, res) => {
    let target: URL
    try {
      target = new URL(req.url ?? '')
      if (target.protocol !== 'http:') throw new Error('not http')
    } catch {
      res.writeHead(400, { 'Content-Type': 'text/plain' })
      return void res.end('This is the PM Local capture proxy. Configure it as an HTTP proxy.')
    }
    void forward(req, res, target)
  })

  server.on('connect', (req: http.IncomingMessage, client: net.Socket, head: Buffer) => {
    const [host, portText] = (req.url ?? '').split(/:(?=\d+$)/)
    const port = Number(portText) || 443
    client.on('error', () => undefined)
    if (config.decrypt && shouldRecord(filter, 'CONNECT', host)) {
      client.write('HTTP/1.1 200 Connection Established\r\n\r\n')
      const { cert, key } = leaves.forHost(host)
      const secure = new tls.TLSSocket(client, { isServer: true, cert, key, ALPNProtocols: ['http/1.1'] }) as tls.TLSSocket & { pmTarget?: string }
      secure.pmTarget = port === 443 ? host : `${host}:${port}`
      secure.on('error', () => client.destroy())
      if (head.length) client.unshift(head)
      inner.emit('connection', secure)
      return
    }
    // Plain tunnel: only the host is visible.
    const started = Date.now()
    void deps
      .resolveUpstream(`https://${host}:${port}/`)
      .catch(() => null)
      .then((upstream) => connectThrough(upstream, host, port))
      .then(
        (remote) => {
          client.write('HTTP/1.1 200 Connection Established\r\n\r\n')
          if (head.length) remote.write(head)
          remote.pipe(client)
          client.pipe(remote)
          remote.on('error', () => client.destroy())
          if (shouldRecord(filter, 'CONNECT', host))
            deps.onCapture({
              id: ++seq,
              ts: started,
              method: 'CONNECT',
              url: `https://${host}:${port}`,
              tunnel: true,
              requestHeaders: [],
              requestBody: '',
              responseHeaders: [],
              responseBody: '',
              bodyTruncated: false,
              timeMs: Date.now() - started,
            })
        },
        (e: Error) => {
          client.end(`HTTP/1.1 502 Bad Gateway\r\nContent-Type: text/plain\r\n\r\n${e.message}`)
        },
      )
  })

  server.on('connection', (s) => {
    sockets.add(s)
    s.on('close', () => sockets.delete(s))
  })

  return new Promise((resolve, reject) => {
    server.once('error', (e: NodeJS.ErrnoException) =>
      reject(new Error(e.code === 'EADDRINUSE' ? `Port ${config.port} is already in use` : e.message)),
    )
    // Capture proxy is for this computer only.
    server.listen(config.port, '127.0.0.1', () => {
      resolve({
        port: (server.address() as AddressInfo).port,
        setFilter: (f) => (filter = f),
        close: () =>
          new Promise((r) => {
            for (const s of sockets) s.destroy()
            server.close(() => r())
          }),
      })
    })
  })
}
