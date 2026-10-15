import { describe, expect, it } from 'vitest'
import { MAX_RENDER_BYTES, cleanError, formatBytes, viewBody } from '../../src/renderer/lib/body'


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


it('decodes declared legacy charsets and provides desktop-appropriate errors', () => {
  expect(viewBody(new Uint8Array([99, 97, 102, 233]), 'text/plain; charset=iso-8859-1')).toMatchObject({ kind: 'text', text: 'café' })
  expect(cleanError('self signed certificate; if the root CA is installed locally, try running Node.js with --use-system-ca')).toBe('self signed certificate')
  expect(cleanError('net::ERR_UNSAFE_PORT')).toContain('port is blocked')
})
