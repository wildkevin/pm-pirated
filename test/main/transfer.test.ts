import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { fakeCrypt } from '../../src/main/crypto'
import { SecretStore } from '../../src/main/secrets'
import { appendHistory, deleteHistory, listHistory, MAX_HISTORY } from '../../src/main/workspace/history'
import { initWorkspace, openWorkspace, readRequest } from '../../src/main/workspace/store'
import { curlToItem, detect, exportCollection, exportEnvironment, importDetected } from '../../src/main/workspace/transfer'
import { readUiState, writeUiState } from '../../src/main/workspace/uiState'
import { Variables } from '../../src/main/workspace/variables'
import { queryParams, rawUrl, setQueryParams } from '../../src/shared/format/url'
import { Url } from 'postman-collection'

let root: string
let vars: Variables
const fixture = () => readFile(join(__dirname, '..', 'fixtures', 'sample.postman_collection.json'), 'utf8')

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'pml-io-'))
  await initWorkspace(root)
  vars = new Variables(root, new SecretStore(join(await mkdtemp(join(tmpdir(), 'pml-s-')), 's.json'), fakeCrypt))
})

describe('detect', () => {
  it('recognises cURL, collections, environments and globals', async () => {
    expect(detect('curl https://x').kind).toBe('curl')
    expect(detect(await fixture()).kind).toBe('collection')
    expect(detect('{"name":"Dev","values":[]}').kind).toBe('environment')
    expect(detect('{"_postman_variable_scope":"globals","values":[]}').kind).toBe('globals')
  })
  it('explains what it cannot import', () => {
    expect(() => detect('hello')).toThrow(/cURL command or a Postman/)
    expect(() => detect('{"order":[],"requests":[]}')).toThrow(/v1 collections/)
    expect(() => detect('{"a":1}')).toThrow(/Unrecognised JSON/)
  })
})

