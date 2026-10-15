import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Url } from 'postman-collection'
import { queryParams, rawUrl, setQueryParams } from '../../src/shared/format/url'
import { beforeEach, describe, expect, it } from 'vitest'
import { applyAuth, codeLanguages, generateCode, substitute } from '../../src/main/codegen'
import { buildRunCollection, deleteRun, listRuns, previewData, prune, readDataFile, readRun, saveRun } from '../../src/main/runner'
import { createCollection, createFolder, createRequest, initWorkspace } from '../../src/main/workspace/store'
import type { PmItem } from '../../src/shared/format/types'
import type { RunRecord } from '../../src/shared/ipc'

let root: string
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'pml-runner-'))
  await initWorkspace(root)
})

describe('run collection', () => {
  it('prunes to the selected requests and keeps the folder chain', async () => {
    const col = await createCollection(root, 'C', { auth: { type: 'bearer', bearer: [] } })
    const f = await createFolder(root, col, 'F', { event: [{ listen: 'prerequest', script: { exec: ['x'] } }] })
    const a = await createRequest(root, f, 'A')
    await createRequest(root, f, 'B')
    const c = await createRequest(root, col, 'C1')
    const doc = await buildRunCollection(root, col, [a, c])
    expect(doc.auth).toEqual({ type: 'bearer', bearer: [] })
    expect(doc.item.map((i: any) => i.name)).toEqual(['F', 'C1'])
    expect(doc.item[0].event).toHaveLength(1)
    expect(doc.item[0].item.map((i: any) => [i.name, i.id])).toEqual([['A', a]])

    // running a folder only takes requests inside it
    const folderRun = await buildRunCollection(root, f, [a, c])
    expect(folderRun.item.map((i: any) => i.name)).toEqual(['F'])
    await expect(buildRunCollection(root, col, [])).rejects.toThrow(/Select at least one/)
  })

  it('uses the same GET body default as individual sends and preserves an explicit opt-out', async () => {
    const col = await createCollection(root, 'Bodies')
    const make = (name: string, prune?: boolean) => createRequest(root, col, name, {
      name,
      request: { method: 'GET', url: 'http://example.test/', header: [], body: { mode: 'raw', raw: 'payload' } },
      ...(prune === undefined ? {} : { protocolProfileBehavior: { disableBodyPruning: prune } }),
    })
    const ids = [await make('Default'), await make('Opt out', false)]
    const doc = await buildRunCollection(root, col, ids)
    expect(doc.item.map((item: any) => item.protocolProfileBehavior.disableBodyPruning)).toEqual([true, false])
  })

  it('prune drops empty folders', () => {
    expect(prune([{ name: 'F', item: [{ id: 'x' }] }, { id: 'y' }], new Set(['y']))).toEqual([{ id: 'y' }])
  })
})

describe('data files', () => {
  it('reads CSV with quotes and a BOM, and JSON arrays', async () => {
    await writeFile(join(root, 'd.csv'), '\uFEFFuser,note\nada,"hello, world"\nbob,"say ""hi"""\n')
    expect(await readDataFile(join(root, 'd.csv'))).toEqual([{ user: 'ada', note: 'hello, world' }, { user: 'bob', note: 'say "hi"' }])
    await writeFile(join(root, 'd.json'), '[{"user":"ada","n":1}]')
    expect(await previewData(join(root, 'd.json'))).toEqual({ rows: [{ user: 'ada', n: 1 }], count: 1, columns: ['user', 'n'] })
  })
  it.each([['empty.csv', ''], ['header.csv', 'user\n'], ['empty.json', '[]']])('rejects data files without data rows: %s', async (name, content) => {
    const file = join(root, name)
    await writeFile(file, content)
    await expect(readDataFile(file)).rejects.toThrow(/no rows/)
    await expect(previewData(file)).rejects.toThrow(/no rows/)
  })
  it('explains bad files', async () => {
    await writeFile(join(root, 'bad.json'), '{"not":"an array"}')
    await expect(readDataFile(join(root, 'bad.json'))).rejects.toThrow(/array of objects/)
    await writeFile(join(root, 'broken.json'), '[{')
    await expect(readDataFile(join(root, 'broken.json'))).rejects.toThrow(/not valid JSON/)
  })
})

describe('saved runs', () => {
  it('saves, lists newest first, reads and deletes; rejects odd ids', async () => {
    const rec = (id: string, startedAt: number): RunRecord => ({
      id,
      name: 'C',
      startedAt,
      target: 'collections/C',
      environment: null,
      config: { target: 'collections/C', requestIds: [], environmentId: null, iterations: 1, delayMs: 0, dataFile: null, persistResponses: false, keepVariables: true, stopOnError: false },
      summary: null,
      results: [],
    })
    await saveRun(root, rec('r1', 1))
    await saveRun(root, rec('r2', 2))
    expect((await listRuns(root)).map((r) => r.id)).toEqual(['r2', 'r1'])
    expect((await readRun(root, 'r1')).startedAt).toBe(1)
    await deleteRun(root, 'r1')
    expect((await listRuns(root)).map((r) => r.id)).toEqual(['r2'])
    await expect(readRun(root, '../../etc/passwd')).rejects.toThrow(/Invalid run id/)
  })
})

