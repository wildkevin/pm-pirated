import { lstatSync } from 'node:fs'
import { mkdir, readdir, readFile, rename, rm, stat } from 'node:fs/promises'
import { basename, dirname, join, relative, resolve, sep } from 'node:path'
import { sanitizeName, uniqueName } from '../../shared/format/names'
import { stableStringify } from '../../shared/format/stableJson'
import { COLLECTION_SCHEMA, type PmItem, type TreeNode, type WorkspaceInfo } from '../../shared/format/types'
import { writeFileAtomic } from './fsAtomic'

export class WorkspaceError extends Error {}

const REQ_EXT = '.request.json'

interface DirMeta {
  order?: string[]
  name?: string
  info?: { name?: string; schema?: string }
  [extra: string]: unknown
}

const isEnoent = (e: unknown) => (e as NodeJS.ErrnoException).code === 'ENOENT'
const toId = (root: string, abs: string) => relative(root, abs).split(sep).join('/')
const collectionsDir = (root: string) => resolve(root, 'collections')
const isCollectionDir = (root: string, abs: string) => dirname(abs) === collectionsDir(root)
const metaPath = (root: string, dirAbs: string) =>
  join(dirAbs, isCollectionDir(root, dirAbs) ? 'collection.json' : 'folder.json')

async function readJson<T>(file: string): Promise<T> {
  return JSON.parse((await readFile(file, 'utf8')).replace(/^\uFEFF/, '')) as T
}

/** Missing file → empty object. Malformed file → WorkspaceError (we never overwrite it). */
async function readMeta(file: string): Promise<DirMeta> {
  try {
    return await readJson<DirMeta>(file)
  } catch (e) {
    if (isEnoent(e)) return {}
    throw new WorkspaceError(`${basename(file)} is not valid JSON (${(e as Error).message}); fix it first`)
  }
}

/**
 * Maps a renderer-supplied id to an absolute path, refusing anything outside collections/ and
 * any symlink/junction on the way (a cloned workspace could otherwise point writes elsewhere).
 */
export function resolveInside(root: string, id: string): string {
  const base = collectionsDir(root)
  const abs = resolve(root, id)
  if (!abs.startsWith(base + sep)) throw new WorkspaceError(`Path outside workspace: ${id}`)
  let p = base
  for (const part of relative(base, abs).split(sep)) {
    p = join(p, part)
    try {
      if (lstatSync(p).isSymbolicLink()) throw new WorkspaceError(`Symbolic links are not allowed in a workspace: ${id}`)
    } catch (e) {
      if (e instanceof WorkspaceError) throw e
      break // the rest of the path does not exist yet
    }
  }
  return abs
}

function requestPath(root: string, id: string): string {
  const abs = resolveInside(root, id)
  if (!abs.endsWith(REQ_EXT)) throw new WorkspaceError(`Not a request: ${id}`)
  return abs
}

export async function isWorkspace(root: string): Promise<boolean> {
  try {
    return (await stat(join(root, 'workspace.json'))).isFile()
  } catch {
    return false
  }
}

export async function initWorkspace(root: string): Promise<WorkspaceInfo> {
  await mkdir(join(root, 'collections'), { recursive: true })
  await mkdir(join(root, '.pmlocal'), { recursive: true })
  await writeFileAtomic(join(root, '.pmlocal', '.gitignore'), '*\n')
  await writeFileAtomic(join(root, 'workspace.json'), stableStringify({ name: basename(root), formatVersion: 1 }))
  return openWorkspace(root)
}

export async function openWorkspace(root: string): Promise<WorkspaceInfo> {
  let meta: { name?: string; formatVersion?: number }
  try {
    meta = await readJson(join(root, 'workspace.json'))
  } catch (e) {
    throw new WorkspaceError(`Cannot read workspace.json in ${root}: ${(e as Error).message}`)
  }
  if (meta.formatVersion !== 1) throw new WorkspaceError(`Unsupported workspace format: ${meta.formatVersion}`)
  const dir = collectionsDir(root)
  const entries = await readdir(dir, { withFileTypes: true }).catch((e) => (isEnoent(e) ? [] : Promise.reject(e)))
  const collections = await Promise.all(
    entries.filter((e) => e.isDirectory()).map((e) => loadDir(root, join(dir, e.name), 'collection')),
  )
  return { root, name: meta.name ?? basename(root), collections: collections.sort((a, b) => a.name.localeCompare(b.name)) }
}

async function loadDir(root: string, abs: string, kind: 'collection' | 'folder'): Promise<TreeNode> {
  const node: TreeNode = { kind, id: toId(root, abs), name: basename(abs), children: [] }
  let meta: DirMeta = {}
  try {
    meta = await readMeta(metaPath(root, abs))
    node.name = (kind === 'collection' ? meta.info?.name : meta.name) ?? node.name
  } catch (e) {
    node.error = (e as Error).message
  }
  const entries = await readdir(abs, { withFileTypes: true })
  const children = await Promise.all(
    entries.map(async (e): Promise<[string, TreeNode] | undefined> => {
      if (e.isDirectory()) return [e.name, await loadDir(root, join(abs, e.name), 'folder')]
      if (e.isFile() && e.name.endsWith(REQ_EXT)) return [e.name, await loadRequestNode(root, join(abs, e.name))]
      return undefined
    }),
  )
  const order = meta.order ?? []
  const rank = (name: string) => (order.includes(name) ? order.indexOf(name) : order.length)
  node.children = children
    .filter((c): c is [string, TreeNode] => c !== undefined)
    .sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b))
    .map(([, n]) => n)
  return node
}

