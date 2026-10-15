import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { buildRoutes, createDefinition, deleteDefinition, readDefinitions, saveDefinition } from '../../src/main/mocks'
import { createCollection, createFolder, createRequest, initWorkspace } from '../../src/main/workspace/store'

let root: string
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'pml-mock-'))
  await initWorkspace(root)
})

const def = (extra = {}) => ({ name: 'Users mock', target: 'collections/C', port: 3000, allowLan: false, delayMs: 0, autoStart: false, ...extra })

describe('mock routes from saved examples', () => {
  it('builds one route per example, using the example request when present', async () => {
    const col = await createCollection(root, 'C')
    const f = await createFolder(root, col, 'F')
    await createRequest(root, f, 'Get user', {
      name: 'Get user',
      request: { method: 'GET', url: '{{base}}/users/:id', header: [] },
      response: [
        { name: 'Found', code: 200, status: 'OK', header: [{ key: 'Content-Type', value: 'application/json' }], body: '{"id":1}' },
        { name: 'Search', originalRequest: { method: 'GET', url: { raw: 'https://x/users?q=ada' } }, code: 200, body: '[]' },
      ],
    })
    await createRequest(root, col, 'No examples')
    const routes = await buildRoutes(root, col)
    expect(routes.map((r) => [r.exampleName, r.method, r.path, r.query.map((q) => q.key)])).toEqual([
      ['Found', 'GET', '/users/:id', []],
      ['Search', 'GET', '/users', ['q']],
    ])
    expect(routes[0].response).toEqual({ code: 200, status: 'OK', headers: [{ key: 'Content-Type', value: 'application/json' }], body: '{"id":1}' })
    expect(await buildRoutes(root, f)).toHaveLength(2)
    expect(await buildRoutes(root, `${col}/Nope`)).toEqual([])
  })
})

describe('mock definitions', () => {
  it('creates, lists, saves and deletes; validates input', async () => {
    const id = await createDefinition(root, def())
    expect(id).toBe('mocks/Users mock.mock.json')
    await saveDefinition(root, id, def({ port: 4000 }))
    expect((await readDefinitions(root)).map((d) => [d.id, d.def.port])).toEqual([[id, 4000]])
    await expect(createDefinition(root, def({ port: 70000 }))).rejects.toThrow(/Port/)
    await expect(createDefinition(root, def({ target: '../x' }))).rejects.toThrow(/collection/)
    await expect(saveDefinition(root, 'mocks/../../evil.mock.json', def())).rejects.toThrow(/Not a mock/)
    await deleteDefinition(root, id)
    expect(await readDefinitions(root)).toEqual([])
  })
})
