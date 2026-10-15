import { readFileSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import { stableStringify } from '../shared/format/stableJson'
import { DEFAULT_SETTINGS, THEMES, type AppSettingsData } from '../shared/settings'
import type { Crypt } from './crypto'
import { writeFileAtomic } from './workspace/fsAtomic'

/** Deep-merges stored values over defaults so new settings get defaults and wrong types are ignored. */
function merge<T>(defaults: T, stored: unknown): T {
  if (Array.isArray(defaults)) return (Array.isArray(stored) ? stored : defaults) as T
  if (defaults && typeof defaults === 'object') {
    const src = stored && typeof stored === 'object' ? (stored as Record<string, unknown>) : {}
    return Object.fromEntries(
      Object.entries(defaults as Record<string, unknown>).map(([k, v]) => [k, merge(v, src[k])]),
    ) as T
  }
  return (typeof stored === typeof defaults ? stored : defaults) as T
}

// Passwords are stored encrypted; these are the paths that hold them.
type Mapper = (s: AppSettingsData, f: (v: string) => string) => void
const SECRET_FIELDS: Mapper = (s, f) => {
  s.proxy.auth.password = f(s.proxy.auth.password)
  s.proxy.custom.auth.password = f(s.proxy.custom.auth.password)
  for (const c of s.certificates.client) if (c.passphrase) c.passphrase = f(c.passphrase)
}

/** App-level settings in %APPDATA%/pm-local/settings.json. */
export class AppSettings {
  private data: AppSettingsData

  constructor(
    private file: string,
    private crypt: Crypt,
  ) {
    this.data = this.load()
  }

  private load(): AppSettingsData {
    let stored: unknown
    try {
      stored = JSON.parse(readFileSync(this.file, 'utf8'))
    } catch {
      return structuredClone(DEFAULT_SETTINGS)
    }
    const data = merge(DEFAULT_SETTINGS, stored)
    // Old files gain defaults; malformed enums/ranges must not crash the editor or theme picker.
    const oneOf = <T,>(value: T, allowed: readonly T[], fallback: T) => allowed.includes(value) ? value : fallback
    data.general.httpVersion = oneOf(data.general.httpVersion, ['auto', 'http1', 'http2'], 'auto')
    data.general.responseFormat = oneOf(data.general.responseFormat, ['auto', 'json'], 'auto')
    data.appearance.mode = oneOf(data.appearance.mode, ['system', 'manual'], 'system')
    for (const key of ['day', 'night', 'manual'] as const) data.appearance[key] = oneOf(data.appearance[key], THEMES, DEFAULT_SETTINGS.appearance[key])
    data.editor.indentType = oneOf(data.editor.indentType, ['space', 'tab'], 'space')
    const range = (value: number, min: number, max: number, fallback: number) => Number.isInteger(value) && value >= min && value <= max ? value : fallback
    data.editor.fontSize = range(data.editor.fontSize, 8, 40, 12)
    data.editor.indentCount = range(data.editor.indentCount, 1, 8, 4)
    data.recentWorkspaces = data.recentWorkspaces.filter((s): s is string => typeof s === 'string')
    SECRET_FIELDS(data, (v) => {
      if (!v) return v
      try {
        return this.crypt.decrypt(v)
      } catch {
        return '' // encrypted by another Windows user/machine: ask again rather than crash
      }
    })
    return data
  }

  get(): AppSettingsData {
    return structuredClone(this.data)
  }

  // Writes run one after another so a slow older write can never land after a newer one.
  private writing: Promise<void> = Promise.resolve()

  async save(next: AppSettingsData): Promise<void> {
    this.data = merge(DEFAULT_SETTINGS, structuredClone(next))
    const onDisk = structuredClone(this.data)
    // An untouched Add Certificate row is an editor draft, not a configured certificate.
    onDisk.certificates.client = onDisk.certificates.client.filter((cert) => cert.host || cert.cert || cert.key || cert.pfx || cert.passphrase)
    SECRET_FIELDS(onDisk, (v) => (v ? this.crypt.encrypt(v) : v))
    const write = async () => {
      await mkdir(dirname(this.file), { recursive: true })
      await writeFileAtomic(this.file, stableStringify(onDisk))
    }
    const done = this.writing.then(write, write)
    this.writing = done.catch(() => undefined)
    return done
  }

  /** Resolves when every save requested so far is on disk (used before quitting). */
  flush(): Promise<void> {
    return this.writing
  }

  async forgetWorkspace(dir: string): Promise<void> {
    await this.save({ ...this.data, recentWorkspaces: this.data.recentWorkspaces.filter((d) => d !== dir) })
  }

  async rememberWorkspace(dir: string): Promise<void> {
    const recent = [dir, ...this.data.recentWorkspaces.filter((d) => d !== dir)].slice(0, 10)
    await this.save({ ...this.data, recentWorkspaces: recent })
  }
}
