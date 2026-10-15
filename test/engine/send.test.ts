import { mkdtemp, writeFile } from 'node:fs/promises'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { listCookies, resetJars } from '../../src/engine/cookies'
import { buildCollection, ensureProtocol, startSend } from '../../src/engine/send'
import type { EngineOptions, SendSpec } from '../../src/shared/engine'
import type { PmContainer, PmItem } from '../../src/shared/format/types'

let base: string
let server: http.Server
let dir: string

beforeAll(async () => {
  server = http.createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', (d) => chunks.push(d))
    req.on('end', () => {
      if (req.url === '/hang') return // never answers
      if (req.url === '/binary') {
        res.setHeader('content-type', 'application/octet-stream')
        return res.end(Buffer.from([0, 255, 1]))
      }
      if (req.url === '/login') res.setHeader('set-cookie', 'sid=abc; Path=/')
      res.setHeader('content-type', 'application/json')
      res.end(
        JSON.stringify({
          method: req.method,
          url: req.url,
          headers: req.headers,
          body: Buffer.concat(chunks).toString(),
        }),
      )
    })
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})
afterAll(() => {
  server.closeAllConnections()
  server.close()
})
beforeEach(async () => {
  resetJars()
  dir = await mkdtemp(join(tmpdir(), 'pml-eng-'))
})

const options: EngineOptions = {
  timeoutMs: 0,
  maxResponseSizeMb: 50,
  strictSSL: true,
  followRedirects: true,
  sendPostmanToken: true,
  useSystemProxy: false,
  respectProxyEnv: false, // ignores this machine's http_proxy, like Postman's default
  clientCerts: [],
}

const item = (url: string, extra: Partial<PmItem['request']> = {}, more: Partial<PmItem> = {}): PmItem => ({
  name: 't',
  request: { method: 'GET', url, header: [], ...extra },
  ...more,
})

const spec = (i: PmItem, extra: Partial<SendSpec> = {}): SendSpec => ({
  item: i,
  parents: [{ name: 'C' }],
  globals: [],
  cookieFile: join(dir, 'cookies.json'),
  workingDir: dir,
  options,
  ...extra,
})

const send = async (i: PmItem, extra: Partial<SendSpec> = {}) => (await startSend(spec(i, extra)).result)
const echo = (r: Awaited<ReturnType<typeof send>>) => {
  if (!r.report.response.ok) throw new Error(r.report.response.error)
  return JSON.parse(Buffer.from(r.report.response.body).toString())
}

describe('basic sending', () => {
  it('sends a GET and returns status, headers, body, size and time', async () => {
    const r = await send(item(`${base}/echo`))
    const res = r.report.response
    if (!res.ok) throw new Error(res.error)
    expect(res).toMatchObject({ code: 200, status: 'OK' })
    expect(res.size).toBeGreaterThan(res.body.length)
    expect(r.report.sent).toMatchObject({ method: 'GET', url: `${base}/echo` })
  })

  it('returns binary bodies byte for byte', async () => {
    const r = await send(item(`${base}/binary`))
    expect(r.report.response.ok && [...r.report.response.body]).toEqual([0, 255, 1])
  })

  it('adds http:// when the scheme is missing, and reports refused connections', async () => {
    expect(echo(await send(item(`${base.replace('http://', '')}/x`))).url).toBe('/x')
    expect((await send(item('http://127.0.0.1:1/'))).report.response).toMatchObject({ ok: false, code: 'ECONNREFUSED' })
    expect((await send(item('  '))).report.response).toEqual({ ok: false, error: 'Enter a URL' })
  })

  it('can cancel, and can time out', async () => {
    const h = startSend(spec(item(`${base}/hang`)))
    setTimeout(() => h.cancel(), 100)
    expect((await h.result).report.response).toEqual({ ok: false, error: 'Request cancelled' })
    const t = await send(item(`${base}/hang`), { options: { ...options, timeoutMs: 200 } })
    expect(t.report.response.ok).toBe(false)
  })

  it('omits the Postman-Token header when that setting is off', async () => {
    expect(echo(await send(item(`${base}/x`))).headers['postman-token']).toBeDefined()
    expect(echo(await send(item(`${base}/x`), { options: { ...options, sendPostmanToken: false } })).headers['postman-token']).toBeUndefined()
  })
})

describe('bodies', () => {
  it('sends raw, urlencoded and graphql bodies, skipping disabled fields', async () => {
    const raw = echo(await send(item(`${base}/x`, { method: 'POST', body: { mode: 'raw', raw: '{"a":1}', options: { raw: { language: 'json' } } } })))
    expect(raw.body).toBe('{"a":1}')
    const form = echo(
      await send(
        item(`${base}/x`, {
          method: 'POST',
          body: { mode: 'urlencoded', urlencoded: [{ key: 'a', value: '1' }, { key: 'b', value: 'x y' }, { key: 'c', value: '3', disabled: true }] },
        }),
      ),
    )
    expect(form.body).toBe('a=1&b=x%20y')
    expect(form.headers['content-type']).toContain('application/x-www-form-urlencoded')
    const gql = echo(await send(item(`${base}/x`, { method: 'POST', body: { mode: 'graphql', graphql: { query: '{ me }', variables: '{"v":1}' } } })))
    expect(JSON.parse(gql.body)).toEqual({ query: '{ me }', variables: { v: 1 } })
  })

  it('reads form-data and binary files relative to the workspace', async () => {
    await writeFile(join(dir, 'hello.txt'), 'file-content')
    const multipart = echo(
      await send(
        item(`${base}/x`, {
          method: 'POST',
          body: { mode: 'formdata', formdata: [{ key: 'f', type: 'file', src: 'hello.txt', value: '' }, { key: 't', value: 'v' }] },
        }),
      ),
    )
    expect(multipart.body).toContain('file-content')
    expect(multipart.body).toContain('name="t"')
    const binary = echo(await send(item(`${base}/x`, { method: 'POST', body: { mode: 'file', file: { src: 'hello.txt' } } })))
    expect(binary.body).toBe('file-content')
  })
})

