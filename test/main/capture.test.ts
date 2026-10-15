import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  enableSystemProxy,
  ensureCa,
  isCaTrusted,
  parseRegQuery,
  restoreSystemProxy,
  sessionProxyConfig,
  trustCa,
  upstreamFor,
  type Exec,
} from '../../src/main/capture'
import { fakeCrypt } from '../../src/main/crypto'
import { DEFAULT_SETTINGS } from '../../src/shared/settings'

const tmp = () => mkdtemp(join(tmpdir(), 'pml-cap-'))

/** A fake `reg` that keeps an in-memory registry. */
function fakeReg(initial: Record<string, [string, string]>) {
  const reg = new Map(Object.entries(initial))
  const calls: string[][] = []
  const exec: Exec = vi.fn(async (file: string, args: string[]) => {
    calls.push([file, ...args])
    if (file !== 'reg') return { code: 0, stdout: '' }
    if (args[0] === 'query')
      return { code: 0, stdout: ['HKEY_CURRENT_USER\\...\\Internet Settings', ...[...reg].map(([k, [t, v]]) => `    ${k}    ${t}    ${v}`)].join('\r\n') }
    const name = args[args.indexOf('/v') + 1]
    if (args[0] === 'delete') reg.delete(name)
    if (args[0] === 'add') reg.set(name, [args[args.indexOf('/t') + 1], args[args.indexOf('/d') + 1]])
    return { code: 0, stdout: '' }
  })
  return { reg, exec, calls }
}

describe('capture CA', () => {
  it('creates the CA once, keeps the key encrypted, and reuses it', async () => {
    const dir = await tmp()
    const a = await ensureCa(dir, fakeCrypt)
    expect(await readFile(join(dir, 'ca.key.enc'), 'utf8')).not.toContain('PRIVATE KEY')
    const b = await ensureCa(dir, fakeCrypt)
    expect(b.cert).toBe(a.cert)
    expect(a.thumbprint).toMatch(/^[0-9A-F]{40}$/)
  })

  it('regenerates when the key can no longer be decrypted', async () => {
    const dir = await tmp()
    const a = await ensureCa(dir, fakeCrypt)
    const broken = { ...fakeCrypt, decrypt: () => { throw new Error('other user') } }
    expect((await ensureCa(dir, broken)).cert).not.toBe(a.cert)
  })

  it('trusts per user on Windows with certutil', async () => {
    const exec = vi.fn(async () => ({ code: 0, stdout: '' }))
    await trustCa(exec, 'win32', 'C:\\ca.crt')
    expect(exec).toHaveBeenCalledWith('certutil', ['-user', '-addstore', 'Root', 'C:\\ca.crt'])
    expect(await isCaTrusted(async () => ({ code: 0, stdout: '' }), 'win32', 'AB', 'x')).toBe(true)
    expect(await isCaTrusted(async () => ({ code: 1, stdout: '' }), 'win32', 'AB', 'x')).toBe(false)
    await expect(trustCa(async () => ({ code: 5, stdout: 'Access denied' }), 'win32', 'x')).rejects.toThrow(/Access denied/)
  })
})

describe('Windows system proxy', () => {
  it('parses reg query output', () => {
    expect(parseRegQuery('HKEY...\r\n    ProxyEnable    REG_DWORD    0x1\r\n    ProxyServer    REG_SZ    corp:8080\r\n    Other    REG_SZ    x')).toEqual({
      ProxyEnable: '0x1',
      ProxyServer: 'corp:8080',
    })
  })

  it('enables (keeping a backup once) and restores exactly what was there, including a PAC URL', async () => {
    const backup = join(await tmp(), 'backup.json')
    const { reg, exec } = fakeReg({
      ProxyEnable: ['REG_DWORD', '0x0'],
      AutoConfigURL: ['REG_SZ', 'http://pac.corp/proxy.pac'],
      ProxyOverride: ['REG_SZ', '*.corp'],
    })
    await enableSystemProxy(exec, backup, 5555)
    expect(reg.get('ProxyServer')).toEqual(['REG_SZ', '127.0.0.1:5555'])
    expect(reg.get('ProxyEnable')).toEqual(['REG_DWORD', '1'])
    expect(reg.get('ProxyOverride')).toEqual(['REG_SZ', '*.corp;<local>'])
    expect(reg.has('AutoConfigURL')).toBe(false)

    await enableSystemProxy(exec, backup, 6666) // second enable must not overwrite the original backup
    expect(JSON.parse(await readFile(backup, 'utf8')).AutoConfigURL).toBe('http://pac.corp/proxy.pac')

    expect(await restoreSystemProxy(exec, backup)).toBe(true)
    expect(reg.get('AutoConfigURL')).toEqual(['REG_SZ', 'http://pac.corp/proxy.pac'])
    expect(reg.get('ProxyEnable')).toEqual(['REG_DWORD', '0'])
    expect(reg.get('ProxyOverride')).toEqual(['REG_SZ', '*.corp'])
    expect(reg.has('ProxyServer')).toBe(false)
    expect(await restoreSystemProxy(exec, backup)).toBe(false) // nothing left to restore
  })

  it('maps saved settings to an Electron proxy config for resolving the upstream', () => {
    expect(sessionProxyConfig({ AutoConfigURL: 'http://pac/x.pac' })).toEqual({ pacScript: 'http://pac/x.pac' })
    expect(sessionProxyConfig({ ProxyEnable: '0x1', ProxyServer: 'corp:80', ProxyOverride: 'a;<local>' })).toEqual({ proxyRules: 'corp:80', proxyBypassRules: 'a,<local>' })
    expect(sessionProxyConfig({ ProxyEnable: '0x0', ProxyServer: 'corp:80' })).toEqual({ mode: 'direct' })
  })
})

describe('upstream for captured traffic', () => {
  it('prefers the custom proxy, honours bypass, otherwise uses the system proxy, never itself', async () => {
    const s = structuredClone(DEFAULT_SETTINGS)
    const sys = vi.fn(async () => 'PROXY corp:8080; DIRECT')
    expect(await upstreamFor('https://api.test/x', s, 5555, sys)).toEqual({ host: 'corp', port: 8080 })
    expect(await upstreamFor('https://api.test/x', s, 5555, async () => 'PROXY 127.0.0.1:5555')).toBeNull()
    s.proxy.custom = { ...s.proxy.custom, enabled: true, host: 'custom', port: 3128, bypass: '*.internal', auth: { enabled: true, username: 'u', password: 'p' } }
    expect(await upstreamFor('http://a.test/', s, 5555, sys)).toEqual({ host: 'custom', port: 3128, auth: 'u:p' })
    expect(await upstreamFor('http://svc.internal/', s, 5555, sys)).toBeNull()
    s.proxy.custom.enabled = false
    s.proxy.useSystemProxy = false
    expect(await upstreamFor('http://a.test/', s, 5555, sys)).toBeNull()
  })
})

describe('restore leaves no trace when there was no backup', () => {
  it('does nothing without a backup file', async () => {
    const dir = await tmp()
    await writeFile(join(dir, 'x'), '')
    const { exec, calls } = fakeReg({})
    expect(await restoreSystemProxy(exec, join(dir, 'missing.json'))).toBe(false)
    expect(calls).toEqual([])
  })
})
