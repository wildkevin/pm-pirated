// Import (Postman v2.0/v2.1 collections, environments, globals, cURL) and export (v2.1).
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { Url } from 'postman-collection'
import curlToPostman from 'curl-to-postmanv2'
import { COLLECTION_SCHEMA, type PmContainer, type PmEvent, type PmItem, type PmKeyValue, type PmRequest, type PmUrl, type PmVariable } from '../../shared/format/types'
import type { ImportResult } from '../../shared/ipc'
import { WorkspaceError, createCollection, createFolder, createRequest, readContainer, readRequest, resolveInside } from './store'
import { Variables, createEnvironment, resolveEnvPath, type VariableRow } from './variables'

type Json = Record<string, any>

// --- normalising imported items ---

function normalizeUrl(url: unknown): PmUrl {
  if (typeof url === 'string') return url
  if (!url || typeof url !== 'object') return ''
  const u = url as Json
  let raw: string = typeof u.raw === 'string' ? u.raw : ''
  if (!raw) {
    try {
      raw = new Url(u).toString()
    } catch {
      raw = ''
    }
  }
  const query: PmKeyValue[] | undefined = Array.isArray(u.query)
    ? u.query.map((q: Json) => ({ key: String(q.key ?? ''), value: q.value == null ? '' : String(q.value), ...(q.disabled ? { disabled: true } : {}) }))
    : undefined
  const variable: PmKeyValue[] | undefined = Array.isArray(u.variable)
    ? u.variable.map((v: Json) => ({
        key: String(v.key ?? ''),
        value: v.value == null ? '' : String(v.value),
        ...(v.description ? { description: typeof v.description === 'string' ? v.description : (v.description.content ?? '') } : {}),
      }))
    : undefined
  const keepQuery = query?.some((q) => q.disabled)
  if (!keepQuery && !variable?.length) return raw
  return { raw, ...(keepQuery ? { query } : {}), ...(variable?.length ? { variable } : {}) }
}

function normalizeHeaders(header: unknown): PmKeyValue[] {
  if (typeof header === 'string')
    return header
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => {
        const i = l.indexOf(':')
        return i === -1 ? { key: l, value: '' } : { key: l.slice(0, i).trim(), value: l.slice(i + 1).trim() }
      })
  if (!Array.isArray(header)) return []
  return header.map((h: Json) => ({ key: String(h.key ?? ''), value: h.value == null ? '' : String(h.value), ...(h.disabled ? { disabled: true } : {}) }))
}

function normalizeRequest(request: unknown): PmRequest {
  if (typeof request === 'string') return { method: 'GET', url: request, header: [] }
  const r = (request ?? {}) as Json
  const out: PmRequest = { ...r, method: String(r.method ?? 'GET').toUpperCase(), url: normalizeUrl(r.url), header: normalizeHeaders(r.header) }
  if (r.body && typeof r.body === 'object' && r.body.mode) out.body = r.body
  else delete out.body
  if (r.description && typeof r.description === 'object') out.description = r.description.content ?? ''
  return out
}

/** Scripts as line arrays (v2.0 exports may use one string); events without a script are dropped. */
function normalizeEvents(events: unknown): PmEvent[] | undefined {
  if (!Array.isArray(events)) return undefined
  const out = events
    .filter((e: Json) => e && (e.listen === 'prerequest' || e.listen === 'test') && e.script)
    .map((e: Json): PmEvent => {
      const exec = e.script.exec
      const lines = Array.isArray(exec) ? exec.map(String) : typeof exec === 'string' ? exec.split('\n') : []
      return { ...e, listen: e.listen, script: { ...e.script, exec: lines } }
    })
  return out.length ? out : undefined
}

export function normalizeItem(item: Json): PmItem {
  const { item: _children, request, event, ...rest } = item
  const events = normalizeEvents(event)
  return {
    ...rest,
    name: String(item.name ?? 'Untitled'),
    request: normalizeRequest(request),
    response: Array.isArray(item.response) ? item.response : [],
    ...(events ? { event: events } : {}),
  }
}