describe('redaction', () => {
  it('masks credential headers and secret values everywhere they appear', async () => {
    const { redactRecord } = await import('../../src/main/runner')
    const out = redactRecord(
      {
        id: 'r',
        name: 'C',
        startedAt: 0,
        target: 't',
        environment: null,
        config: {} as never,
        summary: null,
        results: [
          {
            iteration: 0,
            requestId: 'x',
            name: 'x',
            method: 'GET',
            url: 'https://a/?key=S3CRET-KEY&enc=S3CRET%20KEY',
            error: 'failed for S3CRET-KEY',
            tests: [{ name: 'uses S3CRET-KEY', passed: false, skipped: false, error: 'expected S3CRET-KEY' }],
            scriptErrors: ['boom S3CRET-KEY'],
            logs: [{ level: 'log', args: ['token is S3CRET-KEY'] }],
            sent: { method: 'GET', url: 'https://a/?key=S3CRET-KEY', headers: [{ key: 'Authorization', value: 'Bearer abc' }, { key: 'X-Other', value: 'v S3CRET-KEY' }], body: 'pw=S3CRET-KEY' },
            response: { headers: [{ key: 'Set-Cookie', value: 'sid=1' }], body: 'echo S3CRET-KEY' },
          },
        ],
      },
      ['S3CRET-KEY', 'abc', 'S3CRET KEY'],
    )
    const text = JSON.stringify(out)
    expect(text).not.toContain('S3CRET-KEY')
    expect(text).not.toContain('S3CRET%20KEY')
    expect(text).not.toContain('Bearer abc')
    expect(text).not.toContain('sid=1')
    expect(out.results[0].sent!.headers[1].value).toBe('v ••••••')
  })
})

describe('code snippets', () => {
  const item: PmItem = {
    name: 'x',
    request: {
      method: 'POST',
      url: '{{base}}/users?x=1',
      header: [{ key: 'Content-Type', value: 'application/json' }, { key: 'X-Off', value: '1', disabled: true }],
      body: { mode: 'raw', raw: '{"a":"{{who}}"}' },
    },
  }

  it('lists languages without Postman CLI', () => {
    const langs = codeLanguages()
    expect(langs.find((l) => l.key === 'curl')?.variants).toEqual(['cURL'])
    expect(langs.find((l) => l.key === 'powershell')).toBeTruthy()
    expect(langs.find((l) => l.key === 'postman-cli')).toBeUndefined()
  })

  it('generates cURL with variables resolved, disabled headers dropped and auth applied', async () => {
    const code = await generateCode(item, { type: 'bearer', bearer: [{ key: 'token', value: '{{tok}}' }] }, [
      { key: 'base', value: 'https://api.test' },
      { key: 'who', value: 'ada' },
      { key: 'tok', value: 'T1' },
    ], 'curl', 'cURL')
    expect(code).toContain("'https://api.test/users?x=1'")
    expect(code).toContain('Authorization: Bearer T1')
    expect(code).toContain('{"a":"ada"}')
    expect(code).not.toContain('X-Off')
  })

  it('adds the Content-Type the app sends for raw bodies, unless one is set (QA RES-2)', async () => {
    const post = (language: 'json' | 'xml', header: { key: string; value: string }[] = []) => ({
      name: 'p',
      request: { method: 'POST', url: 'http://h.test/e', header, body: { mode: 'raw' as const, raw: '{"a":1}', options: { raw: { language } } } },
    })
    expect(await generateCode(post('json'), undefined, [], 'curl', 'cURL')).toContain("Content-Type: application/json")
    expect(await generateCode(post('xml'), undefined, [], 'python', 'Requests')).toContain("'Content-Type': 'application/xml'")
    const own = await generateCode(post('json', [{ key: 'content-type', value: 'application/vnd.x+json' }]), undefined, [], 'curl', 'cURL')
    expect(own).toContain('application/vnd.x+json')
    expect(own).not.toContain('application/json')
  })

  it('copes with quotes and backslashes in variable values', async () => {
    const code = await generateCode(item, undefined, [{ key: 'base', value: 'https://api.test' }, { key: 'who', value: 'a"b\\c' }], 'curl', 'cURL')
    expect(code).toContain('{"a":"a"b\\c"}') // inserted as typed, like Postman
  })

  it('keeps unknown variables and supports other languages', async () => {
    expect(substitute('{{a}}/{{ b }}', new Map([['b', '2']]))).toBe('{{a}}/2')
    const py = await generateCode(item, undefined, [{ key: 'base', value: 'https://api.test' }], 'python', 'Requests')
    expect(py).toContain('import requests')
  })

  it('applies API key auth to the query string', () => {
    const r = applyAuth(item, { type: 'apikey', apikey: [{ key: 'key', value: 'k' }, { key: 'value', value: 'v' }, { key: 'in', value: 'query' }] })
    expect(r.request.url).toBe('{{base}}/users?x=1&k=v')
  })
})


it('preserves encoded query values, bare flags, and disabled rows through run collection export', async () => {
  const col = await createCollection(root, 'Query encoding')
  const original = 'https://example.test/?q=a%2Bb&delimiters=a%26b%3Dc%20d%23e&empty=&flag&off=a%2Bb'
  const url = setQueryParams(original, queryParams(original).map(row => row.key === 'off' ? { ...row, disabled: true } : row))
  const id = await createRequest(root, col, 'R', { name: 'R', request: { method: 'GET', url, header: [] } })
  const doc = await buildRunCollection(root, col, [id])
  const exported = doc.item[0].request.url
  expect(new Url(exported).toString()).toBe(rawUrl(url))
  expect(exported.query).toEqual([
    { key: 'q', value: 'a%2Bb' },
    { key: 'delimiters', value: 'a%26b%3Dc%20d%23e' },
    { key: 'empty', value: '' },
    { key: 'flag', value: null },
    { key: 'off', value: 'a%2Bb', disabled: true },
  ])
})
