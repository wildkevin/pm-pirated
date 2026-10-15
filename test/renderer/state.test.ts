import { describe, expect, it } from 'vitest'
import { stableStringify } from '../../src/shared/format/stableJson'
import type { PmItem } from '../../src/shared/format/types'
import { activeTab, initialState, isDirty, newDraft, reducer, toUiState, type State, type TabDoc } from '../../src/renderer/state'

const item = (name: string): PmItem => ({ name, request: { method: 'GET', url: '', header: [] } })
const req = (name: string): TabDoc => ({ kind: 'request', item: item(name) })
const ws = (root: string) => ({ root, name: root, collections: [], environments: [] })
const withTabs = (...ids: string[]): State =>
  ids.reduce((s, id) => reducer(s, { type: 'open', id, doc: req(id) }), reducer(initialState, { type: 'workspace', workspace: ws('/w') }))
const keyOf = (s: State, id: string) => s.tabs.find((t) => t.id === id)!.key
const activeId = (s: State) => activeTab(s)?.id ?? null
const itemOf = (s: State, i = 0) => (s.tabs[i].doc as Extract<TabDoc, { kind: 'request' }>).item

describe('tabs', () => {
  it('does not open the same node twice in the same kind of tab', () => {
    let s = reducer(withTabs('a', 'b'), { type: 'open', id: 'a', doc: req('a') })
    expect(s.tabs.map((t) => t.id)).toEqual(['a', 'b'])
    expect(activeId(s)).toBe('a')
    s = reducer(s, { type: 'open', id: 'a', doc: { kind: 'container', container: { name: 'a' }, variables: null } })
    expect(s.tabs).toHaveLength(3)
  })

  it('activates the neighbour when closing the active tab', () => {
    let s = withTabs('a', 'b', 'c')
    s = reducer(s, { type: 'activate', key: keyOf(s, 'b') })
    s = reducer(s, { type: 'close', key: keyOf(s, 'b') })
    expect(activeId(s)).toBe('c')
    s = reducer(s, { type: 'close', key: keyOf(s, 'c') })
    s = reducer(s, { type: 'close', key: keyOf(s, 'a') })
    expect(s.activeKey).toBeNull()
  })

  it('tracks dirty state across edits and saves', () => {
    let s = withTabs('a')
    const key = keyOf(s, 'a')
    s = reducer(s, { type: 'edit', key, patch: { url: 'http://x' } })
    expect(isDirty(s.tabs[0])).toBe(true)
    s = reducer(s, { type: 'saved', key, doc: s.tabs[0].doc })
    expect(isDirty(s.tabs[0])).toBe(false)
    s = reducer(s, { type: 'editItem', key, patch: { event: [{ listen: 'test', script: { exec: ['x'] } }] } })
    expect(isDirty(s.tabs[0])).toBe(true)
  })

  it('drafts start clean and get an id when saved into a collection', () => {
    let s = reducer(withTabs(), { type: 'openDraft', item: newDraft() })
    const key = s.tabs[0].key
    expect(s.tabs[0].id).toBeNull()
    expect(isDirty(s.tabs[0])).toBe(false)
    s = reducer(s, { type: 'edit', key, patch: { url: 'http://x' } })
    const savedDoc = { kind: 'request' as const, item: { ...itemOf(s), name: 'Saved' } }
    s = reducer(s, { type: 'saved', key, doc: savedDoc, id: 'collections/C/Saved.request.json' })
    expect(s.tabs[0]).toMatchObject({ id: 'collections/C/Saved.request.json', key })
    expect(itemOf(s).name).toBe('Saved')
    expect(isDirty(s.tabs[0])).toBe(false)
  })
})

describe('renames and deletes', () => {
  it('renaming updates the id and name, keeps the key, and does not make the tab dirty', () => {
    const before = withTabs('c/a')
    const s = reducer(before, { type: 'renamed', id: 'c/a', newId: 'c/b', name: 'New' })
    expect(s.tabs[0]).toMatchObject({ id: 'c/b', key: before.tabs[0].key })
    expect(itemOf(s).name).toBe('New')
    expect(isDirty(s.tabs[0])).toBe(false)
  })

  it('keeps edits and send results that arrive with the pre-rename key', () => {
    let s = withTabs('c/a')
    const key = keyOf(s, 'c/a')
    s = reducer(s, { type: 'sendStart', key, sendId: '1' })
    s = reducer(s, { type: 'renamed', id: 'c/a', newId: 'c/b', name: 'B' })
    s = reducer(s, { type: 'edit', key, patch: { method: 'POST' } })
    s = reducer(s, { type: 'sendDone', key, sendId: '1', report: { response: { ok: false, error: 'x' }, tests: [], logs: [], scriptErrors: [], cookies: [] } })
    expect(s.tabs[0]).toMatchObject({ id: 'c/b', report: { response: { error: 'x' } } })
    expect(itemOf(s)).toMatchObject({ name: 'B', request: { method: 'POST' } })
  })

  it('renaming a collection updates its request, settings and variables tabs', () => {
    let s = withTabs('collections/C/a.request.json')
    s = reducer(s, { type: 'open', id: 'collections/C', doc: { kind: 'container', container: { name: 'C' }, variables: [] } })
    s = reducer(s, { type: 'renamed', id: 'collections/C', newId: 'collections/D', name: 'D' })
    expect(s.tabs.map((t) => t.id)).toEqual(['collections/D/a.request.json', 'collections/D'])
    expect(s.tabs[1].doc).toMatchObject({ container: { name: 'D' } })
    expect(isDirty(s.tabs[1])).toBe(false)
  })

  it('closes tabs under a deleted folder only', () => {
    const s = reducer(withTabs('collections/C/F/a', 'collections/C/F2/b', 'collections/C/F/x/c'), { type: 'removed', id: 'collections/C/F' })
    expect(s.tabs.map((t) => t.id)).toEqual(['collections/C/F2/b'])
    expect(activeId(s)).toBe('collections/C/F2/b')
  })
})

