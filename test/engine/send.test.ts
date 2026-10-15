import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { clearProxyEnv, ensureProtocol, startSend } from '../../src/engine/send'
import type { PmItem } from '../../src/shared/format/types'

let base: string
let server: http.Server

beforeAll(async () => {
  clearProxyEnv()
  server = http.createServer((req, res) => {
    let body = ''
    req.on('data', (d) => (body += d))
    req.on('end', () => {
      if (req.url === '/hang') return // never answers
      if (req.url === '/binary') {
        res.setHeader('content-type', 'application/octet-stream')
        return res.end(Buffer.from([0, 255, 1]))
      }
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify({ method: req.method, xa: req.headers['x-a'] ?? null, body }))
    })
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})
afterAll(() => {
  server.closeAllConnections()
  server.close()
})

const item = (url: string, extra: Partial<PmItem['request']> = {}): PmItem => ({
  name: 't',
  request: { method: 'GET', url, header: [], ...extra },
})

describe('startSend', () => {
  it('sends a GET and returns status, headers, body, size and time', async () => {
    const r = await startSend(item(`${base}/echo`), { timeoutMs: 0 }).result
    if (!r.ok) throw new Error(r.error)
    expect(r.code).toBe(200)
    expect(r.status).toBe('OK')
    expect(r.headers.find((h) => h.key.toLowerCase() === 'content-type')?.value).toBe('application/json')
    expect(JSON.parse(Buffer.from(r.body).toString())).toMatchObject({ method: 'GET' })
    expect(r.size).toBeGreaterThan(r.body.length)
    expect(r.timeMs).toBeGreaterThanOrEqual(0)
  })

  it('sends method, headers and a raw body, skipping disabled headers', async () => {
    const r = await startSend(
      item(`${base}/echo`, {
        method: 'POST',
        header: [
          { key: 'X-A', value: '1' },
          { key: 'X-A', value: 'nope', disabled: true },
        ],
        body: { mode: 'raw', raw: '{"a":1}', options: { raw: { language: 'json' } } },
      }),
      { timeoutMs: 0 },
    ).result
    if (!r.ok) throw new Error(r.error)
    expect(JSON.parse(Buffer.from(r.body).toString())).toEqual({ method: 'POST', xa: '1', body: '{"a":1}' })
  })

  it('returns binary bodies byte for byte', async () => {
    const r = await startSend(item(`${base}/binary`), { timeoutMs: 0 }).result
    if (!r.ok) throw new Error(r.error)
    expect([...r.body]).toEqual([0, 255, 1])
  })

  it('adds http:// when the scheme is missing', async () => {
    const r = await startSend(item(`${base.replace('http://', '')}/echo`), { timeoutMs: 0 }).result
    expect(r.ok && r.code).toBe(200)
  })

  it('reports connection refused as an error with its code', async () => {
    const r = await startSend(item('http://127.0.0.1:1/'), { timeoutMs: 0 }).result
    expect(r).toMatchObject({ ok: false, code: 'ECONNREFUSED' })
  })

  it('rejects an empty URL without sending', async () => {
    expect(await startSend(item('  '), { timeoutMs: 0 }).result).toEqual({ ok: false, error: 'Enter a URL' })
  })

  it('can cancel a request that never answers', async () => {
    const h = startSend(item(`${base}/hang`), { timeoutMs: 0 })
    setTimeout(() => h.cancel(), 100)
    expect(await h.result).toEqual({ ok: false, error: 'Request cancelled' })
  })

  it('times out when asked to', async () => {
    const r = await startSend(item(`${base}/hang`), { timeoutMs: 200 }).result
    expect(r.ok).toBe(false)
  })
})

describe('ensureProtocol', () => {
  it('keeps existing schemes and variables', () => {
    expect(ensureProtocol('https://a.b')).toBe('https://a.b')
    expect(ensureProtocol('{{base}}/x')).toBe('{{base}}/x')
    expect(ensureProtocol(' localhost:3000/x ')).toBe('http://localhost:3000/x')
  })
})