async function loadRequestNode(root: string, abs: string): Promise<TreeNode> {
  const node: TreeNode = { kind: 'request', id: toId(root, abs), name: basename(abs, REQ_EXT) }
  try {
    const item = await readJson<Partial<PmItem>>(abs)
    node.name = item.name ?? node.name
    node.method = item.request?.method ?? 'GET'
  } catch (e) {
    node.error = `Invalid JSON: ${(e as Error).message}`
  }
  return node
}

async function entryNames(dir: string): Promise<string[]> {
  return readdir(dir)
}

async function updateOrder(root: string, dirAbs: string, change: (order: string[]) => string[]): Promise<void> {
  if (dirAbs === collectionsDir(root)) return
  const file = metaPath(root, dirAbs)
  const meta = await readMeta(file)
  meta.order = change(meta.order ?? [])
  await writeFileAtomic(file, stableStringify(meta))
}

export async function createCollection(root: string, name: string): Promise<string> {
  const base = collectionsDir(root)
  await mkdir(base, { recursive: true })
  const abs = join(base, uniqueName(sanitizeName(name), await entryNames(base)))
  await mkdir(abs)
  await writeFileAtomic(join(abs, 'collection.json'), stableStringify({ info: { name, schema: COLLECTION_SCHEMA }, order: [] }))
  return toId(root, abs)
}

export async function createFolder(root: string, parentId: string, name: string): Promise<string> {
  const parent = resolveInside(root, parentId)
  await readMeta(metaPath(root, parent)) // fail before touching disk if the parent meta is damaged
  const dirName = uniqueName(sanitizeName(name), await entryNames(parent))
  await mkdir(join(parent, dirName))
  await writeFileAtomic(join(parent, dirName, 'folder.json'), stableStringify({ name, order: [] }))
  await updateOrder(root, parent, (o) => [...o, dirName])
  return toId(root, join(parent, dirName))
}

export async function createRequest(root: string, parentId: string, name: string): Promise<string> {
  const parent = resolveInside(root, parentId)
  await readMeta(metaPath(root, parent))
  const fileName = uniqueName(sanitizeName(name), await entryNames(parent), REQ_EXT)
  const item: PmItem = { name, request: { method: 'GET', url: '', header: [] }, response: [] }
  await writeFileAtomic(join(parent, fileName), stableStringify(item))
  await updateOrder(root, parent, (o) => [...o, fileName])
  return toId(root, join(parent, fileName))
}

export async function readRequest(root: string, id: string): Promise<PmItem> {
  const file = requestPath(root, id)
  try {
    return await readJson<PmItem>(file)
  } catch (e) {
    throw new WorkspaceError(`Cannot read ${basename(file)}: ${(e as Error).message}`)
  }
}

export async function saveRequest(root: string, id: string, item: PmItem): Promise<void> {
  await writeFileAtomic(requestPath(root, id), stableStringify(item))
}

export async function renameNode(root: string, id: string, name: string): Promise<string> {
  const abs = resolveInside(root, id)
  if (abs.endsWith(REQ_EXT)) {
    const item = await readRequest(root, id)
    await saveRequest(root, id, { ...item, name })
  } else {
    const file = metaPath(root, abs)
    const meta = await readMeta(file)
    if (isCollectionDir(root, abs)) meta.info = { schema: COLLECTION_SCHEMA, ...meta.info, name }
    else meta.name = name
    await writeFileAtomic(file, stableStringify(meta))
  }
  return moveToName(root, abs, name)
}

/** Renames the file/folder to match the display name so the folder stays readable in git. */
async function moveToName(root: string, abs: string, name: string): Promise<string> {
  const ext = abs.endsWith(REQ_EXT) ? REQ_EXT : ''
  const oldEntry = basename(abs)
  const parent = dirname(abs)
  const taken = (await entryNames(parent)).filter((n) => n !== oldEntry)
  const newEntry = uniqueName(sanitizeName(name), taken, ext)
  if (newEntry === oldEntry) return toId(root, abs)
  await rename(abs, join(parent, newEntry))
  await updateOrder(root, parent, (o) => o.map((n) => (n === oldEntry ? newEntry : n)))
  return toId(root, join(parent, newEntry))
}

export async function deleteNode(root: string, id: string): Promise<void> {
  const abs = resolveInside(root, id)
  await rm(abs, { recursive: true, force: true })
  const entry = basename(abs)
  await updateOrder(root, dirname(abs), (o) => o.filter((n) => n !== entry)).catch(() => undefined)
}
