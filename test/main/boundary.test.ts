import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ BrowserWindow: class {}, ipcMain: { once: () => undefined } }))
const { isTrustedUrl } = await import('../../src/main/window')
const { ARGS } = await import('../../src/main/ipcSchemas')

describe('isTrustedUrl', () => {
  const file = join('/app', 'out', 'renderer', 'index.html')
  it('accepts only our bundled page in production', () => {
    const own = pathToFileURL(file).href
    expect(isTrustedUrl(own, { file })).toBe(true)
    expect(isTrustedUrl(own + '#/x', { file })).toBe(true)
    expect(isTrustedUrl(pathToFileURL(join('/app', 'other.html')).href, { file })).toBe(false)
    expect(isTrustedUrl('https://evil.test/', { file })).toBe(false)
    expect(isTrustedUrl('not a url', { file })).toBe(false)
  })
  it('accepts only the dev server origin in development', () => {
    const loc = { file, devUrl: 'http://localhost:5173/' }
    expect(isTrustedUrl('http://localhost:5173/index.html', loc)).toBe(true)
    expect(isTrustedUrl('http://localhost:5174/', loc)).toBe(false)
  })
})

describe('IPC argument schemas', () => {
  const item = { name: 'R', request: { method: 'GET', url: '', header: [] }, response: [], event: [{ listen: 'test' }] }
  it('accepts a request item and keeps unknown fields', () => {
    expect(ARGS.saveRequest.parse(['collections/C/R.request.json', item])[1]).toEqual(item)
  })
  it('accepts optional trailing arguments and the full settings shape', () => {
    expect(ARGS.createRequest.parse(['collections/C', 'R'])).toEqual(['collections/C', 'R'])
    expect(ARGS.deleteHistory.parse([])).toEqual([])
    expect(ARGS.sendRequest.parse(['s1', null, item, null])[1]).toBeNull()
    expect(() => ARGS.readVariables.parse(['bogus'])).toThrow()
    expect(ARGS.readVariables.parse(['env:environments/Dev.env.json'])).toBeTruthy()
  })

  it('rejects malformed input', () => {
    expect(() => ARGS.saveRequest.parse(['x', { ...item, request: { ...item.request, url: 5 } }])).toThrow()
    expect(() => ARGS.createCollection.parse([' '])).toThrow()
    expect(() => ARGS.createCollection.parse(['x'.repeat(201)])).toThrow()
    expect(() => ARGS.deleteNode.parse([])).toThrow()
  })
})

describe('keyboard zoom', () => {
  it('steps by half a level, resets with 0, and stays within 50%–300%', async () => {
    const { nextZoom, ZOOM_MAX, ZOOM_MIN } = await import('../../src/main/window')
    expect(nextZoom(0, '=')).toBe(0.5)
    expect(nextZoom(0, '+')).toBe(0.5)
    expect(nextZoom(0, 'NumpadAdd')).toBe(0.5)
    expect(nextZoom(0.5, '-')).toBe(0)
    expect(nextZoom(2, '0')).toBe(0)
    expect(nextZoom(ZOOM_MAX, '=')).toBe(ZOOM_MAX)
    expect(nextZoom(ZOOM_MIN, '-')).toBe(ZOOM_MIN)
    expect(nextZoom(0, 'a')).toBeNull()
  })
})
