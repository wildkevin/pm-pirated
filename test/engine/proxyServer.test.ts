import http from 'node:http'
import https from 'node:https'
import tls from 'node:tls'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { LeafFactory, createCa } from '../../src/proxy/certs'
import { shouldRecord, startCaptureProxy, type CapturedExchange, type RunningProxy, type Upstream } from '../../src/proxy/server'

const allFilter = { includeHosts: [], excludeHosts: [], methods: [] }
const ca = createCa()
// The "real" HTTPS server uses a certificate from a different CA, trusted via extraCa.
const serverCa = createCa('Test Server CA')
const serverCert = new LeafFactory(serverCa).forHost('127.0.0.1')

let httpBase: string
let httpsPort: number
let plain: http.Server
let secure: https.Server
const proxies: RunningProxy[] = []

beforeAll(async () => {
  const handler = (req: http.IncomingMessage, res: http.ServerResponse) => {
    let body = ''
    req.on('data', (d) => (body += d))
    req.on('end', () => {
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify({ method: req.method, url: req.url, body, secret: req.headers['x-secret'] ?? null }))
    })
  }
  plain = http.createServer(handler)
  secure = https.createServer({ cert: serverCert.cert, key: serverCert.key }, handler)
  await new Promise<void>((r) => plain.listen(0, '127.0.0.1', r))
  await new Promise<void>((r) => secure.listen(0, '127.0.0.1', r))
  httpBase = `http://127.0.0.1:${(plain.address() as AddressInfo).port}`
  httpsPort = (secure.address() as AddressInfo).port
})
afterAll(async () => {
  for (const p of proxies) await p.close()
  plain.closeAllConnections()
  plain.close()
  secure.closeAllConnections()
  secure.close()
})

async function proxy(decrypt: boolean, upstream: Upstream | null = null) {
  const captured: CapturedExchange[] = []
  const p = await startCaptureProxy(
    { port: 0, decrypt, ca, filter: allFilter, extraCa: serverCa.cert },
    { resolveUpstream: async () => upstream, onCapture: (e) => captured.push(e) },
  )
  proxies.push(p)
  return { p, captured }
}

/** HTTP request through the proxy (absolute-form). */
function viaProxy(port: number, url: string, body?: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method: body ? 'POST' : 'GET', path: url, headers: { Host: new URL(url).host, 'X-Secret': 's1' } }, (res) => {
      let b = ''
      res.on('data', (d) => (b += d))
      res.on('end', () => resolve({ status: res.statusCode!, body: b }))
    })
    req.on('error', reject)
    req.end(body)
  })
}

/** HTTPS request through the proxy via CONNECT, trusting `trust` as root. */
function httpsViaProxy(port: number, path: string, trust: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const connect = http.request({ host: '127.0.0.1', port, method: 'CONNECT', path: `127.0.0.1:${httpsPort}` })
    connect.on('connect', (_res, socket) => {
      const req = https.request({ host: '127.0.0.1', port: httpsPort, path, method: 'GET', createConnection: () => tls.connect({ socket, host: '127.0.0.1', ca: trust }) }, (res) => {
        let b = ''
        res.on('data', (d) => (b += d))
        res.on('end', () => resolve({ status: res.statusCode!, body: b }))
      })
      req.on('error', reject)
      req.end()
    })
    connect.on('error', reject)
    connect.end()
  })
}

describe('capture proxy', () => {
  it('forwards and records plain HTTP, including bodies and headers', async () => {
    const { p, captured } = await proxy(false)
    const r = await viaProxy(p.port, `${httpBase}/items?q=1`, '{"a":1}')
    expect(JSON.parse(r.body)).toMatchObject({ method: 'POST', url: '/items?q=1', body: '{"a":1}', secret: 's1' })
    expect(captured).toHaveLength(1)
    expect(captured[0]).toMatchObject({ method: 'POST', url: `${httpBase}/items?q=1`, status: 200, requestBody: '{"a":1}', tunnel: false })
    expect(captured[0].responseBody).toContain('"url":"/items?q=1"')
  })

  it('preserves literal braces in direct and chained request paths', async () => {
    const upstream = await proxy(false)
    const chained = await proxy(false, { host: '127.0.0.1', port: upstream.p.port })
    for (const current of [upstream, chained]) {
      const path = '/literal/{{token}}?q={{key}}'
      const response = await viaProxy(current.p.port, httpBase + path)
      expect(JSON.parse(response.body).url).toBe(path)
      expect(current.captured.at(-1)?.url).toBe(httpBase + path)
    }
  })

  it('tunnels HTTPS untouched when decryption is off (only the host is recorded)', async () => {
    const { p, captured } = await proxy(false)
    const r = await httpsViaProxy(p.port, '/t', serverCa.cert) // client sees the real server certificate
    expect(JSON.parse(r.body).url).toBe('/t')
    expect(captured).toMatchObject([{ method: 'CONNECT', url: `https://127.0.0.1:${httpsPort}`, tunnel: true }])
  })

  it('decrypts HTTPS with the app CA and records the full exchange', async () => {
    const { p, captured } = await proxy(true)
    const r = await httpsViaProxy(p.port, '/secure?x=1', ca.cert) // client must trust the PM Local CA
    expect(JSON.parse(r.body).url).toBe('/secure?x=1')
    await new Promise((r) => setTimeout(r, 50))
    expect(captured).toHaveLength(1)
    expect(captured[0]).toMatchObject({ method: 'GET', url: `https://127.0.0.1:${httpsPort}/secure?x=1`, status: 200, tunnel: false })
  })

  it('chains through an upstream proxy for HTTP and HTTPS', async () => {
    const upstreamProxy = await proxy(false)
    const { p } = await proxy(true, { host: '127.0.0.1', port: upstreamProxy.p.port })
    expect(JSON.parse((await viaProxy(p.port, `${httpBase}/up`)).body).url).toBe('/up')
    expect(JSON.parse((await httpsViaProxy(p.port, '/up-s', ca.cert)).body).url).toBe('/up-s')
    expect(upstreamProxy.captured.map((c) => c.method)).toEqual(['GET', 'CONNECT'])
  })

  it('reports unreachable servers as 502 and records the error', async () => {
    const { p, captured } = await proxy(false)
    const r = await viaProxy(p.port, 'http://127.0.0.1:1/x')
    expect(r.status).toBe(502)
    expect(captured[0].error).toMatch(/ECONNREFUSED/)
  })
})

describe('capture filter', () => {
  it('includes, excludes and filters methods', () => {
    const f = { includeHosts: ['*.corp.test', 'api.example'], excludeHosts: ['telemetry'], methods: [] }
    expect(shouldRecord(f, 'GET', 'svc.corp.test')).toBe(true)
    expect(shouldRecord(f, 'GET', 'api.example.com')).toBe(true)
    expect(shouldRecord(f, 'GET', 'telemetry.corp.test')).toBe(false)
    expect(shouldRecord(f, 'GET', 'google.com')).toBe(false)
    expect(shouldRecord({ ...allFilter, methods: ['POST'] }, 'GET', 'a')).toBe(false)
    expect(shouldRecord(allFilter, 'GET', 'anything')).toBe(true)
  })
})
