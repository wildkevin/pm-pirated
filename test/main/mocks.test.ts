import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildRoutes, createDefinition, deleteDefinition, readDefinitions, saveDefinition, MockManager, type MockClient } from '../../src/main/mocks'
import { createCollection, createFolder, createRequest, deleteNode, initWorkspace } from '../../src/main/workspace/store'

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
    await expect(buildRoutes(root, `${col}/Nope`)).rejects.toThrow(/target folder no longer exists/)
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


describe('mock lifecycle regressions', () => {
  it('forwards CORS and prevents two mocks sharing a port across bind addresses', async () => {
    const col = await createCollection(root, 'C')
    const first = await createDefinition(root, def({ target: col, cors: true }))
    const second = await createDefinition(root, def({ name: 'LAN', target: col, allowLan: true }))
    const call = vi.fn(async () => ({ url: 'http://127.0.0.1:3000' }))
    const manager = new MockManager({ call } as unknown as MockClient, () => undefined)
    expect((await manager.start(root, first)).running).toBe(true)
    expect(call).toHaveBeenCalledWith('start', expect.objectContaining({ cors: true, host: '127.0.0.1' }))
    expect(await manager.start(root, second)).toMatchObject({ running: false, error: expect.stringContaining('already in use') })
    expect(call).toHaveBeenCalledTimes(1)
    await manager.stop(first)
    expect((await manager.start(root, second)).running).toBe(true)
  })

  it('keeps an existing empty folder valid, but stops its mock after that folder is deleted', async () => {
    const col = await createCollection(root, 'C')
    const folder = await createFolder(root, col, 'Empty')
    expect(await buildRoutes(root, folder)).toEqual([])
    const id = await createDefinition(root, def({ target: folder }))
    const call = vi.fn(async () => ({ url: 'http://127.0.0.1:3000' }))
    const manager = new MockManager({ call } as unknown as MockClient, () => undefined)
    expect((await manager.start(root, id)).running).toBe(true)
    await deleteNode(root, folder)
    await manager.refresh(root, col)
    expect(call).toHaveBeenCalledWith('stop', { id })
    expect(manager.isRunning(id)).toBe(false)
    expect((await manager.list(root))[0].status).toMatchObject({ running: false, error: expect.stringContaining('unavailable') })
  })

  it('stops a running mock and reports a deleted collection during route refresh', async () => {
    const col = await createCollection(root, 'C')
    const id = await createDefinition(root, def({ target: col }))
    const call = vi.fn(async () => ({ url: 'http://127.0.0.1:3000' }))
    const manager = new MockManager({ call } as unknown as MockClient, () => undefined)
    await manager.start(root, id)
    await deleteNode(root, col)
    await manager.refresh(root, col)
    expect(call).toHaveBeenCalledWith('stop', { id })
    expect(manager.isRunning(id)).toBe(false)
    expect((await manager.list(root))[0].status).toMatchObject({ running: false, error: expect.stringContaining('unavailable') })
  })
})