describe('stale renders', () => {
  it('editing variables during an environment rename keeps the new title', () => {
    let s = reducer(withTabs(), { type: 'open', id: 'env:environments/A.env.json', doc: { kind: 'variables', title: 'A', rows: [] } })
    const key = s.tabs[0].key
    s = reducer(s, { type: 'renamed', id: 'env:environments/A.env.json', newId: 'env:environments/Dev.env.json', name: 'Dev' })
    s = reducer(s, { type: 'setRows', key, rows: [{ key: 'x', type: 'default', initial: '1', current: '1', enabled: true }] })
    expect(s.tabs[0].doc).toMatchObject({ title: 'Dev', rows: [{ key: 'x' }] })
    expect(s.tabs[0].id).toBe('env:environments/Dev.env.json')
  })

  it('editing collection settings during a rename keeps the new name', () => {
    let s = reducer(withTabs(), { type: 'open', id: 'collections/C', doc: { kind: 'container', container: { name: 'C' }, variables: [] } })
    const key = s.tabs[0].key
    s = reducer(s, { type: 'renamed', id: 'collections/C', newId: 'collections/D', name: 'D' })
    s = reducer(s, { type: 'patchContainer', key, patch: { description: 'docs' } })
    s = reducer(s, { type: 'setContainerVariables', key, variables: [] })
    expect(s.tabs[0].doc).toMatchObject({ container: { name: 'D', description: 'docs' } })
  })
})

describe('sending', () => {
  it('ignores results from a superseded send', () => {
    let s = withTabs('a')
    const key = keyOf(s, 'a')
    const report = (error: string) => ({ response: { ok: false as const, error }, tests: [], logs: [], scriptErrors: [], cookies: [] })
    s = reducer(s, { type: 'sendStart', key, sendId: '1' })
    s = reducer(s, { type: 'sendStart', key, sendId: '2' })
    s = reducer(s, { type: 'sendDone', key, sendId: '1', report: report('old') })
    expect(s.tabs[0].report).toBeUndefined()
    s = reducer(s, { type: 'sendDone', key, sendId: '2', report: report('new') })
    expect(s.tabs[0]).toMatchObject({ sendId: undefined, report: { response: { error: 'new' } } })
  })
})

describe('persistence', () => {
  it('round-trips request tabs (with unsaved edits) and the environment; skips other tabs', () => {
    let s = withTabs('a', 'b')
    s = reducer(s, { type: 'edit', key: keyOf(s, 'b'), patch: { url: 'edited' } })
    s = reducer(s, { type: 'openDraft', item: newDraft() })
    s = reducer(s, { type: 'open', id: 'env:environments/D.env.json', doc: { kind: 'variables', title: 'D', rows: [] } })
    s = reducer(s, { type: 'environment', id: 'environments/D.env.json' })
    s = reducer(s, { type: 'activate', key: keyOf(s, 'b') })
    const ui = toUiState(s)
    expect(ui.tabs.map((t) => t.id)).toEqual(['a', 'b', null])
    expect(ui.activeIndex).toBe(1)

    const restored = reducer(reducer(initialState, { type: 'workspace', workspace: ws('/w') }), { type: 'restore', ui })
    expect(restored.activeEnvironment).toBe('environments/D.env.json')
    expect(activeId(restored)).toBe('b')
    expect(isDirty(restored.tabs[1])).toBe(true)
    expect(isDirty(restored.tabs[0])).toBe(false)
    expect(restored.tabs[1].saved).toBe(stableStringify(req('b')))
  })

  it('clears tabs when switching workspace, keeps them on refresh', () => {
    expect(reducer(withTabs('a'), { type: 'workspace', workspace: ws('/w') }).tabs).toHaveLength(1)
    expect(reducer(withTabs('a'), { type: 'workspace', workspace: ws('/other') }).tabs).toHaveLength(0)
  })
})
