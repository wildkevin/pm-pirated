import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ BrowserWindow: class {} }))
const { isTrustedUrl } = await import('../../src/main/window')
const { ARGS } = await import('../../src/main/ipcSchemas')
const { AppSettings } = await import('../../src/main/settings')

describe('isTrustedUrl', () => {
  const file = join('/app', 'out', 'renderer', 'index.html')
  it('accepts only our bundled page in production', () => {
    const own = new URL(`file://${file}`).href
    expect(isTrustedUrl(own, { file })).toBe(true)
    expect(isTrustedUrl(own + '#/x', { file })).toBe(true)
    expect(isTrustedUrl('file:///etc/passwd', { file })).toBe(false)
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
  it('rejects malformed input', () => {
    expect(() => ARGS.saveRequest.parse(['x', { ...item, request: { ...item.request, url: 5 } }])).toThrow()
    expect(() => ARGS.createCollection.parse([' '])).toThrow()
    expect(() => ARGS.createCollection.parse(['x'.repeat(201)])).toThrow()
    expect(() => ARGS.deleteNode.parse([])).toThrow()
  })
})

describe('AppSettings', () => {
  it('remembers recent workspaces, newest first, deduplicated, max 10', async () => {
    const file = join(await mkdtemp(join(tmpdir(), 'pml-set-')), 'nested', 'settings.json')
    const s = new AppSettings(file)
    for (let i = 0; i < 12; i++) await s.rememberWorkspace(`/w${i}`)
    await s.rememberWorkspace('/w5')
    expect(s.get().recentWorkspaces[0]).toBe('/w5')
    expect(s.get().recentWorkspaces).toHaveLength(10)
    expect(new AppSettings(file).get()).toEqual(JSON.parse(await readFile(file, 'utf8')))
  })
  it('falls back to defaults when the file is corrupt', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'pml-set-'))
    const { writeFile } = await import('node:fs/promises')
    await writeFile(join(dir, 's.json'), '{oops')
    expect(new AppSettings(join(dir, 's.json')).get()).toEqual({ recentWorkspaces: [] })
  })
})
