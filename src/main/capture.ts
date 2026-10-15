// Capture proxy support in main: the app CA, trusting it, the Windows system-proxy switch, and
// choosing the upstream proxy (corporate proxy / PAC) for captured traffic.
import { X509Certificate } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { UpstreamProxy } from '../shared/engine'
import type { AppSettingsData } from '../shared/settings'
import type { Crypt } from './crypto'
import { parseProxyResult } from './netconfig'
import { caExpired, createCa, type Pem } from '../proxy/certs'
import { writeFileAtomic } from './workspace/fsAtomic'

/** Runs a program (no shell); resolves with exit code and output. */
export type Exec = (file: string, args: string[]) => Promise<{ code: number; stdout: string }>

// ---------------- CA ----------------

/** The capture CA: certificate in proxy/ca.crt, private key encrypted (DPAPI) in proxy/ca.key.enc. */
export async function ensureCa(dir: string, crypt: Crypt): Promise<Pem & { certPath: string; thumbprint: string }> {
  const certPath = join(dir, 'ca.crt')
  const keyPath = join(dir, 'ca.key.enc')
  let pem: Pem | undefined
  try {
    const cert = await readFile(certPath, 'utf8')
    const key = crypt.decrypt(await readFile(keyPath, 'utf8'))
    if (!caExpired(cert)) pem = { cert, key }
  } catch {
    pem = undefined
  }
  if (!pem) {
    pem = createCa()
    await mkdir(dir, { recursive: true })
    await writeFileAtomic(certPath, pem.cert)
    await writeFileAtomic(keyPath, crypt.encrypt(pem.key))
  }
  return { ...pem, certPath, thumbprint: thumbprintOf(pem.cert) }
}

export const thumbprintOf = (certPem: string) => new X509Certificate(certPem).fingerprint.replace(/:/g, '')

// ---------------- trusting the CA ----------------

/** Per-user trust, no admin rights: Windows shows its own confirmation dialog. */
export async function trustCa(exec: Exec, platform: NodeJS.Platform, certPath: string): Promise<void> {
  if (platform === 'win32') {
    const r = await exec('certutil', ['-user', '-addstore', 'Root', certPath])
    if (r.code !== 0) throw new Error(`certutil failed (${r.code}): ${r.stdout.trim().split('\n').pop()}`)
  } else if (platform === 'darwin') {
    const home = process.env.HOME ?? ''
    const r = await exec('security', ['add-trusted-cert', '-r', 'trustRoot', '-k', join(home, 'Library/Keychains/login.keychain-db'), certPath])
    if (r.code !== 0) throw new Error(`Could not add the certificate to the login keychain (${r.code})`)
  } else {
    throw new Error('Add the certificate to your system trust store manually (Export certificate).')
  }
}

export async function untrustCa(exec: Exec, platform: NodeJS.Platform, thumbprint: string, certPath: string): Promise<void> {
  if (platform === 'win32') await exec('certutil', ['-user', '-delstore', 'Root', thumbprint])
  else if (platform === 'darwin') {
    await exec('security', ['remove-trusted-cert', certPath])
    await exec('security', ['delete-certificate', '-Z', thumbprint])
  }
}

export async function isCaTrusted(exec: Exec, platform: NodeJS.Platform, thumbprint: string, certPath: string): Promise<boolean | null> {
  if (platform === 'win32') return (await exec('certutil', ['-user', '-verifystore', 'Root', thumbprint])).code === 0
  if (platform === 'darwin') return (await exec('security', ['verify-cert', '-c', certPath])).code === 0
  return null
}

// ---------------- Windows system proxy (HKCU, no admin) ----------------

const INTERNET_SETTINGS = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings'
const VALUES = ['ProxyEnable', 'ProxyServer', 'ProxyOverride', 'AutoConfigURL'] as const
type ValueName = (typeof VALUES)[number]
export type InternetSettings = Partial<Record<ValueName, string>>

/** Parses `reg query` lines like `    ProxyEnable    REG_DWORD    0x1`. */
export function parseRegQuery(stdout: string): InternetSettings {
  const out: InternetSettings = {}
  for (const line of stdout.split(/\r?\n/)) {
    const m = /^\s+(\S+)\s+REG_(?:SZ|DWORD|EXPAND_SZ)\s+(.*)$/.exec(line)
    if (m && (VALUES as readonly string[]).includes(m[1])) out[m[1] as ValueName] = m[2].trim()
  }
  return out
}

export async function readInternetSettings(exec: Exec): Promise<InternetSettings> {
  return parseRegQuery((await exec('reg', ['query', INTERNET_SETTINGS])).stdout)
}

