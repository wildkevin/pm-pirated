import { mkdtemp, writeFile } from 'node:fs/promises'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { listCookies, resetJars, setCookie } from '../../src/engine/cookies'
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
  allowFilesOutsideWorkingDir: false,
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

describe('file access', () => {
  it('refuses files outside the workspace unless allowed', async () => {
    const outside = join(await mkdtemp(join(tmpdir(), 'pml-outside-')), 'id_rsa')
    await writeFile(outside, 'PRIVATE-KEY')
    const upload = (src: string) => item(`${base}/x`, { method: 'POST', body: { mode: 'formdata', formdata: [{ key: 'f', type: 'file', src, value: '' }] } })
    const blocked = await send(upload(outside))
    expect(JSON.stringify(blocked.report)).not.toContain('PRIVATE-KEY')
    const viaDotDot = await send(item(`${base}/x`, { method: 'POST', body: { mode: 'file', file: { src: `../${outside.split('/').slice(-2).join('/')}` } } }))
    expect(JSON.stringify(viaDotDot.report)).not.toContain('PRIVATE-KEY')

    const allowed = await send(upload(outside), { options: { ...options, allowFilesOutsideWorkingDir: true } })
    expect(echo(allowed).body).toContain('PRIVATE-KEY')
    // A client-certificate key configured in Settings stays unreadable for request bodies.
    const certConfigured = await send(upload(outside), { options: { ...options, clientCerts: [{ host: 'other.test', key: outside, cert: outside }] } })
    expect(JSON.stringify(certConfigured.report)).not.toContain('PRIVATE-KEY')
  })
})

