import type { SendResult } from '../shared/engine'
import { stableStringify } from '../shared/format/stableJson'
import type { PmItem, WorkspaceInfo } from '../shared/format/types'

export interface Tab {
  id: string
  /** Stable React key; unlike `id` it survives renames. */
  key: string
  item: PmItem
  /** Serialized item as last saved; the tab is dirty when the current item differs. */
  saved: string
  sendId?: string
  response?: SendResult
}

export interface State {
  workspace: WorkspaceInfo | null
  tabs: Tab[]
  activeId: string | null
  error: string | null
  nextKey: number
}

export const initialState: State = { workspace: null, tabs: [], activeId: null, error: null, nextKey: 1 }

export type Action =
  | { type: 'workspace'; workspace: WorkspaceInfo | null }
  | { type: 'open'; id: string; item: PmItem }
  | { type: 'activate'; id: string }
  | { type: 'close'; id: string }
  | { type: 'edit'; id: string; item: PmItem }
  | { type: 'saved'; id: string; item: PmItem }
  | { type: 'renamed'; id: string; newId: string; name: string }
  | { type: 'removed'; id: string }
  | { type: 'sendStart'; id: string; sendId: string }
  | { type: 'sendDone'; id: string; sendId: string; result: SendResult }
  | { type: 'error'; error: string | null }

export const isDirty = (t: Tab) => stableStringify(t.item) !== t.saved

const mapTab = (s: State, id: string, f: (t: Tab) => Tab): State => ({
  ...s,
  tabs: s.tabs.map((t) => (t.id === id ? f(t) : t)),
})

function closeTabs(s: State, gone: (id: string) => boolean): State {
  const index = s.tabs.findIndex((t) => t.id === s.activeId)
  const tabs = s.tabs.filter((t) => !gone(t.id))
  if (s.activeId === null || !gone(s.activeId)) return { ...s, tabs }
  // Activate the tab that slides into the closed tab's place, like Postman.
  const survivorsBefore = s.tabs.slice(0, index).filter((t) => !gone(t.id)).length
  return { ...s, tabs, activeId: tabs[Math.min(survivorsBefore, tabs.length - 1)]?.id ?? null }
}

export function reducer(s: State, a: Action): State {
  switch (a.type) {
    case 'workspace':
      return a.workspace && a.workspace.root === s.workspace?.root
        ? { ...s, workspace: a.workspace }
        : { ...initialState, workspace: a.workspace, nextKey: s.nextKey }
    case 'open':
      if (s.tabs.some((t) => t.id === a.id)) return { ...s, activeId: a.id }
      return {
        ...s,
        tabs: [...s.tabs, { id: a.id, key: `tab-${s.nextKey}`, item: a.item, saved: stableStringify(a.item) }],
        activeId: a.id,
        nextKey: s.nextKey + 1,
      }
    case 'activate':
      return { ...s, activeId: a.id }
    case 'close':
      return closeTabs(s, (id) => id === a.id)
    case 'removed':
      return closeTabs(s, (id) => id === a.id || id.startsWith(`${a.id}/`))
    case 'edit':
      return mapTab(s, a.id, (t) => ({ ...t, item: a.item }))
    case 'saved':
      return mapTab(s, a.id, (t) => ({ ...t, saved: stableStringify(a.item) }))
    case 'renamed': {
      // The node's file/folder moved: re-key its tab and every tab below a renamed folder.
      const moved = (id: string) =>
        id === a.id ? a.newId : id.startsWith(`${a.id}/`) ? a.newId + id.slice(a.id.length) : id
      const renamed = mapTab(s, a.id, (t) => ({
        ...t,
        item: { ...t.item, name: a.name },
        saved: stableStringify({ ...JSON.parse(t.saved), name: a.name }),
      }))
      return {
        ...renamed,
        tabs: renamed.tabs.map((t) => ({ ...t, id: moved(t.id) })),
        activeId: renamed.activeId && moved(renamed.activeId),
      }
    }
    case 'sendStart':
      return mapTab(s, a.id, (t) => ({ ...t, sendId: a.sendId }))
    case 'sendDone':
      // Ignore results of a send that was superseded or cancelled.
      return mapTab(s, a.id, (t) => (t.sendId === a.sendId ? { ...t, sendId: undefined, response: a.result } : t))
    case 'error':
      return { ...s, error: a.error }
  }
}
