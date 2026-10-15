import { mkdtemp } from 'node:fs/promises'
import http from 'node:http'
import https from 'node:https'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { resetJars } from '../../src/engine/cookies'
import { startSend } from '../../src/engine/send'
import { LeafFactory, createCa } from '../../src/proxy/certs'
import { startCaptureProxy, type CapturedExchange, type RunningProxy } from '../../src/proxy/server'
import type { EngineOptions, SendSpec } from '../../src/shared/engine'

// A real proxy (our capture proxy in pass-through mode) records what goes through it.
const seen: CapturedExchange[] = []
let proxy: RunningProxy
let httpBase: string
let httpsBase: string
let plain: http.Server
let secure: https.Server
const serverCa = createCa('Test CA')

beforeAll(async () => {
  const handler = (_q: http.IncomingMessage, r: http.ServerResponse) => r.end('ok')
  plain = http.createServer(handler)
  const cert = new LeafFactory(serverCa).forHost('127.0.0.1')
  secure = https.createServer({ cert: cert.cert, key: cert.key }, handler)
  await new Promise<void>((r) => plain.listen(0, '127.0.0.1', r))
  await new Promise<void>((r) => secure.listen(0, '127.0.0.1', r))
  httpBase = `http://127.0.0.1:${(plain.address() as AddressInfo).port}`
  httpsBase = `https://127.0.0.1:${(secure.address() as AddressInfo).port}`
  proxy = await startCaptureProxy(
    { port: 0, decrypt: false, ca: createCa(), filter: { includeHosts: [], excludeHosts: [], methods: [] } },
    { resolveUpstream: async () => null, onCapture: (e) => seen.push(e) },
  )
})
afterAll(async () => {
  await proxy.close()
  plain.closeAllConnections()
  plain.close()
  secure.closeAllConnections()
  secure.close()
})

const base: EngineOptions = {
  timeoutMs: 5000,
  maxResponseSizeMb: 50,
  strictSSL: false,
  followRedirects: true,
  sendPostmanToken: false,
  useSystemProxy: false,
  respectProxyEnv: false,
  allowFilesOutsideWorkingDir: false,
  clientCerts: [],
}

async function send(url: string, options: EngineOptions) {
  resetJars()
  const dir = await mkdtemp(join(tmpdir(), 'pml-cp-'))
  const spec: SendSpec = { item: { name: 'x', request: { method: 'GET', url, header: [] } }, parents: [{ name: 'C' }], globals: [], cookieFile: join(dir, 'c.json'), workingDir: dir, options }
  return (await startSend(spec).result).report.response
}

describe('custom proxy from Settings > Proxy', () => {
  it('routes http:// and https:// requests through the chosen proxy', async () => {
    const options = { ...base, customProxy: { host: '127.0.0.1', port: proxy.port, protocols: ['http', 'https'] as ('http' | 'https')[], bypass: [] } }
    seen.length = 0
    expect((await send(`${httpBase}/a`, options)).ok).toBe(true)
    expect((await send(`${httpsBase}/b`, options)).ok).toBe(true)
    expect(seen.map((s) => [s.method, s.tunnel])).toEqual([
      ['GET', false],
      ['CONNECT', true],
    ])
  })

  it('only proxies the chosen protocol, and honours the bypass list', async () => {
    seen.length = 0
    const httpOnly = { ...base, customProxy: { host: '127.0.0.1', port: proxy.port, protocols: ['http'] as ('http' | 'https')[], bypass: [] } }
    await send(`${httpsBase}/direct`, httpOnly)
    expect(seen).toHaveLength(0)
    const bypassed = { ...base, customProxy: { host: '127.0.0.1', port: proxy.port, protocols: ['http', 'https'] as ('http' | 'https')[], bypass: ['127.0.0.1'] } }
    await send(`${httpBase}/direct`, bypassed)
    expect(seen).toHaveLength(0)
  })
})

describe('custom proxy authentication', () => {
  it('sends the configured username/password to the proxy', async () => {
    let auth: string | undefined
    const recorder = http.createServer((req, res) => {
      auth = req.headers['proxy-authorization']
      res.end('via proxy')
    })
    await new Promise<void>((r) => recorder.listen(0, '127.0.0.1', r))
    const port = (recorder.address() as AddressInfo).port
    const options = { ...base, customProxy: { host: '127.0.0.1', port, protocols: ['http'] as ('http' | 'https')[], bypass: [], username: 'me', password: 's3cret' } }
    const r = await send('http://example.invalid/x', options)
    recorder.close()
    expect(r.ok && Buffer.from(r.body).toString()).toBe('via proxy')
    expect(auth).toBe(`Basic ${Buffer.from('me:s3cret').toString('base64')}`)
  })
})
