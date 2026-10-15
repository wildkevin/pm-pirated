// Collection Runner support in main: building the run collection, data files, saved runs.
import { parse as parseCsv } from 'csv-parse/sync'
import { mkdir, readdir, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import type { DataPreview, RunInfo, RunRecord } from '../shared/ipc'
import { writeFileAtomic } from './workspace/fsAtomic'
import { WorkspaceError } from './workspace/store'
import { exportCollection } from './workspace/transfer'

type Json = Record<string, any>

/** Keeps only the selected requests (and the folders leading to them). */
export function prune(items: Json[], selected: Set<string>): Json[] {
  const out: Json[] = []
  for (const it of items) {
    if (Array.isArray(it.item)) {
      const children = prune(it.item, selected)
      if (children.length) out.push({ ...it, item: children })
    } else if (selected.has(it.id)) out.push(it)
  }
  return out
}

/** The collection containing `target` (collection or folder), pruned to `requestIds`. */
export async function buildRunCollection(root: string, target: string, requestIds: string[]): Promise<Json> {
  const collectionId = target.split('/').slice(0, 2).join('/')
  const doc = await exportCollection(root, collectionId, true)
  const selected = new Set(requestIds.filter((id) => id === target || id.startsWith(`${target}/`)))
  const item = prune(doc.item, selected)
  if (!item.length) throw new WorkspaceError('Select at least one request to run')
  return { ...doc, item }
}

/** CSV (first row = variable names) or a JSON array of objects, like Postman's data files. */
export async function readDataFile(path: string): Promise<Record<string, unknown>[]> {
  const text = (await readFile(path, 'utf8')).replace(/^\uFEFF/, '')
  if (/\.json$/i.test(path) || /^\s*[[{]/.test(text)) {
    let data: unknown
    try {
      data = JSON.parse(text)
    } catch (e) {
      throw new WorkspaceError(`The data file is not valid JSON: ${(e as Error).message}`)
    }
    if (!Array.isArray(data) || !data.every((r) => r && typeof r === 'object' && !Array.isArray(r)))
      throw new WorkspaceError('A JSON data file must be an array of objects, one per iteration')
    return data as Record<string, unknown>[]
  }
  try {
    return parseCsv(text, { columns: true, skip_empty_lines: true, bom: true, relax_column_count: true }) as Record<string, unknown>[]
  } catch (e) {
    throw new WorkspaceError(`The data file is not valid CSV: ${(e as Error).message}`)
  }
}

export async function previewData(path: string): Promise<DataPreview> {
  const rows = await readDataFile(path)
  const columns = [...new Set(rows.flatMap((r) => Object.keys(r)))]
  return { rows: rows.slice(0, 100), count: rows.length, columns }
}

// --- saved runs: .pmlocal/runs/<id>.json ---

const runsDir = (root: string) => join(root, '.pmlocal', 'runs')

function runPath(root: string, id: string): string {
  if (!/^[\w.-]+$/.test(id)) throw new WorkspaceError(`Invalid run id: ${id}`)
  return join(runsDir(root), `${id}.json`)
}

export async function saveRun(root: string, record: RunRecord): Promise<void> {
  await mkdir(runsDir(root), { recursive: true })
  await writeFileAtomic(runPath(root, record.id), JSON.stringify(record))
}

export async function listRuns(root: string): Promise<RunInfo[]> {
  const files = await readdir(runsDir(root)).catch(() => [] as string[])
  const infos = await Promise.all(
    files
      .filter((f) => f.endsWith('.json'))
      .map(async (f): Promise<RunInfo | null> => {
        try {
          const r = JSON.parse(await readFile(join(runsDir(root), f), 'utf8')) as RunRecord
          return { id: r.id, name: r.name, startedAt: r.startedAt, summary: r.summary }
        } catch {
          return null
        }
      }),
  )
  return infos.filter((i): i is RunInfo => !!i).sort((a, b) => b.startedAt - a.startedAt)
}

export async function readRun(root: string, id: string): Promise<RunRecord> {
  return JSON.parse(await readFile(runPath(root, id), 'utf8'))
}

export async function deleteRun(root: string, id: string): Promise<void> {
  await rm(runPath(root, id), { force: true })
}
