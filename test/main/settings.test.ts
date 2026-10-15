import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { fakeCrypt } from '../../src/main/crypto'
import { engineOptions, parseProxyResult, systemProxyFor, writeCaBundle } from '../../src/main/netconfig'
import { SecretStore } from '../../src/main/secrets'
import { AppSettings } from '../../src/main/settings'
import { DEFAULT_SETTINGS } from '../../src/shared/settings'

const tmp = () => mkdtemp(join(tmpdir(), 'pml-set-'))

describe('AppSettings', () => {
  it('defaults match Postman: no timeout, 50 MB, SSL on, system proxy on, env proxies off', async () => {
    const s = new AppSettings(join(await tmp(), 's.json'), fakeCrypt).get()
    expect(s.general).toEqual({ timeoutMs: 0, maxResponseSizeMb: 50, sslVerification: true, followRedirects: true, sendPostmanToken: true, allowFilesOutsideWorkingDir: false })
    expect(s.proxy.useSystemProxy).toBe(true)
    expect(s.proxy.respectEnvVars).toBe(false)
  })

  it('stores passwords encrypted and reads them back', async () => {
    const file = join(await tmp(), 's.json')
    const s = new AppSettings(file, fakeCrypt)
    const next = s.get()
    next.proxy.auth = { enabled: true, username: 'me', password: 'hunter2' }
    next.certificates.client = [{ host: 'api.corp', pfx: 'c.pfx', passphrase: 'pp' }]
    await s.save(next)
    const raw = await readFile(file, 'utf8')
    expect(raw).not.toContain('hunter2')
    expect(raw).not.toContain('"pp"')
    const again = new AppSettings(file, fakeCrypt).get()
    expect(again.proxy.auth.password).toBe('hunter2')
    expect(again.certificates.client[0].passphrase).toBe('pp')
  })

  it('fills new fields with defaults, ignores wrong types, survives a corrupt file', async () => {
    const dir = await tmp()
    await writeFile(join(dir, 'a.json'), JSON.stringify({ general: { timeoutMs: 'x', followRedirects: false }, recentWorkspaces: ['/w', 5] }))
    const s = new AppSettings(join(dir, 'a.json'), fakeCrypt).get()
    expect(s.general.timeoutMs).toBe(0)
    expect(s.general.followRedirects).toBe(false)
    expect(s.recentWorkspaces).toEqual(['/w'])
    await writeFile(join(dir, 'b.json'), '{oops')
    expect(new AppSettings(join(dir, 'b.json'), fakeCrypt).get()).toEqual(DEFAULT_SETTINGS)
  })

  it('a password encrypted elsewhere becomes empty instead of crashing', async () => {
    const dir = await tmp()
    const data = structuredClone(DEFAULT_SETTINGS)
    data.proxy.auth.password = 'not-decryptable'
    await writeFile(join(dir, 's.json'), JSON.stringify(data))
    const broken = { encrypt: fakeCrypt.encrypt, decrypt: () => { throw new Error('bad') } }
    expect(new AppSettings(join(dir, 's.json'), broken).get().proxy.auth.password).toBe('')
  })

  it('rapid saves land in order: the last one wins on disk, and flush waits for it', async () => {
    const file = join(await tmp(), 's.json')
    const s = new AppSettings(file, fakeCrypt)
    for (let i = 1; i <= 20; i++) void s.save({ ...s.get(), zoomLevel: i / 10 })
    await s.flush()
    expect(JSON.parse(await readFile(file, 'utf8')).zoomLevel).toBe(2)
  })

  it('remembers recent workspaces, newest first, max 10', async () => {
    const s = new AppSettings(join(await tmp(), 'nested', 's.json'), fakeCrypt)
    for (let i = 0; i < 12; i++) await s.rememberWorkspace(`/w${i}`)
    await s.rememberWorkspace('/w5')
    expect(s.get().recentWorkspaces[0]).toBe('/w5')
    expect(s.get().recentWorkspaces).toHaveLength(10)
  })
})

describe('SecretStore', () => {
  it('encrypts each value, deletes by prefix', async () => {
    const file = join(await tmp(), 'secrets.json')
    const s = new SecretStore(file, fakeCrypt)
    await s.setMany({ 'w::env::a::current': 'one', 'w::env::b::current': 'two', 'w::globals::c::current': 'three' })
    expect(await readFile(file, 'utf8')).not.toContain('one')
    expect(new SecretStore(file, fakeCrypt).get('w::env::a::current')).toBe('one')
    await s.deletePrefix('w::env::')
    expect(s.get('w::env::b::current')).toBeUndefined()
    expect(s.get('w::globals::c::current')).toBe('three')
  })
})

describe('network config', () => {
  it('parses Chromium proxy answers', () => {
    expect(parseProxyResult('DIRECT')).toBeNull()
    expect(parseProxyResult('PROXY proxy.corp:8080; DIRECT')).toEqual({ host: 'proxy.corp', port: 8080 })
    expect(parseProxyResult('SOCKS5 s:1080; PROXY p:3128')).toEqual({ host: 'p', port: 3128 })
    expect(parseProxyResult('PROXY [::1]:8080')).toEqual({ host: '::1', port: 8080 })
    expect(parseProxyResult('')).toBeNull()
  })

  it('adds system proxy credentials when configured', async () => {
    const settings = structuredClone(DEFAULT_SETTINGS)
    settings.proxy.auth = { enabled: true, username: 'u', password: 'p' }
    expect(await systemProxyFor(async () => 'PROXY corp:80', 'https://x', settings)).toEqual({
      host: 'corp',
      port: 80,
      tunnel: false,
      authenticate: true,
      username: 'u',
      password: 'p',
    })
  })

  it('maps settings to engine options', () => {
    const s = structuredClone(DEFAULT_SETTINGS)
    s.proxy.custom = { ...s.proxy.custom, enabled: true, host: 'p', port: 3128, https: false, bypass: 'a.corp, b.corp' }
    s.certificates.client = [{ host: 'x' }, { host: 'api', pfx: 'c.pfx' }]
    const o = engineOptions(s, '/ca.pem')
    expect(o.customProxy).toEqual({ host: 'p', port: 3128, protocols: ['http'], bypass: ['a.corp', 'b.corp'] })
    expect(o.extraCaFile).toBe('/ca.pem')
    expect(o.clientCerts).toEqual([{ host: 'api', pfx: 'c.pfx' }])
  })

  it('bundles the OS root store and a user CA file', async () => {
    const dir = await tmp()
    await writeFile(join(dir, 'corp.pem'), '-----BEGIN CERTIFICATE-----\nCORP\n-----END CERTIFICATE-----\n')
    const s = structuredClone(DEFAULT_SETTINGS)
    s.certificates = { useSystemStore: false, ca: { enabled: true, file: join(dir, 'corp.pem') }, client: [] }
    const out = await writeCaBundle(join(dir, 'bundle.pem'), s)
    expect(await readFile(out!, 'utf8')).toContain('CORP')
    s.certificates.ca.enabled = false
    expect(await writeCaBundle(join(dir, 'none.pem'), s)).toBeUndefined()
  })

  it.runIf(process.platform === 'win32')('reads the Windows certificate store', async () => {
    const dir = await tmp()
    const out = await writeCaBundle(join(dir, 'win.pem'), DEFAULT_SETTINGS)
    expect((await readFile(out!, 'utf8')).match(/BEGIN CERTIFICATE/g)!.length).toBeGreaterThan(5)
  })
})
