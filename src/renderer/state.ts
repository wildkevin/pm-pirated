import type { MockDefinition } from '../shared/mock'
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
  | { kind: 'mock'; title: string; draft?: MockDefinition }
  /** Capture proxy (single tab, id 'capture'). */
  | { kind: 'capture' }
  /** Performance (load) test (single tab, id 'load'). */
  | { kind: 'load'; target: string }

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
  /** This session's responses for the tab, newest first (Response › History). Not persisted. */
  past?: { ts: number; report: RunReport }[]
  /** Opened by a single click in the sidebar (italic title): the next single click replaces it. Editing or double-clicking pins it. */
  preview?: boolean
}

export interface State {
  workspace: WorkspaceInfo | null
  tabs: Tab[]
  activeKey: string | null
  activeEnvironment: string | null
  error: string | null
  nextKey: number
  /** Favorited collection ids. */
  favorites: string[]
}

export const initialState: State = {
  workspace: null,
  tabs: [],
  activeKey: null,
  activeEnvironment: null,
  error: null,
  nextKey: 1,
  favorites: [],
}

export type Action =
  | { type: 'workspace'; workspace: WorkspaceInfo | null }
  | { type: 'restore'; ui: UiState }
  | { type: 'environment'; id: string | null }
  // Node-level actions (addressed by id)
  | { type: 'open'; id: string; doc: TabDoc; preview?: boolean }
  | { type: 'openDraft'; item: PmItem }
  | { type: 'renamed'; id: string; newId: string; name: string }
  | { type: 'removed'; id: string }
  // Tab-level actions (addressed by tab key)
  | { type: 'activate'; key: string }
  | { type: 'pin'; key: string }
  | { type: 'toggleFavorite'; id: string }
  | { type: 'close'; key: string }
  | { type: 'closeMany'; keys: string[] }
  /** A patch, not a full item: a stale render must not overwrite fields changed meanwhile (e.g. the name). */
  | { type: 'edit'; key: string; patch: Partial<PmRequest> }
  | { type: 'editItem'; key: string; patch: Partial<Omit<PmItem, 'request' | 'name'>> }
  // Patches for collection/folder and variables tabs (never whole docs from a possibly stale render).
  | { type: 'patchContainer'; key: string; patch: Partial<PmContainer> }
  | { type: 'setContainerVariables'; key: string; variables: VariableRow[] }
  | { type: 'setMockDraft'; key: string; draft: MockDefinition }
  | { type: 'setRows'; key: string; rows: VariableRow[] }
  /** Replace a doc with freshly loaded data (not for user edits). */
  | { type: 'setDoc'; key: string; doc: TabDoc }
  /** Opens the Runner tab (or retargets it). */
  | { type: 'openRunner'; target: string }
  | { type: 'openLoad'; target: string }
  /** After saving; `id` is set when a draft was saved into a collection. */
  | { type: 'saved'; key: string; doc: TabDoc; id?: string }
  | { type: 'sendStart'; key: string; sendId: string }
  | { type: 'sendDone'; key: string; sendId: string; report: RunReport; ts?: number }
  /** Show an earlier response from the tab's history. */
  | { type: 'showReport'; key: string; index: number }
  | { type: 'clearReport'; key: string }
  | { type: 'error'; error: string | null }

export const isDirty = (t: Tab) => stableStringify(t.doc) !== t.saved
export const activeTab = (s: State) => s.tabs.find((t) => t.key === s.activeKey)
export const tabTitle = (t: Tab) =>
  t.doc.kind === 'request' ? t.doc.item.name : t.doc.kind === 'container' ? t.doc.container.name : t.doc.kind === 'variables' || t.doc.kind === 'mock' ? t.doc.title : t.doc.kind === 'capture' ? 'Capture' : t.doc.kind === 'load' ? 'Performance' : 'Runner'

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

function addTab(s: State, id: string | null, doc: TabDoc, saved = stableStringify(doc), preview = false): State {
  const key = `tab-${s.nextKey}`
  const tab: Tab = { key, id, doc, saved, ...(preview ? { preview } : {}) }
  // Postman: a new preview tab takes the place of the current one (unless that has unsaved edits or is sending).
  const old = preview ? s.tabs.findIndex((t) => t.preview && !isDirty(t) && !t.sendId) : -1
  const tabs = old === -1 ? [...s.tabs, tab] : s.tabs.map((t, i) => (i === old ? tab : t))
  return { ...s, tabs, activeKey: key, nextKey: s.nextKey + 1 }
}

