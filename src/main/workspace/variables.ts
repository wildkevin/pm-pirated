// Variables for globals, environments and collections, Postman-style:
// - initial values live in the workspace files (shareable, git),
// - current values live in .pmlocal/current-values.json (local only),
// - values of 'secret' variables never touch the workspace: both live encrypted in the SecretStore.
// Local values are keyed by the scope's path in the workspace (never by ids found inside files,
// which a shared file could forge), and are moved explicitly when an environment/collection is renamed.
import { randomUUID } from 'node:crypto'
import { lstatSync } from 'node:fs'
import { mkdir, readdir, readFile, rename, rm } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import { sanitizeName, uniqueName } from '../../shared/format/names'
import { stableStringify } from '../../shared/format/stableJson'
import type { EnvironmentInfo, PmVariable } from '../../shared/format/types'
import type { ScopeRef, VariableRow } from '../../shared/ipc'
import type { SecretStore } from '../secrets'
import { writeFileAtomic } from './fsAtomic'
import { WorkspaceError, resolveInside } from './store'

export type { ScopeRef, VariableRow }

const ENV_EXT = '.env.json'
const isEnoent = (e: unknown) => (e as NodeJS.ErrnoException).code === 'ENOENT'

async function readJsonFile<T>(file: string): Promise<T> {
  return JSON.parse((await readFile(file, 'utf8')).replace(/^\uFEFF/, '')) as T
}

/** `environments/<name>.env.json` → absolute path, refusing anything else (separators, `..`, symlinks). */
export function resolveEnvPath(root: string, id: string): string {
  const parts = id.split('/')
  const name = parts[1] ?? ''
  if (parts.length !== 2 || parts[0] !== 'environments' || !name.endsWith(ENV_EXT) || name.startsWith('.') || /[\\:]/.test(name))
    throw new WorkspaceError(`Not an environment: ${id}`)
  const dir = resolve(root, 'environments')
  const abs = resolve(dir, name)
  if (dirname(abs) !== dir) throw new WorkspaceError(`Not an environment: ${id}`)
  for (const p of [dir, abs]) {
    try {
      if (lstatSync(p).isSymbolicLink()) throw new WorkspaceError(`Symbolic links are not allowed in a workspace: ${id}`)
    } catch (e) {
      if (e instanceof WorkspaceError) throw e
    }
  }
  return abs
}

interface ScopeFile {
  file: string
  /** Variables array as stored in the file. */
  vars(doc: Record<string, any>): PmVariable[]
  setVars(doc: Record<string, any>, vars: PmVariable[]): void
  /** Collections use `disabled`, environments/globals use `enabled`. */
  flag: 'enabled' | 'disabled'
  empty(): Record<string, any>
}

function scopeFile(root: string, scope: ScopeRef): ScopeFile {
  if (scope === 'globals')
    return {
      file: join(root, 'globals.json'),
      vars: (d) => d.values ?? [],
      setVars: (d, v) => (d.values = v),
      flag: 'enabled',
      empty: () => ({ name: 'Globals', values: [], _postman_variable_scope: 'globals' }),
    }
  if (scope.startsWith('env:')) {
    const file = resolveEnvPath(root, scope.slice(4))
    return {
      file,
      vars: (d) => d.values ?? [],
      setVars: (d, v) => (d.values = v),
      flag: 'enabled',
      empty: () => ({ id: randomUUID(), name: basename(file, ENV_EXT), values: [], _postman_variable_scope: 'environment' }),
    }
  }
  if (scope.startsWith('col:')) {
    const dir = resolveInside(root, scope.slice(4))
    if (dirname(scope.slice(4)) !== 'collections') throw new WorkspaceError(`Not a collection: ${scope}`)
    return {
      file: join(dir, 'collection.json'),
      vars: (d) => d.variable ?? [],
      setVars: (d, v) => (d.variable = v),
      flag: 'disabled',
      empty: () => ({ info: { name: basename(dir) } }),
    }
  }
  throw new WorkspaceError(`Unknown variable scope: ${scope}`)
}

