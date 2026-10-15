import { mkdtemp } from 'node:fs/promises'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { resetJars } from '../../src/engine/cookies'
import { startRunner } from '../../src/engine/runner'
import type { EngineOptions, RunnerItemResult, RunnerSpec } from '../../src/shared/engine'

let base: string
let server: http.Server
beforeAll(async () => {
  server = http.createServer((req, res) => {
    if (req.url?.startsWith('/slow')) return void setTimeout(() => res.end('{}'), 300)
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({ url: req.url }))
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
  sendPostmanToken: true,
  useSystemProxy: false,
  respectProxyEnv: false,
  allowFilesOutsideWorkingDir: false,
  clientCerts: [],
}

async function spec(extra: Partial<RunnerSpec> = {}): Promise<RunnerSpec> {
  resetJars()
  const dir = await mkdtemp(join(tmpdir(), 'pml-run-'))
  return {
    collection: {
      info: { name: 'C' },
      variable: [{ key: 'step', value: '0' }],
      item: [
        {
          name: 'Folder',
          item: [
            {
              id: 'collections/C/Folder/First.request.json',
              name: 'First',
              request: { method: 'GET', url: `${base}/first?user={{user}}` },
              event: [{ listen: 'test', script: { exec: ['pm.test("ok", () => pm.response.to.have.status(200)); pm.collectionVariables.set("step", "1")'] } }],
            },
          ],
        },
        {
          id: 'collections/C/Second.request.json',
          name: 'Second',
          request: { method: 'POST', url: `${base}/second/{{step}}` },
          event: [{ listen: 'test', script: { exec: ['pm.test("fails", () => pm.expect(1).to.eql(2)); console.log("iteration", pm.info.iteration)'] } }],
        },
      ],
    },
    globals: [],
    data: [],
    iterationCount: 1,
    delayMs: 0,
    stopOnError: false,
    persistResponses: false,
    cookieFile: join(dir, 'cookies.json'),
    workingDir: dir,
    options,
    ...extra,
  }
}

describe('collection runner', () => {
  it('runs every request per iteration with data rows, counting tests and keeping variables', async () => {
    const items: RunnerItemResult[] = []
    const { summary, variables } = await startRunner(
      await spec({ iterationCount: 2, data: [{ user: 'ada' }, { user: 'bob' }] }),
      (i) => items.push(i),
    ).result
    expect(items.map((i) => [i.iteration, i.name, i.url.replace(base, '')])).toEqual([
      [0, 'First', '/first?user=ada'],
      [0, 'Second', '/second/1'],
      [1, 'First', '/first?user=bob'],
      [1, 'Second', '/second/1'],
    ])
    expect(items[0]).toMatchObject({ requestId: 'collections/C/Folder/First.request.json', method: 'GET', code: 200, status: 'OK' })
    expect(items[1].logs[0].args).toEqual(['iteration', '0'])
    expect(items[0].response).toBeUndefined()
    expect(summary).toMatchObject({ iterations: 2, requests: 4, testsPassed: 2, testsFailed: 2, errors: 0, stopped: false })
    expect(variables.collection).toEqual([{ key: 'step', value: '1' }])
  })

  it('keeps response bodies only when asked, and counts network errors', async () => {
    const s = await spec({ persistResponses: true })
    ;(s.collection.item as any[])[1].request.url = 'http://127.0.0.1:1/down'
    const items: RunnerItemResult[] = []
    const { summary } = await startRunner(s, (i) => items.push(i)).result
    expect(items[0].response?.body).toContain('/first')
    expect(items[1].error).toContain('ECONNREFUSED')
    expect(summary.errors).toBe(1)
  })

  it('stops the entire run at the first network error and averages successful responses only', async () => {
    const s = await spec({ iterationCount: 5, stopOnError: true })
    ;(s.collection.item as any[])[1].request.url = 'http://127.0.0.1:1/down'
    const items: RunnerItemResult[] = []
    const { summary } = await startRunner(s, (item) => items.push(item)).result
    expect(items.map((item) => item.iteration)).toEqual([0, 0])
    expect(summary).toMatchObject({ stopped: true, iterations: 1, requests: 2, errors: 1 })
    expect(summary.avgResponseMs).toBe(Math.round(items[0].timeMs!))
  })

  it('does not count an iteration whose first request was interrupted', async () => {
    const s = await spec({ iterationCount: 5 })
    s.collection.item = [{ name: 'Slow', request: { method: 'GET', url: `${base}/slow` } }]
    const items: RunnerItemResult[] = []
    let handle: ReturnType<typeof startRunner>
    handle = startRunner(s, (item) => {
      items.push(item)
      if (items.length === 1) setTimeout(() => handle.stop(), 50)
    })
    const { summary } = await handle.result
    expect(items).toHaveLength(1)
    expect(summary).toMatchObject({ stopped: true, iterations: 1, requests: 1 })
  })

  it('can be stopped mid-run', async () => {
    const s = await spec({ iterationCount: 50 })
    ;(s.collection.item as any[])[1].request.url = `${base}/slow`
    const items: RunnerItemResult[] = []
    const handle = startRunner(s, (i) => items.push(i))
    setTimeout(() => handle.stop(), 450)
    const { summary } = await handle.result
    expect(summary.stopped).toBe(true)
    expect(items.length).toBeLessThan(10)
  })
})
