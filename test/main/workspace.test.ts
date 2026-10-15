import { mkdir, mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  WorkspaceError,
  createCollection,
  createFolder,
  createRequest,
  deleteNode,
  initWorkspace,
  isWorkspace,
  openWorkspace,
  readRequest,
  renameNode,
  resolveInside,
  saveRequest,
} from '../../src/main/workspace/store'
import { writeFileAtomic } from '../../src/main/workspace/fsAtomic'
import type { TreeNode } from '../../src/shared/format/types'

let root: string
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'pml-ws-'))
})

const names = (nodes: TreeNode[] = []) => nodes.map((n) => n.name)

describe('workspace lifecycle', () => {
  it('initialises an empty folder', async () => {
    const info = await initWorkspace(root)
    expect(info.collections).toEqual([])
    expect(await isWorkspace(root)).toBe(true)
    expect(await readFile(join(root, '.pmlocal', '.gitignore'), 'utf8')).toBe('*\n')
    expect(JSON.parse(await readFile(join(root, 'workspace.json'), 'utf8')).formatVersion).toBe(1)
  })

  it('refuses to open a folder that is not a workspace', async () => {
    expect(await isWorkspace(root)).toBe(false)
    await expect(openWorkspace(root)).rejects.toBeInstanceOf(WorkspaceError)
  })
})

describe('tree editing', () => {
  beforeEach(() => initWorkspace(root).then(() => undefined))

  it('builds the tree in creation order', async () => {
    const col = await createCollection(root, 'Billing API')
    const folder = await createFolder(root, col, 'Customers')
    await createRequest(root, folder, 'Get customer')
    await createRequest(root, col, 'Health')
    await createRequest(root, folder, 'Create customer')

    const [c] = (await openWorkspace(root)).collections
    expect(c.name).toBe('Billing API')
    expect(c.kind).toBe('collection')
    expect(names(c.children)).toEqual(['Customers', 'Health'])
    expect(names(c.children![0].children)).toEqual(['Get customer', 'Create customer'])
    expect(c.children![0].children![0]).toMatchObject({ kind: 'request', method: 'GET' })
  })

  it('keeps display names that are illegal or duplicate as file names', async () => {
    const col = await createCollection(root, 'C')
    const a = await createRequest(root, col, 'a/b')
    const b = await createRequest(root, col, 'a/b')
    expect(a).toBe('collections/C/a_b.request.json')
    expect(b).toBe('collections/C/a_b (2).request.json')
    const [c] = (await openWorkspace(root)).collections
    expect(names(c.children)).toEqual(['a/b', 'a/b'])
  })

  it('saves and reads a request with stable formatting', async () => {
    const col = await createCollection(root, 'C')
    const id = await createRequest(root, col, 'R')
    const item = await readRequest(root, id)
    item.request.method = 'POST'
    item.request.url = 'http://example.test'
    await saveRequest(root, id, item)
    expect(await readRequest(root, id)).toEqual(item)
    const text = await readFile(join(root, id), 'utf8')
    expect(text.endsWith('}\n')).toBe(true)
    expect(text.indexOf('"name"')).toBeLessThan(text.indexOf('"request"'))
  })

  it('renames without moving files', async () => {
    const col = await createCollection(root, 'C')
    const folder = await createFolder(root, col, 'F')
    const req = await createRequest(root, folder, 'R')
    await renameNode(root, col, 'C2')
    await renameNode(root, folder, 'F2')
    await renameNode(root, req, 'R2')
    const [c] = (await openWorkspace(root)).collections
    expect(c.name).toBe('C2')
    expect(c.children![0].name).toBe('F2')
    expect(c.children![0].children![0]).toMatchObject({ id: req, name: 'R2' })
  })

  it('deletes nodes and their order entries', async () => {
    const col = await createCollection(root, 'C')
    const folder = await createFolder(root, col, 'F')
    await createRequest(root, folder, 'R')
    const keep = await createRequest(root, col, 'Keep')
    await deleteNode(root, folder)
    const [c] = (await openWorkspace(root)).collections
    expect(c.children!.map((n) => n.id)).toEqual([keep])
    const meta = JSON.parse(await readFile(join(root, col, 'collection.json'), 'utf8'))
    expect(meta.order).toEqual(['Keep.request.json'])
  })

  it('lists unordered entries alphabetically after ordered ones', async () => {
    const col = await createCollection(root, 'C')
    await createRequest(root, col, 'Zeta')
    await writeFile(join(root, col, 'Beta.request.json'), JSON.stringify({ name: 'Beta', request: {} }))
    await writeFile(join(root, col, 'Alpha.request.json'), JSON.stringify({ name: 'Alpha', request: {} }))
    const [c] = (await openWorkspace(root)).collections
    expect(names(c.children)).toEqual(['Zeta', 'Alpha', 'Beta'])
  })

  it('treats a plain directory as a folder named after it', async () => {
    const col = await createCollection(root, 'C')
    await mkdir(join(root, col, 'Plain'))
    const [c] = (await openWorkspace(root)).collections
    expect(c.children![0]).toMatchObject({ kind: 'folder', name: 'Plain' })
    expect(c.children![0].error).toBeUndefined()
  })
})

describe('damaged files', () => {
  beforeEach(() => initWorkspace(root).then(() => undefined))

  it('flags a malformed request but still loads the rest', async () => {
    const col = await createCollection(root, 'C')
    await createRequest(root, col, 'Good')
    await writeFile(join(root, col, 'Bad.request.json'), '{ not json')
    const [c] = (await openWorkspace(root)).collections
    const bad = c.children!.find((n) => n.id.endsWith('Bad.request.json'))!
    expect(bad.error).toMatch(/JSON/)
    expect(c.children!.find((n) => n.name === 'Good')?.error).toBeUndefined()
  })

  it('reads files saved with a UTF-8 BOM (Windows Notepad)', async () => {
    const col = await createCollection(root, 'C')
    await writeFile(join(root, col, 'Bom.request.json'), '\uFEFF' + JSON.stringify({ name: 'Bom', request: {} }))
    const [c] = (await openWorkspace(root)).collections
    expect(c.children![0]).toMatchObject({ name: 'Bom' })
    expect(c.children![0].error).toBeUndefined()
  })

  it('never overwrites a malformed folder.json', async () => {
    const col = await createCollection(root, 'C')
    const folder = await createFolder(root, col, 'F')
    await writeFile(join(root, folder, 'folder.json'), '{ broken')
    await expect(createRequest(root, folder, 'R')).rejects.toBeInstanceOf(WorkspaceError)
    expect(await readFile(join(root, folder, 'folder.json'), 'utf8')).toBe('{ broken')
    const [c] = (await openWorkspace(root)).collections
    expect(c.children![0].error).toMatch(/folder\.json/)
  })
})

describe('resolveInside', () => {
  it('rejects ids that escape the collections folder', () => {
    for (const bad of ['../outside', 'collections/../../x', 'workspace.json', 'collections', '']) {
      expect(() => resolveInside(root, bad), bad).toThrow(WorkspaceError)
    }
    expect(resolveInside(root, 'collections/A/b.request.json')).toBe(
      join(root, 'collections', 'A', 'b.request.json'),
    )
  })
})

describe('writeFileAtomic', () => {
  it('overwrites and leaves no temp files', async () => {
    const f = join(root, 'x.json')
    await writeFileAtomic(f, 'one')
    await writeFileAtomic(f, 'two')
    expect(await readFile(f, 'utf8')).toBe('two')
    expect(await readdir(root)).toEqual(['x.json'])
  })
})