const isEnabled = (v: PmVariable, flag: 'enabled' | 'disabled') => (flag === 'enabled' ? v.enabled !== false : !v.disabled)

export class Variables {
  constructor(
    private root: string,
    private secrets: SecretStore,
  ) {}

  private currentFile = () => join(this.root, '.pmlocal', 'current-values.json')
  private secretPrefix = (scope: ScopeRef) => `${this.root}::${scope}::`
  private secretKey = (scope: ScopeRef, key: string, which: 'initial' | 'current') =>
    `${this.secretPrefix(scope)}${encodeURIComponent(key)}::${which}`

  private async readCurrent(): Promise<Record<string, Record<string, string>>> {
    try {
      return await readJsonFile(this.currentFile())
    } catch {
      return {}
    }
  }

  private async readDoc(sf: ScopeFile): Promise<Record<string, any>> {
    try {
      return await readJsonFile(sf.file)
    } catch (e) {
      if (isEnoent(e)) return sf.empty()
      throw new WorkspaceError(`${basename(sf.file)} is not valid JSON (${(e as Error).message}); fix it first`)
    }
  }

  async read(scope: ScopeRef): Promise<VariableRow[]> {
    const sf = scopeFile(this.root, scope)
    const doc = await this.readDoc(sf)
    const current = (await this.readCurrent())[scope] ?? {}
    return sf.vars(doc).map((v): VariableRow => {
      const secret = v.type === 'secret'
      const initial = secret ? (this.secrets.get(this.secretKey(scope, v.key, 'initial')) ?? '') : String(v.value ?? '')
      const cur = secret ? this.secrets.get(this.secretKey(scope, v.key, 'current')) : current[v.key]
      return { key: v.key, type: secret ? 'secret' : 'default', initial, current: cur ?? initial, enabled: isEnabled(v, sf.flag) }
    })
  }

  async write(scope: ScopeRef, rows: VariableRow[]): Promise<void> {
    const sf = scopeFile(this.root, scope)
    const doc = await this.readDoc(sf)
    const previous = sf.vars(doc)

    const seen = new Set<string>()
    const unique = rows.filter((r) => r.key && !seen.has(r.key) && seen.add(r.key))
    sf.setVars(
      doc,
      unique.map((r) => {
        const old = previous.find((p) => p.key === r.key)
        const base = { ...(old ?? {}), key: r.key, value: r.type === 'secret' ? '' : r.initial, type: r.type }
        if (sf.flag === 'enabled') return { ...base, enabled: r.enabled }
        const { disabled: _d, ...rest } = base as PmVariable
        return r.enabled ? rest : { ...rest, disabled: true }
      }),
    )
    await writeFileAtomic(sf.file, stableStringify(doc))

    const all = await this.readCurrent()
    all[scope] = Object.fromEntries(unique.filter((r) => r.type !== 'secret' && r.current !== r.initial).map((r) => [r.key, r.current]))
    if (Object.keys(all[scope]).length === 0) delete all[scope]
    await writeFileAtomic(this.currentFile(), stableStringify(all))

    const secretEntries: Record<string, string | undefined> = {}
    for (const p of previous) secretEntries[this.secretKey(scope, p.key, 'initial')] = secretEntries[this.secretKey(scope, p.key, 'current')] = undefined
    for (const r of unique.filter((r) => r.type === 'secret')) {
      secretEntries[this.secretKey(scope, r.key, 'initial')] = r.initial
      secretEntries[this.secretKey(scope, r.key, 'current')] = r.current
    }
    await this.secrets.setMany(secretEntries)
  }

  /** Values the runtime should use: enabled rows, current value. */
  async effective(scope: ScopeRef): Promise<PmVariable[]> {
    return (await this.read(scope)).filter((r) => r.enabled).map((r) => ({ key: r.key, value: r.current, ...(r.type === 'secret' ? { type: 'secret' } : {}) }))
  }