describe('collection import', () => {
  it('round-trips encoded query rows and can enable imported disabled parameters without double encoding', async () => {
    const raw = 'https://example.test/?plus=%2B&flag&empty='
    const original = { info: { name: 'Encoded' }, item: [{ name: 'Query', request: { method: 'GET', url: {
      raw, query: [{ key: 'plus', value: '%2B' }, { key: 'flag', value: null }, { key: 'empty', value: '' },
        { key: 'off%26key', value: 'a%3Db', disabled: true, description: 'Disabled value' }],
    } } }] }
    const imported = await importDetected(root, detect(JSON.stringify(original)), vars)
    const item = await readRequest(root, `${imported.id}/Query.request.json`)
    expect(queryParams(item.request.url)).toEqual([
      { key: 'plus', value: '+' }, { key: 'flag', value: '', hasEquals: false }, { key: 'empty', value: '', hasEquals: true },
      { key: 'off&key', value: 'a=b', disabled: true, description: 'Disabled value' },
    ])
    expect(rawUrl(setQueryParams(item.request.url, queryParams(item.request.url).map((q) => ({ ...q, disabled: false }))))).toBe(`${raw}&off%26key=a%3Db`)
    const exported = await exportCollection(root, imported.id)
    expect(new Url(exported.item[0].request.url).toString()).toBe(raw)
    const again = await importDetected(root, detect(JSON.stringify(exported)), vars)
    expect((await readRequest(root, `${again.id}/Query.request.json`)).request.url).toEqual(item.request.url)
  })

  it('writes folders, requests, auth, scripts and variables, keeping secrets out of files', async () => {
    const r = await importDetected(root, detect(await fixture()), vars)
    expect(r).toMatchObject({ kind: 'collection', id: 'collections/Sample API', name: 'Sample API', detail: '4 requests' })
    const [c] = (await openWorkspace(root)).collections
    expect(c.children!.map((n) => n.name)).toEqual(['Users', 'Health', 'Empty event'])
    expect(c.children![0].children!.map((n) => [n.name, n.method])).toEqual([
      ['Get user', 'GET'],
      ['Create user', 'POST'],
    ])

    const get = await readRequest(root, 'collections/Sample API/Users/Get user.request.json')
    expect(get.request.url).toEqual({
      raw: '{{baseUrl}}/users/:id?expand=true',
      query: [{ key: 'expand', value: 'true' }, { key: 'debug', value: '1', disabled: true }],
      variable: [{ key: 'id', value: '42', description: 'User id' }],
    })
    expect(get.event![0].script.exec).toEqual(['pm.test("ok", function () {', '  pm.response.to.have.status(200)', '})'])
    expect(get.response).toHaveLength(1)

    const create = await readRequest(root, 'collections/Sample API/Users/Create user.request.json')
    expect(create.request.header).toEqual([{ key: 'Content-Type', value: 'application/json' }, { key: 'X-Trace', value: 'on' }])
    expect((await readRequest(root, 'collections/Sample API/Health.request.json')).request).toMatchObject({ method: 'GET', url: 'https://api.example.test/health' })
    const empty = await readRequest(root, 'collections/Sample API/Empty event.request.json')
    expect(empty.event).toBeUndefined()
    expect(empty.request).toMatchObject({ method: 'GET', url: 'https://example.test/ping' })

    expect(await vars.read('col:collections/Sample API')).toEqual([
      { key: 'baseUrl', type: 'default', initial: 'https://api.example.test', current: 'https://api.example.test', enabled: true },
      { key: 'apiKey', type: 'secret', initial: 's3cret', current: 's3cret', enabled: true },
      { key: 'off', type: 'default', initial: 'x', current: 'x', enabled: false },
    ])
    expect(await readFile(join(root, 'collections', 'Sample API', 'collection.json'), 'utf8')).not.toContain('s3cret')
  })

  it('round-trips: export after import matches the original structure', async () => {
    const original = JSON.parse(await fixture())
    const r = await importDetected(root, detect(JSON.stringify(original)), vars)
    const out = await exportCollection(root, r.id)
    expect(out.info).toMatchObject({ name: 'Sample API', description: 'Imported from Postman', schema: original.info.schema })
    expect(out.auth).toEqual(original.auth)
    expect(out.event).toEqual(original.event)
    expect(out.item.map((i: any) => i.name)).toEqual(['Users', 'Health', 'Empty event'])
    expect(out.item[0].auth).toEqual(original.item[0].auth)
    expect(out.item[0].description).toBe('User endpoints')
    expect(out.item[0].item.map((i: any) => i.name)).toEqual(['Get user', 'Create user'])
    expect(out.variable.find((v: any) => v.key === 'apiKey').value).toBe('')
    expect(out.variable.find((v: any) => v.key === 'baseUrl').value).toBe('https://api.example.test')
    // re-import of our own export works too
    expect((await importDetected(root, detect(JSON.stringify(out)), vars)).detail).toBe('4 requests')
  })
})

describe('export of stored URL objects', () => {
  it('adds parsed host/path so the runtime and Postman can use them', async () => {
    const { createCollection, createRequest } = await import('../../src/main/workspace/store')
    const col = await createCollection(root, 'C')
    await createRequest(root, col, 'R', { name: 'R', request: { method: 'DELETE', url: { raw: 'https://api.test/payments/:id', variable: [{ key: 'id', value: '7' }] }, header: [] } })
    const out = await exportCollection(root, col)
    expect(out.item[0].request.url).toMatchObject({ raw: 'https://api.test/payments/:id', host: ['api', 'test'], path: ['payments', ':id'], variable: [{ key: 'id', value: '7' }] })
  })
})

describe('environments and globals', () => {
  it('imports an environment (secrets out of the file) and exports it back', async () => {
    const env = { id: 'x', name: 'Prod', values: [{ key: 'host', value: 'p.test', enabled: true }, { key: 'pw', value: 'hunter2', type: 'secret', enabled: true }], _postman_variable_scope: 'environment' }
    const r = await importDetected(root, detect(JSON.stringify(env)), vars)
    expect(r).toMatchObject({ kind: 'environment', id: 'environments/Prod.env.json', name: 'Prod' })
    expect(await readFile(join(root, r.id), 'utf8')).not.toContain('hunter2')
    expect((await vars.read(`env:${r.id}`)).map((v) => [v.key, v.current])).toEqual([['host', 'p.test'], ['pw', 'hunter2']])
    const out = await exportEnvironment(root, r.id)
    expect(out).toMatchObject({ name: 'Prod', _postman_variable_scope: 'environment' })
    expect(JSON.stringify(out)).not.toContain('hunter2')
  })

  it('merges imported globals over existing ones', async () => {
    await vars.write('globals', [{ key: 'a', type: 'default', initial: '1', current: '1', enabled: true }])
    await importDetected(root, detect(JSON.stringify({ _postman_variable_scope: 'globals', values: [{ key: 'a', value: '2' }, { key: 'b', value: '3' }] })), vars)
    expect((await vars.read('globals')).map((v) => [v.key, v.initial])).toEqual([['a', '2'], ['b', '3']])
  })
})

