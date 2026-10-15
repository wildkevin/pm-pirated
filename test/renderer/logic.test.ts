import { describe, expect, it } from 'vitest'
import { MAX_RENDER_BYTES, cleanError, formatBytes, viewBody } from '../../src/renderer/lib/body'
import { initialState, isDirty, reducer, type State } from '../../src/renderer/state'
import type { PmItem } from '../../src/shared/format/types'

const item = (name: string): PmItem => ({ name, request: { method: 'GET', url: '', header: [] } })
const ws = (root: string) => ({ root, name: root, collections: [] })
const withTabs = (...ids: string[]): State =>
  ids.reduce((s, id) => reducer(s, { type: 'open', id, item: item(id) }), reducer(initialState, { type: 'workspace', workspace: ws('/w') }))

describe('tab reducer', () => {
  it('does not open the same request twice', () => {
    const s = reducer(withTabs('a', 'b'), { type: 'open', id: 'a', item: item('a') })
    expect(s.tabs.map((t) => t.id)).toEqual(['a', 'b'])
    expect(s.activeId).toBe('a')
  })

  it('activates the neighbour when closing the active tab', () => {
    let s = reducer(withTabs('a', 'b', 'c'), { type: 'activate', id: 'b' })
    s = reducer(s, { type: 'close', id: 'b' })
    expect(s.activeId).toBe('c')
    s = reducer(s, { type: 'close', id: 'c' })
    expect(s.activeId).toBe('a')
    s = reducer(s, { type: 'close', id: 'a' })
    expect(s.activeId).toBeNull()
  })

  it('tracks dirty state across edits and saves', () => {
    let s = withTabs('a')
    expect(isDirty(s.tabs[0])).toBe(false)
    const edited = { ...item('a'), request: { ...item('a').request, url: 'http://x' } }
    s = reducer(s, { type: 'edit', id: 'a', item: edited })
    expect(isDirty(s.tabs[0])).toBe(true)
    s = reducer(s, { type: 'saved', id: 'a', item: edited })
    expect(isDirty(s.tabs[0])).toBe(false)
  })

  it('renaming re-keys the tab and does not make a clean tab dirty', () => {
    const s = reducer(withTabs('c/a'), { type: 'renamed', id: 'c/a', newId: 'c/b', name: 'New' })
    const key = s.tabs[0].key
    expect(s.tabs[0]).toMatchObject({ id: 'c/b', item: { name: 'New' } })
    // A new request created at the old path must not reuse the renamed tab's key.
    const s2 = reducer(s, { type: 'open', id: 'c/a', item: item('c/a') })
    expect(new Set(s2.tabs.map((t) => t.key)).size).toBe(2)
    expect(s2.tabs[0].key).toBe(key)
    expect(s.activeId).toBe('c/b')
    expect(isDirty(s.tabs[0])).toBe(false)
  })

  it('renaming a folder re-keys the tabs inside it', () => {
    const s = reducer(withTabs('c/F/a', 'c/F2/b'), { type: 'renamed', id: 'c/F', newId: 'c/G', name: 'G' })
    expect(s.tabs.map((t) => t.id)).toEqual(['c/G/a', 'c/F2/b'])
    expect(s.tabs[0].item.name).toBe('c/F/a')
  })

  it('ignores results from a superseded send', () => {
    let s = reducer(withTabs('a'), { type: 'sendStart', id: 'a', sendId: '1' })
    s = reducer(s, { type: 'sendStart', id: 'a', sendId: '2' })
    s = reducer(s, { type: 'sendDone', id: 'a', sendId: '1', result: { ok: false, error: 'old' } })
    expect(s.tabs[0].response).toBeUndefined()
    s = reducer(s, { type: 'sendDone', id: 'a', sendId: '2', result: { ok: false, error: 'new' } })
    expect(s.tabs[0]).toMatchObject({ sendId: undefined, response: { error: 'new' } })
  })

  it('closes tabs under a deleted folder', () => {
    const s = reducer(withTabs('collections/C/F/a', 'collections/C/F2/b', 'collections/C/F/x/c'), {
      type: 'removed',
      id: 'collections/C/F',
    })
    expect(s.tabs.map((t) => t.id)).toEqual(['collections/C/F2/b'])
    expect(s.activeId).toBe('collections/C/F2/b')
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
