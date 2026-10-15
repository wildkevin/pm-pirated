import { readFileSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import { stableStringify } from '../shared/format/stableJson'
import type { Crypt } from './crypto'
import { writeFileAtomic } from './workspace/fsAtomic'

/**
 * Secret variable values, encrypted per value, in %APPDATA%/pm-local/secrets.json — never in the
 * workspace folder. Keys look like `<workspace root>::<scope>::<variable>::<initial|current>`.
 */
export class SecretStore {
  private data: Record<string, string>

  constructor(
    private file: string,
    private crypt: Crypt,
  ) {
    try {
      this.data = JSON.parse(readFileSync(file, 'utf8'))
    } catch {
      this.data = {}
    }
  }

  get(key: string): string | undefined {
    const c = this.data[key]
    if (c === undefined) return undefined
    try {
      return this.crypt.decrypt(c)
    } catch {
      return undefined
    }
  }

  // Writes are queued so an older snapshot can never land on disk after a newer one.
  private writing: Promise<void> = Promise.resolve()

  async setMany(entries: Record<string, string | undefined>): Promise<void> {
    for (const [k, v] of Object.entries(entries)) {
      if (v === undefined) delete this.data[k]
      else this.data[k] = this.crypt.encrypt(v)
    }
    const snapshot = stableStringify(this.data)
    const write = async () => {
      await mkdir(dirname(this.file), { recursive: true })
      await writeFileAtomic(this.file, snapshot)
    }
    const done = this.writing.then(write, write)
    this.writing = done.catch(() => undefined)
    return done
  }

  /** Re-keys every secret under `from` to `to` (scope renamed). Values stay encrypted as they are. */
  async renamePrefix(from: string, to: string): Promise<void> {
    const moving = Object.keys(this.data).filter((k) => k.startsWith(from))
    if (!moving.length) return
    for (const k of moving) {
      this.data[to + k.slice(from.length)] = this.data[k]
      delete this.data[k]
    }
    await this.setMany({})
  }

  /** Drops every secret whose key starts with `prefix` (scope deleted). */
  async deletePrefix(prefix: string): Promise<void> {
    const gone = Object.keys(this.data).filter((k) => k.startsWith(prefix))
    if (gone.length) await this.setMany(Object.fromEntries(gone.map((k) => [k, undefined])))
  }
}