/** User edits turn a preview tab into a normal one. */
const pinned = (t: Tab): Tab => (t.preview ? { ...t, preview: false } : t)

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
      return { ...next, activeKey: active?.key ?? null, favorites: a.ui.favorites ?? [] }
    }
    case 'environment':
      return { ...s, activeEnvironment: a.id }
    case 'open': {
      const existing = s.tabs.find((t) => t.id === a.id && t.doc.kind === a.doc.kind)
      if (!existing) return addTab(s, a.id, a.doc, undefined, a.preview)
      // Opening an already-open node normally (double-click) pins its preview tab.
      return { ...(a.preview ? s : mapTab(s, (t) => t.key === existing.key, pinned)), activeKey: existing.key }
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
      const renamed = mapTab(
        moved,
        (t) => under(t.id, a.id),
        (t) => ({ ...t, id: t.id!.startsWith('col:') ? `col:${a.newId}` : a.newId + t.id!.slice(a.id.length) }),
      )
      return { ...renamed, favorites: s.favorites.map((f) => (f === a.id ? a.newId : f)) }
    }
    case 'removed':
      return { ...closeTabs(s, (t) => under(t.id, a.id)), favorites: s.favorites.filter((f) => f !== a.id) }
    case 'pin':
      return mapTab(s, (t) => t.key === a.key, pinned)
    case 'toggleFavorite':
      return { ...s, favorites: s.favorites.includes(a.id) ? s.favorites.filter((f) => f !== a.id) : [...s.favorites, a.id] }
    case 'activate':
      return { ...s, activeKey: a.key }
    case 'close':
      return closeTabs(s, (t) => t.key === a.key)
    case 'closeMany':
      return closeTabs(s, (t) => a.keys.includes(t.key))
    case 'edit':
      return mapTab(
        s,
        (t) => t.key === a.key && t.doc.kind === 'request',
        (t) => {
          const doc = t.doc as Extract<TabDoc, { kind: 'request' }>
          return { ...pinned(t), doc: { ...doc, item: { ...doc.item, request: { ...doc.item.request, ...a.patch } } } }
        },
      )
    case 'editItem':
      return mapTab(
        s,
        (t) => t.key === a.key && t.doc.kind === 'request',
        (t) => {
          const doc = t.doc as Extract<TabDoc, { kind: 'request' }>
          return { ...pinned(t), doc: { ...doc, item: { ...doc.item, ...a.patch } } }
        },
      )
    case 'patchContainer':
      return mapTab(
        s,
        (t) => t.key === a.key && t.doc.kind === 'container',
        (t) => {
          const doc = t.doc as Extract<TabDoc, { kind: 'container' }>
          return { ...pinned(t), doc: { ...doc, container: { ...doc.container, ...a.patch } } }
        },
      )
    case 'setContainerVariables':
      return mapTab(s, (t) => t.key === a.key && t.doc.kind === 'container', (t) => ({ ...pinned(t), doc: { ...(t.doc as Extract<TabDoc, { kind: 'container' }>), variables: a.variables } }))
    case 'setMockDraft':
      return mapTab(s, (t) => t.key === a.key && t.doc.kind === 'mock', (t) => ({ ...t, doc: { ...(t.doc as Extract<TabDoc, { kind: 'mock' }>), draft: a.draft } }))
    case 'setRows':
      return mapTab(s, (t) => t.key === a.key && t.doc.kind === 'variables', (t) => ({ ...pinned(t), doc: { ...(t.doc as Extract<TabDoc, { kind: 'variables' }>), rows: a.rows } }))
    case 'setDoc':
      return mapTab(s, (t) => t.key === a.key, (t) => ({ ...t, doc: a.doc }))
    case 'openLoad': {
      const doc: TabDoc = { kind: 'load', target: a.target }
      const existing = s.tabs.find((t) => t.doc.kind === 'load')
      if (!existing) return addTab(s, 'load', doc)
      return { ...mapTab(s, (t) => t.key === existing.key, (t) => ({ ...t, doc, saved: stableStringify(doc) })), activeKey: existing.key }
    }
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
      return mapTab(s, (t) => t.key === a.key, (t) => ({ ...pinned(t), sendId: a.sendId }))
    case 'sendDone':
      // Ignore results of a send that was superseded or cancelled.
      return mapTab(
        s,
        (t) => t.key === a.key && t.sendId === a.sendId,
        (t) => ({ ...t, sendId: undefined, report: a.report, past: [{ ts: a.ts ?? Date.now(), report: a.report }, ...(t.past ?? [])].slice(0, 10) }),
      )
    case 'showReport':
      return mapTab(s, (t) => t.key === a.key && !!t.past?.[a.index], (t) => ({ ...t, report: t.past![a.index].report }))
    case 'clearReport':
      return mapTab(s, (t) => t.key === a.key, (t) => ({ ...t, report: undefined }))
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
    favorites: s.favorites,
  }
}

export function newDraft(): PmItem {
  return { name: 'Untitled Request', request: { method: 'GET', url: '', header: [] }, response: [] }
}