  /** Persist what scripts did: changed values become current values; new keys are added; unset keys removed. */
  async applyChanges(scope: ScopeRef, after: PmVariable[]): Promise<void> {
    const rows = await this.read(scope)
    const byKey = new Map(after.map((v) => [v.key, v.value]))
    let changed = false
    const next: VariableRow[] = []
    for (const r of rows) {
      if (!r.enabled) {
        next.push(r) // disabled rows were never given to the runtime
      } else if (!byKey.has(r.key)) {
        changed = true // pm.*.unset()
      } else {
        const v = byKey.get(r.key)!
        if (v !== r.current) changed = true
        next.push({ ...r, current: v })
      }
      byKey.delete(r.key)
    }
    for (const [key, value] of byKey) {
      changed = true
      next.push({ key, type: 'default', initial: '', current: value, enabled: true })
    }
    if (changed) await this.write(scope, next)
  }

  /** The scope's file was renamed/moved: carry its local current values and secrets along. */
  async move(from: ScopeRef, to: ScopeRef): Promise<void> {
    if (from === to) return
    const all = await this.readCurrent()
    if (all[from]) {
      all[to] = all[from]
      delete all[from]
      await writeFileAtomic(this.currentFile(), stableStringify(all))
    }
    await this.secrets.renamePrefix(this.secretPrefix(from), this.secretPrefix(to))
  }

  /** Forget local current values and secrets of a deleted scope. */
  async forget(scope: ScopeRef): Promise<void> {
    const all = await this.readCurrent()
    if (all[scope]) {
      delete all[scope]
      await writeFileAtomic(this.currentFile(), stableStringify(all))
    }
    await this.secrets.deletePrefix(this.secretPrefix(scope))
  }
}

// --- environments ---

export async function listEnvironments(root: string): Promise<EnvironmentInfo[]> {
  let names: string[]
  try {
    names = (await readdir(join(root, 'environments'))).filter((n) => n.endsWith(ENV_EXT) && !n.startsWith('.'))
  } catch {
    return []
  }
  const list = await Promise.all(
    names.map(async (n): Promise<EnvironmentInfo> => {
      const id = `environments/${n}`
      try {
        const doc = await readJsonFile<{ name?: string }>(resolveEnvPath(root, id))
        return { id, name: doc.name ?? basename(n, ENV_EXT) }
      } catch (e) {
        return { id, name: basename(n, ENV_EXT), error: (e as Error).message }
      }
    }),
  )
  return list.sort((a, b) => a.name.localeCompare(b.name))
}

async function envFileName(root: string, name: string, except?: string): Promise<string> {
  const taken = await readdir(join(root, 'environments')).catch(() => [] as string[])
  return uniqueName(sanitizeName(name), taken.filter((t) => t !== except), ENV_EXT)
}

export async function createEnvironment(root: string, name: string, values: PmVariable[] = []): Promise<string> {
  await mkdir(join(root, 'environments'), { recursive: true })
  const file = await envFileName(root, name)
  const doc = { id: randomUUID(), name, values, _postman_variable_scope: 'environment' }
  await writeFileAtomic(join(root, 'environments', file), stableStringify(doc))
  return `environments/${file}`
}

/** Renames the environment and its file, moving its local values along. */
export async function renameEnvironment(root: string, id: string, name: string, vars: Variables): Promise<string> {
  const path = resolveEnvPath(root, id)
  const doc = await readJsonFile<Record<string, unknown>>(path)
  doc.name = name
  await writeFileAtomic(path, stableStringify(doc))
  const file = await envFileName(root, name, basename(path))
  if (file === basename(path)) return id
  const newId = `environments/${file}`
  await rename(path, join(root, 'environments', file))
  await vars.move(`env:${id}`, `env:${newId}`)
  return newId
}

export async function deleteEnvironment(root: string, id: string, vars: Variables): Promise<void> {
  await rm(resolveEnvPath(root, id), { force: true })
  await vars.forget(`env:${id}`)
}