function containerOf(node: Json): Partial<PmContainer> {
  const events = normalizeEvents(node.event)
  return {
    ...(node.auth ? { auth: node.auth } : {}),
    ...(events ? { event: events } : {}),
    ...(node.description ? { description: typeof node.description === 'string' ? node.description : (node.description.content ?? '') } : {}),
  }
}

// --- detection ---

export type Detected =
  | { kind: 'collection'; doc: Json }
  | { kind: 'environment'; doc: Json }
  | { kind: 'globals'; doc: Json }
  | { kind: 'curl'; text: string }

export function detect(text: string): Detected {
  const trimmed = text.trim()
  if (/^curl(\.exe)?\s/i.test(trimmed)) return { kind: 'curl', text: trimmed }
  let doc: Json
  try {
    doc = JSON.parse(trimmed.replace(/^\uFEFF/, ''))
  } catch {
    throw new WorkspaceError('Unrecognised format: paste a cURL command or a Postman collection/environment JSON')
  }
  const scope = doc._postman_variable_scope
  if (doc.info && Array.isArray(doc.item)) {
    if (typeof doc.info.schema === 'string' && /collection\/v1/.test(doc.info.schema))
      throw new WorkspaceError('Postman v1 collections are not supported; export as v2.1 from Postman')
    return { kind: 'collection', doc }
  }
  if (scope === 'globals') return { kind: 'globals', doc }
  if (scope === 'environment' || (typeof doc.name === 'string' && Array.isArray(doc.values))) return { kind: 'environment', doc }
  if (Array.isArray(doc.order) || Array.isArray(doc.requests)) throw new WorkspaceError('Postman v1 collections are not supported; export as v2.1 from Postman')
  throw new WorkspaceError('Unrecognised JSON: expected a Postman v2.x collection, environment or globals export')
}

// --- import ---

async function importTree(root: string, parentId: string, items: Json[]): Promise<number> {
  let count = 0
  for (const it of items) {
    if (Array.isArray(it.item)) {
      const folder = await createFolder(root, parentId, String(it.name ?? 'Folder'), containerOf(it))
      count += await importTree(root, folder, it.item)
    } else {
      const item = normalizeItem(it)
      await createRequest(root, parentId, item.name, item)
      count++
    }
  }
  return count
}

const toRows = (vars: Json[], flag: 'enabled' | 'disabled'): VariableRow[] =>
  vars
    .filter((v) => v && typeof v.key === 'string' && v.key)
    .map((v) => {
      const value = v.value == null ? '' : typeof v.value === 'string' ? v.value : JSON.stringify(v.value)
      return {
        key: v.key,
        type: v.type === 'secret' ? ('secret' as const) : ('default' as const),
        initial: value,
        current: value,
        enabled: flag === 'enabled' ? v.enabled !== false : !v.disabled,
      }
    })

export async function importDetected(root: string, d: Detected, vars: Variables): Promise<ImportResult> {
  switch (d.kind) {
    case 'collection': {
      const doc = d.doc
      const id = await createCollection(root, String(doc.info.name ?? 'Imported collection'), containerOf({ ...doc, description: doc.info.description }))
      const count = await importTree(root, id, doc.item)
      if (Array.isArray(doc.variable) && doc.variable.length) await vars.write(`col:${id}`, toRows(doc.variable, 'disabled'))
      return { kind: 'collection', id, name: String(doc.info.name), detail: `${count} requests` }
    }
    case 'environment': {
      const name = String(d.doc.name ?? 'Imported environment')
      const id = await createEnvironment(root, name)
      await vars.write(`env:${id}`, toRows(d.doc.values ?? [], 'enabled'))
      return { kind: 'environment', id, name }
    }
    case 'globals': {
      const existing = await vars.read('globals')
      const incoming = toRows(d.doc.values ?? [], 'enabled')
      const merged = [...existing.filter((r) => !incoming.some((i) => i.key === r.key)), ...incoming]
      await vars.write('globals', merged)
      return { kind: 'globals', id: 'globals', name: 'Globals', detail: `${incoming.length} variables` }
    }
    case 'curl':
      return { kind: 'request', id: '', name: 'Imported request', item: await curlToItem(d.text) }
  }
}

