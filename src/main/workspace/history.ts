// Request history in .pmlocal/history.ndjson: one JSON entry per line, newest last on disk.
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { HistoryEntry } from '../../shared/ipc'
import { writeFileAtomic } from './fsAtomic'

export const MAX_HISTORY = 1000
const file = (root: string) => join(root, '.pmlocal', 'history.ndjson')

async function readAll(root: string): Promise<HistoryEntry[]> {
  let text: string
  try {
    text = await readFile(file(root), 'utf8')
  } catch {
    return []
  }
  const out: HistoryEntry[] = []
  for (const line of text.split('\n')) {
    if (!line.trim()) continue
    try {
      out.push(JSON.parse(line))
    } catch {
      // a line cut short by a crash: skip it
    }
  }
  return out
}

export async function appendHistory(root: string, entry: HistoryEntry): Promise<void> {
  await mkdir(join(root, '.pmlocal'), { recursive: true })
  await appendFile(file(root), JSON.stringify(entry) + '\n')
  // ponytail: re-reads the file on each append (≤1100 lines); track a line count if sends get slow.
  const all = await readAll(root)
  if (all.length > MAX_HISTORY + 100) await writeAll(root, all.slice(-MAX_HISTORY))
}

async function writeAll(root: string, entries: HistoryEntry[]): Promise<void> {
  await writeFileAtomic(file(root), entries.map((e) => JSON.stringify(e) + '\n').join(''))
}

/** Newest first, capped. */
export async function listHistory(root: string): Promise<HistoryEntry[]> {
  return (await readAll(root)).slice(-MAX_HISTORY).reverse()
}

export async function deleteHistory(root: string, id?: string): Promise<void> {
  if (id === undefined) return void (await writeFile(file(root), '').catch(() => undefined))
  await writeAll(
    root,
    (await readAll(root)).filter((e) => e.id !== id),
  )
}