describe('variables, auth inheritance and scripts', () => {
  const parents: PmContainer[] = [
    {
      name: 'C',
      variable: [{ key: 'path', value: 'from-collection' }],
      auth: { type: 'bearer', bearer: [{ key: 'token', value: '{{token}}', type: 'string' }] },
      event: [{ listen: 'prerequest', script: { exec: ['console.log("collection pre")'] } }],
    },
    { name: 'Folder', event: [{ listen: 'test', script: { exec: ['pm.test("folder test", () => {})'] } }] },
  ]

  it('resolves variables by scope priority and inherits auth from the collection', async () => {
    const r = await send(item(`{{base}}/{{path}}?q={{q}}`), {
      parents,
      globals: [{ key: 'base', value: base }, { key: 'q', value: 'global' }],
      environment: { name: 'Dev', values: [{ key: 'q', value: 'env' }, { key: 'token', value: 'T1' }] },
    })
    const e = echo(r)
    expect(e.url).toBe('/from-collection?q=env')
    expect(e.headers.authorization).toBe('Bearer T1')
  })

  it('runs scripts top-down, records tests, logs, script errors and variable changes', async () => {
    const r = await send(
      item(`${base}/x/:id`, {}, {
        event: [
          { listen: 'prerequest', script: { exec: ['pm.environment.set("token", "T2"); console.log("obj", {a: 1})'] } },
          {
            listen: 'test',
            script: {
              exec: [
                'pm.test("status 200", () => pm.response.to.have.status(200))',
                'pm.test("fails", () => pm.expect(1).to.eql(2))',
                'pm.collectionVariables.set("path", "changed"); pm.globals.set("g", "G")',
                'throw new Error("boom")',
              ],
            },
          },
        ],
      }),
      { parents, environment: { name: 'Dev', values: [{ key: 'token', value: 'T1' }] } },
    )
    expect(r.report.logs.map((l) => l.args[0])).toEqual(['collection pre', 'obj'])
    expect(r.report.logs[1].args[1]).toContain('a: 1')
    expect(r.report.tests.map((t) => [t.name, t.passed])).toEqual([
      ['folder test', true],
      ['status 200', true],
      ['fails', false],
    ])
    expect(r.report.tests[2].error).toContain('expected 1 to deeply equal 2')
    expect(r.report.scriptErrors).toEqual(['boom'])
    expect(r.variables.environment).toEqual([{ key: 'token', value: 'T2' }])
    expect(r.variables.globals).toEqual([{ key: 'g', value: 'G' }])
    expect(r.variables.collection.find((v) => v.key === 'path')?.value).toBe('changed')
  })

  it('substitutes path variables and keeps disabled query params out', async () => {
    const e = echo(
      await send(
        item({
          raw: `${base}/users/:id?a=1`,
          variable: [{ key: 'id', value: '42' }],
          query: [{ key: 'a', value: '1' }, { key: 'b', value: '2', disabled: true }],
        } as never),
      ),
    )
    expect(e.url).toBe('/users/42?a=1')
  })
})

describe('cookies', () => {
  it('stores cookies per workspace and sends them on the next request', async () => {
    const first = await send(item(`${base}/login`))
    expect(first.report.cookies.map((c) => `${c.key}=${c.value}`)).toEqual(['sid=abc'])
    expect(echo(await send(item(`${base}/x`))).headers.cookie).toBe('sid=abc')
    resetJars() // simulate an app restart: the jar is reloaded from disk
    expect(listCookies(join(dir, 'cookies.json')).map((c) => c.key)).toEqual(['sid'])
  })
})

describe('system proxy', () => {
  it('asks for the system proxy and goes direct when there is none', async () => {
    const asked: string[] = []
    const r = await startSend(spec(item(`${base}/x`), { options: { ...options, useSystemProxy: true } }), {
      resolveSystemProxy: async (url) => (asked.push(url), null),
    }).result
    expect(r.report.response.ok).toBe(true)
    expect(asked).toEqual([`${base}/x`])
  })
})

describe('helpers', () => {
  it('ensureProtocol keeps schemes and variables', () => {
    expect(ensureProtocol('https://a.b')).toBe('https://a.b')
    expect(ensureProtocol('{{base}}/x')).toBe('{{base}}/x')
    expect(ensureProtocol(' localhost:3000/x ')).toBe('http://localhost:3000/x')
  })
  it('buildCollection nests the request under its folders', () => {
    const c = buildCollection(item('http://a'), [{ name: 'C' }, { name: 'F1' }, { name: 'F2' }]) as any
    expect(c.info.name).toBe('C')
    expect(c.item[0].name).toBe('F1')
    expect(c.item[0].item[0].name).toBe('F2')
    expect(c.item[0].item[0].item[0].name).toBe('t')
  })
})