describe('cURL', () => {
  it('converts a cURL command into a request', async () => {
    const item = await curlToItem(`curl -X POST 'https://api.test/v1/users?x=1' -H 'Content-Type: application/json' --data-raw '{"a":1}'`)
    expect(item.request).toMatchObject({
      method: 'POST',
      url: 'https://api.test/v1/users?x=1',
      header: [{ key: 'Content-Type', value: 'application/json' }],
      body: { mode: 'raw', raw: '{"a":1}' },
    })
    const form = await curlToItem(`curl -F 'f=@/tmp/a.txt' -F t=v https://x.test/u`)
    expect(form.request.body).toEqual({ mode: 'formdata', formdata: [{ key: 'f', type: 'file', src: '/tmp/a.txt', value: '' }, { type: 'text', key: 't', value: 'v' }] })
  })

  it('turns -u / --user into Basic auth (QA REQ-2)', async () => {
    const basic = (user: string, pass: string) => ({ type: 'basic', basic: [{ key: 'username', value: user }, { key: 'password', value: pass }] })
    expect((await curlToItem(`curl -u alice:secret 'http://127.0.0.1/x'`)).request.auth).toEqual(basic('alice', 'secret'))
    expect((await curlToItem(`curl --user "bob:p w:d" http://127.0.0.1/x`)).request.auth).toEqual(basic('bob', 'p w:d'))
    expect((await curlToItem(`curl --user=carol http://127.0.0.1/x`)).request.auth).toEqual(basic('carol', ''))
  })
})

describe('history', () => {
  const entry = (i: number) => ({ id: `h${i}`, ts: i, name: `n${i}`, item: { name: 'x', request: { method: 'GET', url: `u${i}`, header: [] } } })
  it('lists newest first, deletes one or all', async () => {
    for (let i = 0; i < 3; i++) await appendHistory(root, entry(i))
    expect((await listHistory(root)).map((e) => e.id)).toEqual(['h2', 'h1', 'h0'])
    await deleteHistory(root, 'h1')
    expect((await listHistory(root)).map((e) => e.id)).toEqual(['h2', 'h0'])
    await deleteHistory(root)
    expect(await listHistory(root)).toEqual([])
  })
  it('caps at MAX_HISTORY and skips a truncated last line', async () => {
    for (let i = 0; i < MAX_HISTORY + 120; i++) await appendHistory(root, entry(i))
    const { appendFile } = await import('node:fs/promises')
    await appendFile(join(root, '.pmlocal', 'history.ndjson'), '{"id":"broken"')
    const list = await listHistory(root)
    expect(list).toHaveLength(MAX_HISTORY)
    expect(list[0].id).toBe(`h${MAX_HISTORY + 119}`)
  }, 30_000)
})

describe('ui state', () => {
  it('round-trips and survives garbage', async () => {
    const state = { activeEnvironment: 'environments/Dev.env.json', tabs: [{ id: null, item: { name: 'Draft', request: { method: 'GET', url: 'x', header: [] } } }], activeIndex: 0, favorites: ['collections/Shop'] }
    await writeUiState(root, state)
    expect(await readUiState(root)).toEqual(state)
    const { writeFile } = await import('node:fs/promises')
    await writeFile(join(root, '.pmlocal', 'state.json'), 'nope')
    expect(await readUiState(root)).toEqual({ activeEnvironment: null, tabs: [], activeIndex: -1 })
    await writeFile(join(root, '.pmlocal', 'state.json'), JSON.stringify({ ...state, favorites: [1, 'collections/A'] }))
    expect((await readUiState(root)).favorites).toEqual(['collections/A'])
  })
})
