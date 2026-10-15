import { mkdtemp, readFile } from 'node:fs/promises'
import { createSecureServer, type ServerHttp2Session } from 'node:http2'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { LeafFactory, createCa } from '../../src/proxy/certs'
import { startSend } from '../../src/engine/send'
import { engineOptions } from '../../src/main/netconfig'
import { DEFAULT_SETTINGS } from '../../src/shared/settings'

it('negotiates Auto/HTTP2, forces HTTP1, and writes TLS keys only when configured', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'pm-protocol-'))
  const cert = new LeafFactory(createCa('Protocol test')).forHost('localhost')
  const server = createSecureServer({ cert: cert.cert, key: cert.key, allowHTTP1: true })
  const sessions = new Set<ServerHttp2Session>()
  server.on('session', s => { sessions.add(s); s.on('close', () => sessions.delete(s)) })
  server.on('request', (req, res) => { res.end(req.httpVersion) })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as { port: number }).port
  const keyFile = join(dir, 'tls-keys.log')
  try {
    for (const [httpVersion, expected] of [['auto', '2.0'], ['http1', '1.1'], ['http2', '2.0']] as const) {
      const options = engineOptions(DEFAULT_SETTINGS, undefined)
      Object.assign(options, { httpVersion, strictSSL: false, useSystemProxy: false, respectProxyEnv: false, timeoutMs: 5000, ...(httpVersion === 'http1' ? { tlsKeyLogFile: keyFile } : {}) })
      const { report } = await startSend({ item: { name: 'version', request: { method: 'GET', url: `https://localhost:${port}`, header: [] } }, parents: [], globals: [], cookieFile: join(dir, 'cookies.json'), workingDir: dir, options }).result
      if (!report.response.ok) throw new Error(report.response.error)
      expect(Buffer.from(report.response.body).toString()).toBe(expected)
      if (httpVersion === 'auto') await expect(readFile(keyFile)).rejects.toThrow()
    }
    await expect.poll(() => readFile(keyFile, 'utf8')).toMatch(/TRAFFIC_SECRET|CLIENT_RANDOM/)
  } finally {
    for (const session of sessions) session.destroy()
    server.close()
  }
})
