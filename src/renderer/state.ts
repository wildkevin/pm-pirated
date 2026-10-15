import type { RunReport } from '../shared/engine'
import { stableStringify } from '../shared/format/stableJson'
import type { PmContainer, PmItem, PmRequest, WorkspaceInfo } from '../shared/format/types'
import type { UiState, VariableRow } from '../shared/ipc'

export type TabDoc =
  | { kind: 'request'; item: PmItem }
  /** Collection or folder settings; `variables` only for collections. */
  | { kind: 'container'; container: PmContainer; variables: VariableRow[] | null }
  /** Environment or globals editor. */
  | { kind: 'variables'; title: string; rows: VariableRow[] }
  /** Collection Runner (single tab, id 'runner'). */
  | { kind: 'runner'; target: string }
  /** Mock server (id = mocks/<file>.mock.json). */
  | { kind: 'mock'; title: string }

export interface Tab {
  /** Stable identity of the tab. Tab-level actions use it because `id` changes on rename. */
  key: string
  /** Request id / collection-or-folder id / variable scope; null for an unsaved draft request. */
  id: string | null
  doc: TabDoc
  /** Serialized doc as last saved (or as opened, for drafts). Dirty when the doc differs. */
  saved: string
  sendId?: string
  report?: RunReport
}

export interface State {
  workspace: WorkspaceInfo | null
  tabs: Tab[]
  activeKey: string | null
  activeEnvironment: string | null
  error: string | null
  nextKey: number
}

export const initialState: State = {
  workspace: null,
  tabs: [],
  activeKey: null,
  activeEnvironment: null,
  error: null,
  nextKey: 1,
}

export type Action =
  | { type: 'workspace'; workspace: WorkspaceInfo | null }
  | { type: 'restore'; ui: UiState }
  | { type: 'environment'; id: string | null }
  // Node-level actions (addressed by id)
  | { type: 'open'; id: string; doc: TabDoc }
  | { type: 'openDraft'; item: PmItem }
  | { type: 'renamed'; id: string; newId: string; name: string }
  | { type: 'removed'; id: string }
  // Tab-level actions (addressed by tab key)
  | { type: 'activate'; key: string }
  | { type: 'close'; key: string }
  /** A patch, not a full item: a stale render must not overwrite fields changed meanwhile (e.g. the name). */
  | { type: 'edit'; key: string; patch: Partial<PmRequest> }
  | { type: 'editItem'; key: string; patch: Partial<Omit<PmItem, 'request' | 'name'>> }
  // Patches for collection/folder and variables tabs (never whole docs from a possibly stale render).
  | { type: 'patchContainer'; key: string; patch: Partial<PmContainer> }
  | { type: 'setContainerVariables'; key: string; variables: VariableRow[] }
  | { type: 'setRows'; key: string; rows: VariableRow[] }
  /** Replace a doc with freshly loaded data (not for user edits). */
  | { type: 'setDoc'; key: string; doc: TabDoc }
  /** Opens the Runner tab (or retargets it). */
  | { type: 'openRunner'; target: string }
  /** After saving; `id` is set when a draft was saved into a collection. */
  | { type: 'saved'; key: string; doc: TabDoc; id?: string }
  | { type: 'sendStart'; key: string; sendId: string }
  | { type: 'sendDone'; key: string; sendId: string; report: RunReport }
  | { type: 'error'; error: string | null }

export const isDirty = (t: Tab) => stableStringify(t.doc) !== t.saved
export const activeTab = (s: State) => s.tabs.find((t) => t.key === s.activeKey)
export const tabTitle = (t: Tab) =>
  t.doc.kind === 'request' ? t.doc.item.name : t.doc.kind === 'container' ? t.doc.container.name : t.doc.kind === 'variables' || t.doc.kind === 'mock' ? t.doc.title : 'Runner'

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

/** True for a node id at or below `node` (paths), or the collection's variable scope. */
const under = (id: string | null, node: string) => id !== null && (id === node || id.startsWith(`${node}/`) || id === `col:${node}`)

function addTab(s: State, id: string | null, doc: TabDoc, saved = stableStringify(doc)): State {
  const key = `tab-${s.nextKey}`
  return { ...s, tabs: [...s.tabs, { key, id, doc, saved }], activeKey: key, nextKey: s.nextKey + 1 }
}

function rename(doc: TabDoc, name: string): TabDoc {
  if (doc.kind === 'request') return { ...doc, item: { ...doc.item, name } }
  if (doc.kind === 'container') return { ...doc, container: { ...doc.container, name } }
  if (doc.kind === 'variables') return { ...doc, title: name }
  return doc
}