async function setValue(exec: Exec, name: ValueName, value: string | undefined): Promise<void> {
  if (value === undefined) {
    await exec('reg', ['delete', INTERNET_SETTINGS, '/v', name, '/f'])
    return
  }
  const dword = name === 'ProxyEnable'
  await exec('reg', ['add', INTERNET_SETTINGS, '/v', name, '/t', dword ? 'REG_DWORD' : 'REG_SZ', '/d', dword ? String(parseInt(value, 16) || Number(value) || 0) : value, '/f'])
}

/** Tells running programs (browsers) that the proxy settings changed. */
async function notifyWindows(exec: Exec): Promise<void> {
  const script =
    "$s='[DllImport(\"wininet.dll\")] public static extern bool InternetSetOption(System.IntPtr h,int o,System.IntPtr b,int l);';" +
    '$t=Add-Type -MemberDefinition $s -Name W -Namespace PmLocal -PassThru;' +
    '[void]$t::InternetSetOption([System.IntPtr]::Zero,39,[System.IntPtr]::Zero,0);[void]$t::InternetSetOption([System.IntPtr]::Zero,37,[System.IntPtr]::Zero,0)'
  await exec('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script]).catch(() => undefined)
}

/** Points Windows at the capture proxy; the previous settings are saved first (once). */
export async function enableSystemProxy(exec: Exec, backupFile: string, port: number): Promise<void> {
  const current = await readInternetSettings(exec)
  if (!existsSync(backupFile)) await writeFile(backupFile, JSON.stringify(current))
  const previousOverride = current.ProxyOverride && !current.ProxyOverride.includes('<local>') ? `${current.ProxyOverride};<local>` : (current.ProxyOverride ?? '<local>')
  await setValue(exec, 'ProxyServer', `127.0.0.1:${port}`)
  await setValue(exec, 'ProxyOverride', previousOverride)
  await setValue(exec, 'ProxyEnable', '1')
  if (current.AutoConfigURL !== undefined) await setValue(exec, 'AutoConfigURL', undefined)
  await notifyWindows(exec)
}

/** Restores the saved settings exactly (values that did not exist are removed again). */
export async function restoreSystemProxy(exec: Exec, backupFile: string): Promise<boolean> {
  let saved: InternetSettings
  try {
    saved = JSON.parse(await readFile(backupFile, 'utf8'))
  } catch {
    return false
  }
  for (const name of VALUES) await setValue(exec, name, name === 'ProxyEnable' ? (saved.ProxyEnable ?? '0') : saved[name])
  await rm(backupFile, { force: true })
  await notifyWindows(exec)
  return true
}

export async function readBackup(backupFile: string): Promise<InternetSettings | null> {
  try {
    return JSON.parse(await readFile(backupFile, 'utf8'))
  } catch {
    return null
  }
}

// ---------------- upstream for captured traffic ----------------

function bypassed(list: string[], host: string): boolean {
  return list.some((p) => {
    const pat = p.trim().toLowerCase()
    if (!pat) return false
    if (pat === '<local>') return !host.includes('.')
    const re = new RegExp(`^${pat.split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`)
    return re.test(host.toLowerCase())
  })
}

/**
 * Where captured traffic goes next: the custom proxy from Settings, else the system proxy (as it was
 * before capture took it over), else direct. Never our own proxy (that would loop).
 */
export async function upstreamFor(
  url: string,
  settings: AppSettingsData,
  ownPort: number,
  resolveSystem: (url: string) => Promise<string>,
): Promise<UpstreamProxy | null> {
  const target = new URL(url)
  const c = settings.proxy.custom
  const protocol = target.protocol === 'https:' ? 'https' : 'http'
  if (c.enabled && c.host && (protocol === 'https' ? c.https : c.http)) {
    if (bypassed(c.bypass.split(','), target.hostname)) return null
    return { host: c.host, port: c.port, ...(c.auth.enabled ? { auth: `${c.auth.username}:${c.auth.password}` } : {}) }
  }
  if (!settings.proxy.useSystemProxy) return null
  const p = parseProxyResult(await resolveSystem(url))
  if (!p) return null
  if (p.port === ownPort && /^(127\.0\.0\.1|localhost|\[?::1\]?)$/i.test(p.host)) return null
  const a = settings.proxy.auth
  return { ...p, ...(a.enabled && a.username ? { auth: `${a.username}:${a.password}` } : {}) }
}

/** Electron proxy config reproducing the saved Windows settings (for resolving the upstream). */
export function sessionProxyConfig(saved: InternetSettings): { pacScript?: string; proxyRules?: string; proxyBypassRules?: string; mode?: 'direct' } {
  if (saved.AutoConfigURL) return { pacScript: saved.AutoConfigURL }
  if (saved.ProxyServer && saved.ProxyEnable && Number(saved.ProxyEnable) !== 0)
    return { proxyRules: saved.ProxyServer, proxyBypassRules: (saved.ProxyOverride ?? '').split(';').join(',') }
  return { mode: 'direct' }
}