export async function curlToItem(text: string): Promise<PmItem> {
  const convert = promisify((input: unknown, cb: (e: Error | null, r: any) => void) => curlToPostman.convert(input, cb))
  const res = await convert({ type: 'string', data: text })
  const data = res?.result ? res.output?.[0]?.data : undefined
  if (!data) throw new WorkspaceError(`Could not parse cURL command: ${res?.reason ?? 'unknown error'}`)
  const body = data.body?.mode ? data.body : undefined
  if (body?.mode === 'formdata')
    body.formdata = body.formdata.map((p: Json) => (p.type === 'file' ? { key: p.key, type: 'file', src: p.value, value: '' } : p))
  const { description: _d, name: _n, ...request } = data
  return { name: String(data.url ?? 'Imported request'), request: { ...normalizeRequest({ ...request, body }) }, response: [] }
}

// --- export ---

/**
 * Stored URLs with disabled params or path variables are `{raw, query, variable}`; v2.1 consumers (the
 * runtime, Postman) read the parsed parts, so add them (host, path, …) from `raw`.
 */
function exportUrl(url: PmUrl): PmUrl {
  if (typeof url === 'string') return url
  return { ...Url.parse(url.raw), ...url }
}

async function exportTree(root: string, dirId: string, withIds: boolean): Promise<Json[]> {
  const abs = resolveInside(root, dirId)
  const isCollection = dirId.split('/').length === 2
  const meta = JSON.parse((await readFile(join(abs, isCollection ? 'collection.json' : 'folder.json'), 'utf8').catch(() => '{}')).replace(/^\uFEFF/, ''))
  const order: string[] = meta.order ?? []
  const entries = (await readdir(abs, { withFileTypes: true })).filter(
    (e) => e.isDirectory() || (e.isFile() && e.name.endsWith('.request.json')),
  )
  const rank = (n: string) => (order.includes(n) ? order.indexOf(n) : order.length)
  entries.sort((a, b) => rank(a.name) - rank(b.name) || a.name.localeCompare(b.name))
  const out: Json[] = []
  for (const e of entries) {
    const id = `${dirId}/${e.name}`
    if (e.isDirectory()) {
      const c = await readContainer(root, id)
      out.push({ ...(withIds ? { id } : {}), name: c.name, ...containerOf(c), item: await exportTree(root, id, withIds) })
    } else {
      const item = await readRequest(root, id)
      out.push({ ...item, request: { ...item.request, url: exportUrl(item.request.url) }, ...(withIds ? { id } : {}) })
    }
  }
  return out
}

/**
 * A Postman v2.1 collection. Secret variables are exported with empty values. `withIds` sets each
 * item's `id` to its workspace node id (for the Collection Runner, never for files you share).
 */
export async function exportCollection(root: string, id: string, withIds = false): Promise<Json> {
  const abs = resolveInside(root, id)
  const meta = JSON.parse(await readFile(join(abs, 'collection.json'), 'utf8'))
  const c = await readContainer(root, id)
  return {
    info: { _postman_id: meta.info?._postman_id, name: c.name, schema: COLLECTION_SCHEMA, ...(c.description ? { description: c.description } : {}) },
    item: await exportTree(root, id, withIds),
    ...(c.auth ? { auth: c.auth } : {}),
    ...(c.event ? { event: c.event } : {}),
    ...(meta.variable?.length ? { variable: meta.variable.map((v: PmVariable) => (v.type === 'secret' ? { ...v, value: '' } : v)) } : {}),
  }
}

export async function exportEnvironment(root: string, id: string): Promise<Json> {
  const doc = JSON.parse(await readFile(resolveEnvPath(root, id), 'utf8'))
  return { ...doc, _postman_variable_scope: 'environment' }
}