describe('private files', () => {
  it('serves configured files only under their random per-send names', async () => {
    const { fileResolver } = await import('../../src/engine/send')
    const real = join(await mkdtemp(join(tmpdir(), 'pml-cert-')), 'client.key')
    await writeFile(real, 'KEY')
    const r = fileResolver(dir, false, new Map([['pmlocal-private-abc/0', real]])) as typeof import('node:fs')
    expect(r.readFileSync('pmlocal-private-abc/0', 'utf8')).toBe('KEY')
    expect(() => r.readFileSync(real, 'utf8')).toThrow(/outside the workspace/)
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


describe('QA request regressions', () => {
  it.each(['this is not js(', 'throw new Error("pre boom")'])('does not send after a failing setup script: %s', async script => {
    const r = await send(item(`${base}/x`, {}, { event: [{ listen: 'prerequest', script: { exec: [script] } }] }))
    expect(r.report.response.ok).toBe(false)
    expect(r.report.sent).toBeUndefined()
    expect(r.report.timeline?.filter(e => e.kind === 'request')).toHaveLength(0)
    expect(r.report.scriptErrors).toHaveLength(1)
  })
  it('keeps main and script requests separately, in console event order', async () => {
    const r = await send(item(`${base}/main`, {}, { event: [
      { listen: 'prerequest', script: { exec: [`console.log('pre'); pm.sendRequest('${base}/pre', () => console.log('pre done'))`] } },
      { listen: 'test', script: { exec: [`console.log('post'); pm.sendRequest('${base}/side', () => console.log('side done'))`] } },
    ] }))
    expect(r.report.sent?.url).toBe(`${base}/main`)
    expect(echo(r).url).toBe('/main')
    expect(r.report.timeline?.map(e => e.kind === 'log' ? e.log.args[0] : e.sent.url.replace(base, ''))).toEqual(['pre', '/pre', 'pre done', '/main', 'post', '/side', 'side done'])
  })
  it('sends GET bodies by default and accurately reports explicit pruning', async () => {
    const request = item(`${base}/x`, { body: { mode: 'raw', raw: '{"x":1}', options: { raw: { language: 'json' } } } })
    expect(echo(await send(request)).body).toBe('{"x":1}')
    const pruned = await send({ ...request, protocolProfileBehavior: { disableBodyPruning: false } })
    expect(echo(pruned).body).toBe('')
    expect(pruned.report.sent?.body).toBeUndefined()
    expect(pruned.report.timeline?.some(e => e.kind === 'request' && e.sent.body)).toBe(false)
  })
  it('rejects malformed GraphQL and inaccessible body files before any network request', async () => {
    const invalid = await send(item(`${base}/x`, { method: 'POST', body: { mode: 'graphql', graphql: { query: '{ me }', variables: '{"id":' } } }))
    expect(invalid.report.response.ok).toBe(false)
    expect(invalid.report.sent).toBeUndefined()
    const missing = await send(item(`${base}/x`, { method: 'POST', body: { mode: 'file', file: { src: '/outside/missing-file' } } }))
    expect(missing.report.response).toMatchObject({ ok: false, error: expect.stringContaining('outside the workspace') })
    expect(missing.report.sent).toBeUndefined()
  })
  it('uses the URL encoding setting and preserves flag/empty params on the wire', async () => {
    const encoded = echo(await send(item(`${base}/x?q=a b|c`)))
    const raw = echo(await send(item(`${base}/x?q=a%20b|c`, {}, { protocolProfileBehavior: { disableUrlEncoding: true } })))
    expect(encoded.url).toBe('/x?q=a%20b%7Cc')
    expect(raw.url).toBe('/x?q=a%20b|c')
    const query = await import('../../src/shared/format/url')
    const url = query.setQueryParams(`${base}/x?empty=&flag&off=1`, query.queryParams(`${base}/x?empty=&flag&off=1`).map(p => p.key === 'off' ? { ...p, disabled: true } : p))
    expect(echo(await send(item(url as never))).url).toBe('/x?empty=&flag')
  })
  it('shows Max-Age as persistent expiry in live and serialized cookie views', () => {
    const file = join(dir, 'cookies.json')
    setCookie(file, base, 'theme=dark; Max-Age=3600; Path=/')
    const expiry = listCookies(file)[0].expires
    expect(expiry).toBeDefined()
    expect(new Date(expiry!).getTime() - Date.now()).toBeGreaterThan(3_590_000)
  })
})


it('validates GraphQL variables and file paths after setup scripts resolve them', async () => {
  await writeFile(join(dir, 'dynamic.txt'), 'dynamic-content')
  const setup = { event: [{ listen: 'prerequest' as const, script: { exec: ['pm.variables.set("vars", JSON.stringify({id: 42})); pm.variables.set("file", "dynamic.txt")'] } }] }
  const graphql = await send(item(`${base}/x`, { method: 'POST', body: { mode: 'graphql', graphql: { query: '{ me }', variables: '{{vars}}' } } }, setup))
  expect(JSON.parse(echo(graphql).body).variables).toEqual({ id: 42 })
  const binary = await send(item(`${base}/x`, { method: 'POST', body: { mode: 'file', file: { src: '{{file}}' } } }, setup))
  expect(echo(binary).body).toBe('dynamic-content')
})

describe('application request preferences', () => {
  it('disables implicit cookies and caching headers without deleting the jar', async () => {
    await send(item(`${base}/login`))
    expect(echo(await send(item(`${base}/echo`))).headers.cookie).toBe('sid=abc')
    const disabled = echo(await send(item(`${base}/echo`), { options: { ...options, disableCookies: true, sendNoCache: false, sendPostmanToken: false, httpVersion: 'http1' } }))
    expect(disabled.headers.cookie).toBeUndefined()
    expect(disabled.headers['cache-control']).toBeUndefined()
    expect(disabled.headers['postman-token']).toBeUndefined()
    const restored = echo(await send(item(`${base}/echo`)))
    expect(restored.headers.cookie).toBe('sid=abc')
    expect(restored.headers['cache-control']).toBe('no-cache')
  })

  it('uses the configured working directory for relative file uploads and enforces its boundary', async () => {
    const working = await mkdtemp(join(tmpdir(), 'pml-files-'))
    await writeFile(join(working, 'body.txt'), 'chosen working directory')
    const request = item(`${base}/echo`, { method: 'POST', body: { mode: 'file', file: { src: 'body.txt' } } })
    const response = await send(request, { options: { ...options, workingDirectory: working } })
    expect(echo(response).body).toBe('chosen working directory')
    await writeFile(join(dir, 'outside.txt'), 'outside')
    request.request.body = { mode: 'file', file: { src: join(dir, 'outside.txt') } }
    const blocked = await send(request, { options: { ...options, workingDirectory: working } })
    expect(blocked.report.response.ok).toBe(false)
  })
})
