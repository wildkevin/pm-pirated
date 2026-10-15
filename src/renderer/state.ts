import type { SendResult } from '../shared/engine'
import { stableStringify } from '../shared/format/stableJson'
import type { PmItem, PmRequest, WorkspaceInfo } from '../shared/format/types'

export interface Tab {
  /** Stable identity of the tab. Tab-level actions use it because `id` changes on rename. */
  key: string
  /** Workspace node id (file path) of the request; changes when it or a parent is renamed. */
  id: string
  item: PmItem
  /** Serialized item as last saved; the tab is dirty when the current item differs. */
  saved: string
  sendId?: string
  response?: SendResult
}

export interface State {
  workspace: WorkspaceInfo | null
  tabs: Tab[]
  activeKey: string | null
  error: string | null
  nextKey: number
}

export const initialState: State = { workspace: null, tabs: [], activeKey: null, error: null, nextKey: 1 }

export type Action =
  | { type: 'workspace'; workspace: WorkspaceInfo | null }
  // Node-level actions (addressed by node id)
  | { type: 'open'; id: string; item: PmItem }
  | { type: 'renamed'; id: string; newId: string; name: string }
  | { type: 'removed'; id: string }
  // Tab-level actions (addressed by tab key)
  | { type: 'activate'; key: string }
  | { type: 'close'; key: string }
  /** A patch, not a full item: a stale render must not overwrite fields changed meanwhile (e.g. the name). */
  | { type: 'edit'; key: string; patch: Partial<PmRequest> }
  | { type: 'saved'; key: string; item: PmItem }
  | { type: 'sendStart'; key: string; sendId: string }
  | { type: 'sendDone'; key: string; sendId: string; result: SendResult }
  | { type: 'error'; error: string | null }

export const isDirty = (t: Tab) => stableStringify(t.item) !== t.saved
export const activeTab = (s: State) => s.tabs.find((t) => t.key === s.activeKey)

const mapTab = (s: State, match: (t: Tab) => boolean, f: (t: Tab) => Tab): State => ({
  ...s,
  tabs: s.tabs.map((t) => (match(t) ? f(t) : t)),
})

function closeTabs(s: State, gone: (t: Tab) => boolean): State {
  const index = s.tabs.findIndex((t) => t.key === s.activeKey)
  const tabs = s.tabs.filter((t) => !gone(t))
  if (index === -1 || !gone(s.tabs[index])) return { ...s, tabs }
  // Activate the tab that slides into the closed tab's place, like Postman.
  const survivorsBefore = s.tabs.slice(0, index).filter((t) => !gone(t)).length
  return { ...s, tabs, activeKey: tabs[Math.min(survivorsBefore, tabs.length - 1)]?.key ?? null }
}

const under = (id: string, node: string) => id === node || id.startsWith(`${node}/`)

export function reducer(s: State, a: Action): State {
  switch (a.type) {
    case 'workspace':
      return a.workspace && a.workspace.root === s.workspace?.root
        ? { ...s, workspace: a.workspace }
        : { ...initialState, workspace: a.workspace, nextKey: s.nextKey }
    case 'open': {
      const existing = s.tabs.find((t) => t.id === a.id)
      if (existing) return { ...s, activeKey: existing.key }
      const key = `tab-${s.nextKey}`
      return {
        ...s,
        tabs: [...s.tabs, { key, id: a.id, item: a.item, saved: stableStringify(a.item) }],
        activeKey: key,
        nextKey: s.nextKey + 1,
      }
    }
    case 'renamed': {
      // The node's file/folder moved: update its tab and every tab below a renamed folder.
      const renamed = mapTab(
        s,
        (t) => t.id === a.id,
        (t) => ({
          ...t,
          item: { ...t.item, name: a.name },
          saved: stableStringify({ ...JSON.parse(t.saved), name: a.name }),
        }),
      )
      return mapTab(
        renamed,
        (t) => under(t.id, a.id),
        (t) => ({ ...t, id: a.newId + t.id.slice(a.id.length) }),
      )
    }
    case 'removed':
      return closeTabs(s, (t) => under(t.id, a.id))
    case 'activate':
      return { ...s, activeKey: a.key }
    case 'close':
      return closeTabs(s, (t) => t.key === a.key)
    case 'edit':
      return mapTab(s, (t) => t.key === a.key, (t) => ({ ...t, item: { ...t.item, request: { ...t.item.request, ...a.patch } } }))
    case 'saved':
      return mapTab(s, (t) => t.key === a.key, (t) => ({ ...t, saved: stableStringify(a.item) }))
    case 'sendStart':
      return mapTab(s, (t) => t.key === a.key, (t) => ({ ...t, sendId: a.sendId }))
    case 'sendDone':
      // Ignore results of a send that was superseded or cancelled.
      return mapTab(
        s,
        (t) => t.key === a.key && t.sendId === a.sendId,
        (t) => ({ ...t, sendId: undefined, response: a.result }),
      )
    case 'error':
      return { ...s, error: a.error }
  }
}
