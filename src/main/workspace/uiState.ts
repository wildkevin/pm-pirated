// Per-workspace UI state in .pmlocal/state.json: open tabs (including unsaved edits) and the
// selected environment, so nothing typed is lost when the app closes.
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { UiState } from '../../shared/ipc'
import { writeFileAtomic } from './fsAtomic'

const file = (root: string) => join(root, '.pmlocal', 'state.json')

export const EMPTY_UI_STATE: UiState = { activeEnvironment: null, tabs: [], activeIndex: -1 }

export async function readUiState(root: string): Promise<UiState> {
  try {
    const s = JSON.parse(await readFile(file(root), 'utf8'))
    return {
      activeEnvironment: typeof s.activeEnvironment === 'string' ? s.activeEnvironment : null,
      tabs: Array.isArray(s.tabs) ? s.tabs.filter((t: unknown) => t && typeof t === 'object' && 'item' in (t as object)) : [],
      activeIndex: Number.isInteger(s.activeIndex) ? s.activeIndex : -1,
      favorites: Array.isArray(s.favorites) ? s.favorites.filter((f: unknown) => typeof f === 'string') : [],
    }
  } catch {
    return EMPTY_UI_STATE
  }
}

const pending = new Map<string, Promise<void>>()
export async function writeUiState(root: string, state: UiState): Promise<void> {
  const text = JSON.stringify(state)
  const next = (pending.get(root) ?? Promise.resolve()).catch(() => undefined).then(() => writeFileAtomic(file(root), text))
  pending.set(root, next)
  try { await next } finally { if (pending.get(root) === next) pending.delete(root) }
}
