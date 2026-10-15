import { lstatSync } from 'node:fs'
import { cp, mkdir, readdir, readFile, rename, rm, stat } from 'node:fs/promises'
import { basename, dirname, join, relative, resolve, sep } from 'node:path'
import { sanitizeName, uniqueName } from '../../shared/format/names'
import { stableStringify } from '../../shared/format/stableJson'
import { randomUUID } from 'node:crypto'
import { COLLECTION_SCHEMA, type PmContainer, type PmItem, type TreeNode, type WorkspaceInfo } from '../../shared/format/types'
import { writeFileAtomic } from './fsAtomic'
import { listEnvironments } from './variables'

export class WorkspaceError extends Error {}

const REQ_EXT = '.request.json'

interface DirMeta {
  order?: string[]
  name?: string
  info?: { name?: string; schema?: string; _postman_id?: string; description?: string }
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

export async function initWorkspace(root: string, name = basename(root)): Promise<WorkspaceInfo> {
  await mkdir(join(root, 'collections'), { recursive: true })
  await mkdir(join(root, '.pmlocal'), { recursive: true })
  await writeFileAtomic(join(root, '.pmlocal', '.gitignore'), '*\n')
  await writeFileAtomic(join(root, 'workspace.json'), stableStringify({ name, formatVersion: 1 }))
  return openWorkspace(root)
}

/** Name from workspace.json, or null when the folder is not (or no longer) a workspace. */
export async function workspaceName(root: string): Promise<string | null> {
  try {
    const meta = await readJson<{ name?: string }>(join(root, 'workspace.json'))
    return meta.name ?? basename(root)
  } catch {
    return null
  }
}

/** Read-only preview uses the same naming rules as creation. */
export async function previewWorkspacePath(parent: string, name: string): Promise<string> {
  const taken = await entryNames(parent).catch((e) => { if (isEnoent(e)) return []; throw e })
  return join(parent, uniqueName(sanitizeName(name), taken))
}

/** New workspace folder "<parent>/<name>" (made unique), initialised and named. */
export async function createWorkspaceIn(parent: string, name: string): Promise<string> {
  await mkdir(parent, { recursive: true })
  const dir = await previewWorkspacePath(parent, name)
  await mkdir(dir)
  await initWorkspace(dir, name)
  return dir
}

export async function openWorkspace(root: string): Promise<WorkspaceInfo> {
  let meta: { name?: string; formatVersion?: number }
  try {
    meta = await readJson(join(root, 'workspace.json'))
  } catch (e) {
    throw new WorkspaceError(`Cannot read workspace.json in ${root}: ${(e as Error).message}`)
  }
  if (meta.formatVersion !== 1) throw new WorkspaceError(`Unsupported workspace format: ${meta.formatVersion}`)
  // Local state is not versioned; a freshly copied/cloned workspace may not have it yet.
  const local = join(root, '.pmlocal')
  try { if (lstatSync(local).isSymbolicLink()) throw new WorkspaceError('The workspace local-state folder must not be a symbolic link') }
  catch (e) { if (!isEnoent(e)) throw e }
  await mkdir(local, { recursive: true })
  await writeFileAtomic(join(local, '.gitignore'), '*\n')
  const dir = collectionsDir(root)
  const entries = await readdir(dir, { withFileTypes: true }).catch((e) => (isEnoent(e) ? [] : Promise.reject(e)))
  const collections = await Promise.all(
    entries.filter((e) => e.isDirectory()).map((e) => loadDir(root, join(dir, e.name), 'collection')),
  )
  return {
    root,
    name: meta.name ?? basename(root),
    collections: collections.sort((a, b) => a.name.localeCompare(b.name)),
    environments: await listEnvironments(root),
  }
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

/** `extra` carries imported content (auth, event, variable, description…). */
export async function createCollection(root: string, name: string, extra: Partial<PmContainer> = {}): Promise<string> {
  const base = collectionsDir(root)
  await mkdir(base, { recursive: true })
  const abs = join(base, uniqueName(sanitizeName(name), await entryNames(base)))
  await mkdir(abs)
  const { description, name: _n, ...rest } = extra
  const info = { name, schema: COLLECTION_SCHEMA, _postman_id: randomUUID(), ...(description ? { description } : {}) }
  await writeFileAtomic(join(abs, 'collection.json'), stableStringify({ ...rest, info, order: [] }))
  return toId(root, abs)
}

export async function createFolder(root: string, parentId: string, name: string, extra: Partial<PmContainer> = {}): Promise<string> {
  const parent = resolveInside(root, parentId)
  await readMeta(metaPath(root, parent)) // fail before touching disk if the parent meta is damaged
  const dirName = uniqueName(sanitizeName(name), await entryNames(parent))
  await mkdir(join(parent, dirName))
  await writeFileAtomic(join(parent, dirName, 'folder.json'), stableStringify({ ...extra, name, order: [] }))
  await updateOrder(root, parent, (o) => [...o, dirName])
  return toId(root, join(parent, dirName))
}

export async function createRequest(root: string, parentId: string, name: string, content?: PmItem): Promise<string> {
  const parent = resolveInside(root, parentId)
  await readMeta(metaPath(root, parent))
  const fileName = uniqueName(sanitizeName(name), await entryNames(parent), REQ_EXT)
  const item: PmItem = content ? { ...content, name } : { name, request: { method: 'GET', url: '', header: [] }, response: [] }
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

/** Copies a request, folder or collection next to the original as "<name> Copy". */
export async function duplicateNode(root: string, id: string): Promise<string> {
  const abs = resolveInside(root, id)
  const parent = dirname(abs)
  const ext = abs.endsWith(REQ_EXT) ? REQ_EXT : ''
  const isRequest = ext === REQ_EXT
  const collection = !isRequest && isCollectionDir(root, abs)
  const meta = isRequest ? undefined : await readMeta(metaPath(root, abs))
  const original = isRequest ? (await readRequest(root, id)).name : ((collection ? meta?.info?.name : meta?.name) ?? basename(abs))
  const name = `${original} Copy`
  const entry = uniqueName(sanitizeName(name), await entryNames(parent), ext)
  const dest = join(parent, entry)
  await cp(abs, dest, { recursive: true, errorOnExist: true, force: false })
  if (isRequest) await saveRequest(root, toId(root, dest), { ...(await readRequest(root, toId(root, dest))), name })
  else {
    const file = metaPath(root, dest)
    const meta = await readMeta(file)
    if (collection) meta.info = { ...meta.info, name, _postman_id: randomUUID() }
    else meta.name = name
    await writeFileAtomic(file, stableStringify(meta))
  }
  const originalEntry = basename(abs)
  await updateOrder(root, parent, (o) => {
    const i = o.indexOf(originalEntry)
    return i === -1 ? [...o, entry] : [...o.slice(0, i + 1), entry, ...o.slice(i + 1)]
  })
  return toId(root, dest)
}

export async function deleteNode(root: string, id: string): Promise<void> {
  const abs = resolveInside(root, id)
  await rm(abs, { recursive: true, force: true })
  const entry = basename(abs)
  await updateOrder(root, dirname(abs), (o) => o.filter((n) => n !== entry)).catch(() => undefined)
}

/** Auth, scripts and description of a collection or folder (variables are handled by Variables). */
export async function readContainer(root: string, id: string): Promise<PmContainer> {
  const abs = resolveInside(root, id)
  if (abs.endsWith(REQ_EXT)) throw new WorkspaceError(`Not a collection or folder: ${id}`)
  const meta = await readMeta(metaPath(root, abs))
  const collection = isCollectionDir(root, abs)
  const name = (collection ? meta.info?.name : meta.name) ?? basename(abs)
  const description = (collection ? meta.info?.description : (meta.description as string | undefined)) ?? undefined
  return {
    name,
    ...(meta.auth ? { auth: meta.auth as PmContainer['auth'] } : {}),
    ...(meta.event ? { event: meta.event as PmContainer['event'] } : {}),
    ...(description ? { description } : {}),
  }
}

/** Replaces auth/event/description; `auth: undefined` means inherit (folders) or none (collections). */
export async function saveContainer(root: string, id: string, data: Pick<PmContainer, 'auth' | 'event' | 'description'>): Promise<void> {
  const abs = resolveInside(root, id)
  if (abs.endsWith(REQ_EXT)) throw new WorkspaceError(`Not a collection or folder: ${id}`)
  const file = metaPath(root, abs)
  const meta = await readMeta(file)
  const { auth: _a, event: _e, description: _d, ...rest } = meta
  const next: DirMeta = { ...rest, ...(data.auth ? { auth: data.auth } : {}), ...(data.event?.length ? { event: data.event } : {}) }
  if (isCollectionDir(root, abs)) {
    const { description: _old, ...info } = meta.info ?? {}
    next.info = { ...info, ...(data.description ? { description: data.description } : {}) }
  } else if (data.description) next.description = data.description
  await writeFileAtomic(file, stableStringify(next))
}

/** Collection first, then each folder down to the request's parent; plus the collection's id. */
export async function loadChain(root: string, requestId: string): Promise<{ collectionId: string; parents: PmContainer[] }> {
  const abs = requestPath(root, requestId)
  const dirs: string[] = []
  for (let d = dirname(abs); d !== collectionsDir(root); d = dirname(d)) dirs.unshift(d)
  const parents = await Promise.all(dirs.map((d) => readContainer(root, toId(root, d))))
  return { collectionId: toId(root, dirs[0]), parents }
}

/** Collection id (collections/<dir>) of any node id. */
export function collectionOf(id: string): string {
  return id.split('/').slice(0, 2).join('/')
}
