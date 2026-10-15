import { mkdtemp } from 'node:fs/promises'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Tick } from '../../src/loadtest/metrics'
import { startLoadTest } from '../../src/loadtest/runner'
import type { EngineOptions, LoadSpec } from '../../src/shared/engine'

let base: string
let server: http.Server
const cookies = new Set<string>()
beforeAll(async () => {
  let n = 0
  server = http.createServer((req, res) => {
    if (req.headers.cookie) cookies.add(req.headers.cookie)
    else res.setHeader('set-cookie', `vu=${++n}; Path=/`)
    setTimeout(() => res.end(req.url === '/fail' ? (res.statusCode = 500, 'x') : 'ok'), 5)
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})
afterAll(() => {
  server.closeAllConnections()
  server.close()
})

const options: EngineOptions = {
  timeoutMs: 0,
  maxResponseSizeMb: 50,
  strictSSL: true,
  followRedirects: true,
  sendPostmanToken: false,
  useSystemProxy: false,
  respectProxyEnv: false,
  allowFilesOutsideWorkingDir: false,
  clientCerts: [],
}

async function spec(extra: Partial<LoadSpec> = {}): Promise<LoadSpec> {
  const dir = await mkdtemp(join(tmpdir(), 'pml-load-'))
  return {
    collection: {
      info: { name: 'L' },
      item: [
        { id: 'ok', name: 'OK', request: { method: 'GET', url: `${base}/ok` } },
        { id: 'fail', name: 'Fail', request: { method: 'GET', url: `${base}/fail` } },
      ],
    },
    globals: [],
    data: [],
    profile: { kind: 'fixed', vus: 3, durationSec: 2 },
    cookieFile: join(dir, 'c.json'),
    workingDir: dir,
    options,
    ...extra,
  }
}

describe('load test', () => {
  it('runs VUs for the duration, emits ticks, and summarizes per request', async () => {
    const ticks: Tick[] = []
    const summary = await startLoadTest(await spec(), (t) => ticks.push(t)).result
    expect(ticks.length).toBeGreaterThanOrEqual(1)
    expect(ticks[0].vus).toBe(3)
    expect(summary.maxVus).toBe(3)
    expect(summary.totalRequests).toBeGreaterThan(20)
    expect(summary.requests.map((r) => r.name).sort()).toEqual(['Fail', 'OK'])
    expect(summary.errorRate).toBeGreaterThan(40)
    expect(summary.durationSec).toBeGreaterThanOrEqual(1.9)
    // every VU has its own cookie jar
    expect(cookies.size).toBeGreaterThanOrEqual(3)
  }, 15_000)

  it('can be stopped early', async () => {
    const handle = startLoadTest(await spec({ profile: { kind: 'fixed', vus: 2, durationSec: 30 } }), () => undefined)
    setTimeout(() => handle.stop(), 700)
    const summary = await handle.result
    expect(summary.stopped).toBe(true)
    expect(summary.durationSec).toBeLessThan(2)
  }, 10_000)
})
