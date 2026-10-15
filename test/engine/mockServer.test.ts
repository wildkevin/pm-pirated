import { afterEach, describe, expect, it } from 'vitest'
import { startMockServer, type RunningMock } from '../../src/mocks/server'
import type { MockLogEntry, MockRoute } from '../../src/shared/mock'

const routes: MockRoute[] = [
  {
    id: 'a',
    exampleName: 'User found',
    requestName: 'Get user',
    method: 'GET',
    path: '/users/:id',
    query: [],
    response: { code: 200, status: 'OK', headers: [{ key: 'Content-Type', value: 'application/json' }, { key: 'Content-Length', value: '999' }], body: '{"id":"{{$guid}}","name":"Ada"}' },
  },
  {
    id: 'b',
    exampleName: 'Created',
    requestName: 'Create user',
    method: 'POST',
    path: '/users',
    query: [],
    response: { code: 201, status: 'Created', headers: [], body: 'made' },
  },
]

let mock: RunningMock | undefined
afterEach(async () => {
  await mock?.close()
  mock = undefined
})

describe('mock server', () => {
  it('serves the matching example with dynamic variables resolved and logs each request', async () => {
    const logs: MockLogEntry[] = []
    mock = await startMockServer({ host: '127.0.0.1', port: 0, delayMs: 0 }, routes, (l) => logs.push(l))
    const res = await fetch(`${mock.url}/users/42`)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.name).toBe('Ada')
    expect(body.id).toMatch(/^[0-9a-f-]{36}$/)
    expect(res.headers.get('access-control-allow-origin')).toBeNull()

    const created = await fetch(`${mock.url}/users`, { method: 'POST', body: '{}' })
    expect([created.status, await created.text()]).toEqual([201, 'made'])

    const missing = await fetch(`${mock.url}/nope`)
    expect(missing.status).toBe(404)
    expect((await missing.json()).error.name).toBe('mockRequestNotFoundError')

    expect(logs.map((l) => [l.method, l.path, l.code, l.matched])).toEqual([
      ['GET', '/users/42', 200, 'User found'],
      ['POST', '/users', 201, 'Created'],
      ['GET', '/nope', 404, undefined],
    ])
  })

  it('CORS is opt-in, and localhost-only mocks refuse foreign Host headers', async () => {
    const http = await import('node:http')
    mock = await startMockServer({ host: '127.0.0.1', port: 0, delayMs: 0, cors: true }, routes, () => undefined)
    expect((await fetch(`${mock.url}/users/1`)).headers.get('access-control-allow-origin')).toBe('*')
    const pre = await fetch(`${mock.url}/users/1`, { method: 'OPTIONS', headers: { 'Access-Control-Request-Method': 'GET', Origin: 'http://localhost:5173' } })
    expect(pre.status).toBe(204)
    const status = await new Promise<number>((resolve) =>
      http.get(`${mock!.url}/users/1`, { headers: { Host: 'evil.example:80' } }, (r) => resolve(r.statusCode!)),
    )
    expect(status).toBe(403)
  })

  it('hot-swaps routes, applies the delay, and reports a busy port', async () => {
    mock = await startMockServer({ host: '127.0.0.1', port: 0, delayMs: 150 }, routes, () => undefined)
    mock.setRoutes([])
    const t0 = Date.now()
    expect((await fetch(`${mock.url}/users/1`)).status).toBe(404)
    mock.setRoutes(routes)
    expect((await fetch(`${mock.url}/users/1`)).status).toBe(200)
    expect(Date.now() - t0).toBeGreaterThanOrEqual(150)

    const port = Number(new URL(mock.url).port)
    await expect(startMockServer({ host: '127.0.0.1', port, delayMs: 0 }, routes, () => undefined)).rejects.toThrow(`Port ${port} is already in use`)
  })
})