export function reducer(s: State, a: Action): State {
  switch (a.type) {
    case 'workspace':
      return a.workspace && a.workspace.root === s.workspace?.root
        ? { ...s, workspace: a.workspace }
        : { ...initialState, workspace: a.workspace, nextKey: s.nextKey }
    case 'restore': {
      let next: State = { ...s, tabs: [], activeKey: null, activeEnvironment: a.ui.activeEnvironment }
      for (const t of a.ui.tabs) next = addTab(next, t.id, { kind: 'request', item: t.item }, t.saved ?? stableStringify({ kind: 'request', item: t.item }))
      const active = next.tabs[a.ui.activeIndex] ?? next.tabs.at(-1)
      return { ...next, activeKey: active?.key ?? null }
    }
    case 'environment':
      return { ...s, activeEnvironment: a.id }
    case 'open': {
      const existing = s.tabs.find((t) => t.id === a.id && t.doc.kind === a.doc.kind)
      return existing ? { ...s, activeKey: existing.key } : addTab(s, a.id, a.doc)
    }
    case 'openDraft':
      return addTab(s, null, { kind: 'request', item: a.item })
    case 'renamed': {
      // The node's file/folder (or environment file) moved: update its tab and everything below it.
      const moved = mapTab(
        s,
        (t) => t.id === a.id || (t.doc.kind === 'variables' && t.id === `col:${a.id}`),
        (t) => {
          const doc = rename(t.doc, a.name)
          return { ...t, doc, saved: stableStringify(rename(JSON.parse(t.saved), a.name)) }
        },
      )
      return mapTab(
        moved,
        (t) => under(t.id, a.id),
        (t) => ({ ...t, id: t.id!.startsWith('col:') ? `col:${a.newId}` : a.newId + t.id!.slice(a.id.length) }),
      )
    }
    case 'removed':
      return closeTabs(s, (t) => under(t.id, a.id))
    case 'activate':
      return { ...s, activeKey: a.key }
    case 'close':
      return closeTabs(s, (t) => t.key === a.key)
    case 'edit':
      return mapTab(
        s,
        (t) => t.key === a.key && t.doc.kind === 'request',
        (t) => {
          const doc = t.doc as Extract<TabDoc, { kind: 'request' }>
          return { ...t, doc: { ...doc, item: { ...doc.item, request: { ...doc.item.request, ...a.patch } } } }
        },
      )
    case 'editItem':
      return mapTab(
        s,
        (t) => t.key === a.key && t.doc.kind === 'request',
        (t) => {
          const doc = t.doc as Extract<TabDoc, { kind: 'request' }>
          return { ...t, doc: { ...doc, item: { ...doc.item, ...a.patch } } }
        },
      )
    case 'patchContainer':
      return mapTab(
        s,
        (t) => t.key === a.key && t.doc.kind === 'container',
        (t) => {
          const doc = t.doc as Extract<TabDoc, { kind: 'container' }>
          return { ...t, doc: { ...doc, container: { ...doc.container, ...a.patch } } }
        },
      )
    case 'setContainerVariables':
      return mapTab(s, (t) => t.key === a.key && t.doc.kind === 'container', (t) => ({ ...t, doc: { ...(t.doc as Extract<TabDoc, { kind: 'container' }>), variables: a.variables } }))
    case 'setRows':
      return mapTab(s, (t) => t.key === a.key && t.doc.kind === 'variables', (t) => ({ ...t, doc: { ...(t.doc as Extract<TabDoc, { kind: 'variables' }>), rows: a.rows } }))
    case 'setDoc':
      return mapTab(s, (t) => t.key === a.key, (t) => ({ ...t, doc: a.doc }))
    case 'openRunner': {
      const doc: TabDoc = { kind: 'runner', target: a.target }
      const existing = s.tabs.find((t) => t.doc.kind === 'runner')
      if (!existing) return addTab(s, 'runner', doc)
      return { ...mapTab(s, (t) => t.key === existing.key, (t) => ({ ...t, doc, saved: stableStringify(doc) })), activeKey: existing.key }
    }
    case 'saved':
      return mapTab(
        s,
        (t) => t.key === a.key,
        (t) => ({ ...t, saved: stableStringify(a.doc), ...(a.id !== undefined ? { id: a.id, doc: a.doc } : {}) }),
      )
    case 'sendStart':
      return mapTab(s, (t) => t.key === a.key, (t) => ({ ...t, sendId: a.sendId }))
    case 'sendDone':
      // Ignore results of a send that was superseded or cancelled.
      return mapTab(
        s,
        (t) => t.key === a.key && t.sendId === a.sendId,
        (t) => ({ ...t, sendId: undefined, report: a.report }),
      )
    case 'error':
      return { ...s, error: a.error }
  }
}

/** What survives an app restart: request tabs (with unsaved edits) and the selected environment. */
export function toUiState(s: State): UiState {
  const requestTabs = s.tabs.filter((t) => t.doc.kind === 'request')
  return {
    activeEnvironment: s.activeEnvironment,
    tabs: requestTabs.map((t) => ({ id: t.id, item: (t.doc as Extract<TabDoc, { kind: 'request' }>).item, saved: t.saved })),
    activeIndex: requestTabs.findIndex((t) => t.key === s.activeKey),
  }
}

export function newDraft(): PmItem {
  return { name: 'Untitled Request', request: { method: 'GET', url: '', header: [] }, response: [] }
}
