import { describe, expect, it } from 'vitest'
import { MAX_RENDER_BYTES, cleanError, formatBytes, viewBody } from '../../src/renderer/lib/body'
import { activeTab, initialState, isDirty, reducer, type State } from '../../src/renderer/state'
import type { PmItem } from '../../src/shared/format/types'

const item = (name: string): PmItem => ({ name, request: { method: 'GET', url: '', header: [] } })
const ws = (root: string) => ({ root, name: root, collections: [] })
const withTabs = (...ids: string[]): State =>
  ids.reduce((s, id) => reducer(s, { type: 'open', id, item: item(id) }), reducer(initialState, { type: 'workspace', workspace: ws('/w') }))

describe('tab reducer', () => {
  const keyOf = (s: State, id: string) => s.tabs.find((t) => t.id === id)!.key
  const activeId = (s: State) => activeTab(s)?.id ?? null

  it('does not open the same request twice', () => {
    const s = reducer(withTabs('a', 'b'), { type: 'open', id: 'a', item: item('a') })
    expect(s.tabs.map((t) => t.id)).toEqual(['a', 'b'])
    expect(activeId(s)).toBe('a')
  })

  it('activates the neighbour when closing the active tab', () => {
    let s = withTabs('a', 'b', 'c')
    s = reducer(s, { type: 'activate', key: keyOf(s, 'b') })
    s = reducer(s, { type: 'close', key: keyOf(s, 'b') })
    expect(activeId(s)).toBe('c')
    s = reducer(s, { type: 'close', key: keyOf(s, 'c') })
    expect(activeId(s)).toBe('a')
    s = reducer(s, { type: 'close', key: keyOf(s, 'a') })
    expect(s.activeKey).toBeNull()
  })

  it('tracks dirty state across edits and saves', () => {
    let s = withTabs('a')
    const key = keyOf(s, 'a')
    expect(isDirty(s.tabs[0])).toBe(false)
    s = reducer(s, { type: 'edit', key, patch: { url: 'http://x' } })
    expect(isDirty(s.tabs[0])).toBe(true)
    s = reducer(s, { type: 'saved', key, item: s.tabs[0].item })
    expect(isDirty(s.tabs[0])).toBe(false)
  })

  it('renaming updates the tab id, keeps its key, and does not make it dirty', () => {
    const before = withTabs('c/a')
    const s = reducer(before, { type: 'renamed', id: 'c/a', newId: 'c/b', name: 'New' })
    expect(s.tabs[0]).toMatchObject({ id: 'c/b', key: before.tabs[0].key, item: { name: 'New' } })
    expect(activeId(s)).toBe('c/b')
    expect(isDirty(s.tabs[0])).toBe(false)
    // A new request created at the old path gets its own tab.
    const s2 = reducer(s, { type: 'open', id: 'c/a', item: item('c/a') })
    expect(new Set(s2.tabs.map((t) => t.key)).size).toBe(2)
  })

  it('keeps edits and send results that arrive with the pre-rename key (CI race)', () => {
    let s = withTabs('c/a')
    const key = keyOf(s, 'c/a')
    s = reducer(s, { type: 'sendStart', key, sendId: '1' })
    s = reducer(s, { type: 'renamed', id: 'c/a', newId: 'c/b', name: 'B' })
    s = reducer(s, { type: 'edit', key, patch: { method: 'POST' } })
    s = reducer(s, { type: 'sendDone', key, sendId: '1', result: { ok: false, error: 'x' } })
    expect(s.tabs[0]).toMatchObject({ id: 'c/b', item: { name: 'B', request: { method: 'POST' } }, response: { error: 'x' } })
  })

  it('renaming a folder updates the ids of tabs inside it only', () => {
    const s = reducer(withTabs('c/F/a', 'c/F2/b'), { type: 'renamed', id: 'c/F', newId: 'c/G', name: 'G' })
    expect(s.tabs.map((t) => t.id)).toEqual(['c/G/a', 'c/F2/b'])
    expect(s.tabs[0].item.name).toBe('c/F/a')
  })

  it('ignores results from a superseded send', () => {
    let s = withTabs('a')
    const key = keyOf(s, 'a')
    s = reducer(s, { type: 'sendStart', key, sendId: '1' })
    s = reducer(s, { type: 'sendStart', key, sendId: '2' })
    s = reducer(s, { type: 'sendDone', key, sendId: '1', result: { ok: false, error: 'old' } })
    expect(s.tabs[0].response).toBeUndefined()
    s = reducer(s, { type: 'sendDone', key, sendId: '2', result: { ok: false, error: 'new' } })
    expect(s.tabs[0]).toMatchObject({ sendId: undefined, response: { error: 'new' } })
  })

  it('closes tabs under a deleted folder', () => {
    const s = reducer(withTabs('collections/C/F/a', 'collections/C/F2/b', 'collections/C/F/x/c'), {
      type: 'removed',
      id: 'collections/C/F',
    })
    expect(s.tabs.map((t) => t.id)).toEqual(['collections/C/F2/b'])
    expect(activeId(s)).toBe('collections/C/F2/b')
  })

  it('clears tabs when switching workspace, keeps them on refresh', () => {
    expect(reducer(withTabs('a'), { type: 'workspace', workspace: ws('/w') }).tabs).toHaveLength(1)
    expect(reducer(withTabs('a'), { type: 'workspace', workspace: ws('/other') }).tabs).toHaveLength(0)
  })
})

describe('viewBody', () => {
  const enc = (s: string) => new TextEncoder().encode(s)
  it('pretty-prints JSON, detected by content type or content', () => {
    expect(viewBody(enc('{"a":1}'), 'application/json')).toMatchObject({ language: 'json', pretty: '{\n  "a": 1\n}' })
    expect(viewBody(enc('[1]'))).toMatchObject({ language: 'json' })
    expect(viewBody(enc('{nope'))).toMatchObject({ language: 'text', pretty: '{nope' })
  })
  it('recognises binary content instead of showing garbage', () => {
    expect(viewBody(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0xff, 0xfe]))).toEqual({ kind: 'binary', size: 6 })
    expect(viewBody(new Uint8Array([104, 0, 105]))).toEqual({ kind: 'binary', size: 3 })
    expect(viewBody(new Uint8Array())).toEqual({ kind: 'empty' })
  })
  it('truncates huge bodies, even mid multi-byte character', () => {
    const bytes = new Uint8Array(MAX_RENDER_BYTES + 10).fill(0x61)
    bytes.set(enc('é'), MAX_RENDER_BYTES - 1) // 2-byte char straddling the cut
    const v = viewBody(bytes, 'text/plain')
    expect(v).toMatchObject({ kind: 'text', truncated: true })
    if (v.kind === 'text') expect(v.text.length).toBe(MAX_RENDER_BYTES - 1)
  })
})

describe('formatting helpers', () => {
  it('formats sizes like Postman', () => {
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(2048)).toBe('2.00 KB')
    expect(formatBytes(3 * 1024 * 1024)).toBe('3.00 MB')
  })
  it('strips the Electron IPC error prefix', () => {
    expect(cleanError(new Error("Error invoking remote method 'node:delete': WorkspaceError: Path outside workspace: x"))).toBe(
      'Path outside workspace: x',
    )
    expect(cleanError(new Error("Error invoking remote method 'a': Error: boom"))).toBe('boom')
    expect(cleanError('plain')).toBe('plain')
  })
})
