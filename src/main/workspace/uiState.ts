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
    }
  } catch {
    return EMPTY_UI_STATE
  }
}

export async function writeUiState(root: string, state: UiState): Promise<void> {
  await writeFileAtomic(file(root), JSON.stringify(state))
}
