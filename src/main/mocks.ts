// Mock servers: definitions in <workspace>/mocks, routes from saved examples, lifecycle.
import { mkdir, readdir, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { sanitizeName, uniqueName } from '../shared/format/names'
import { stableStringify } from '../shared/format/stableJson'
import type { PmItem } from '../shared/format/types'
import { rawUrl } from '../shared/format/url'
import { pathOf, queryOf, type FromMocks, type MockDefinition, type MockEvent, type MockInfo, type MockMethods, type MockRoute, type MockStatus, type ToMocks } from '../shared/mock'
import { RpcClient, type ChildProcess } from './engineClient'
import { writeFileAtomic } from './workspace/fsAtomic'
import { WorkspaceError, collectionOf } from './workspace/store'
import { exportCollection } from './workspace/transfer'

const EXT = '.mock.json'
type Json = Record<string, any>

export class MockClient extends RpcClient<MockMethods, ToMocks, FromMocks> {
  onLog: (mockId: string, entry: Extract<FromMocks, { type: 'log' }>['entry']) => void = () => undefined
  constructor(spawn: () => ChildProcess<ToMocks, FromMocks>, onCrash?: (code: number) => void) {
    super(spawn as never, onCrash)
  }
  protected handle(m: FromMocks): void {
    if (m.type === 'log') this.onLog(m.mockId, m.entry)
  }
}

function mockPath(root: string, id: string): string {
  const parts = id.split('/')
  if (parts.length !== 2 || parts[0] !== 'mocks' || !parts[1].endsWith(EXT) || parts[1].startsWith('.') || /[\\:]/.test(parts[1]))
    throw new WorkspaceError(`Not a mock: ${id}`)
  return join(root, 'mocks', parts[1])
}

export function validateDefinition(def: MockDefinition): MockDefinition {
  if (!def.name.trim()) throw new WorkspaceError('Give the mock server a name')
  if (!/^collections\/[^/]+/.test(def.target)) throw new WorkspaceError('Choose a collection or folder')
  if (!Number.isInteger(def.port) || def.port < 1 || def.port > 65535) throw new WorkspaceError('Port must be between 1 and 65535')
  return { ...def, delayMs: Math.max(0, Math.floor(def.delayMs)) }
}

export async function readDefinitions(root: string): Promise<{ id: string; def: MockDefinition }[]> {
  const files = (await readdir(join(root, 'mocks')).catch(() => [] as string[])).filter((f) => f.endsWith(EXT) && !f.startsWith('.'))
  const out = await Promise.all(
    files.map(async (f) => {
      try {
        return { id: `mocks/${f}`, def: JSON.parse(await readFile(join(root, 'mocks', f), 'utf8')) as MockDefinition }
      } catch {
        return null
      }
    }),
  )
  return out.filter((x): x is { id: string; def: MockDefinition } => !!x).sort((a, b) => a.def.name.localeCompare(b.def.name))
}

export async function createDefinition(root: string, def: MockDefinition): Promise<string> {
  const valid = validateDefinition(def)
  await mkdir(join(root, 'mocks'), { recursive: true })
  const file = uniqueName(sanitizeName(valid.name), await readdir(join(root, 'mocks')), EXT)
  await writeFileAtomic(join(root, 'mocks', file), stableStringify(valid))
  return `mocks/${file}`
}

export async function saveDefinition(root: string, id: string, def: MockDefinition): Promise<void> {
  await writeFileAtomic(mockPath(root, id), stableStringify(validateDefinition(def)))
}

export async function deleteDefinition(root: string, id: string): Promise<void> {
  await rm(mockPath(root, id), { force: true })
}

/** One route per saved example under `target` (collection or folder). */
export async function buildRoutes(root: string, target: string): Promise<MockRoute[]> {
  const doc = await exportCollection(root, collectionOf(target), true)
  const routes: MockRoute[] = []
  const walk = (items: Json[], inside: boolean) => {
    for (const it of items) {
      const here = inside || it.id === target
      if (Array.isArray(it.item)) {
        walk(it.item, here)
        continue
      }
      if (!here) continue
      const item = it as PmItem & { id: string }
      ;((item.response ?? []) as Json[]).forEach((ex, i) => {
        const req = (ex.originalRequest ?? item.request) as Json
        const raw = typeof req.url === 'string' ? req.url : rawUrl(req.url ?? item.request.url)
        routes.push({
          id: `${item.id}#${i}`,
          exampleName: String(ex.name ?? `Example ${i + 1}`),
          requestName: item.name,
          method: String(req.method ?? item.request.method ?? 'GET').toUpperCase(),
          path: pathOf(raw),
          query: queryOf(raw),
          ...(req.body?.mode === 'raw' ? { body: String(req.body.raw ?? '') } : {}),
          response: {
            code: Number(ex.code ?? 200),
            status: String(ex.status ?? ''),
            headers: Array.isArray(ex.header) ? ex.header.filter((h: Json) => h && !h.disabled).map((h: Json) => ({ key: String(h.key), value: String(h.value ?? '') })) : [],
            body: typeof ex.body === 'string' ? ex.body : ex.body == null ? '' : JSON.stringify(ex.body),
          },
        })
      })
    }
  }
  walk(doc.item, collectionOf(target) === target)
  return routes
}

/** Running mocks of the open workspace. */
export class MockManager {
  private status = new Map<string, MockStatus>()
  private targets = new Map<string, string>()

  constructor(
    private client: MockClient,
    private emit: (e: MockEvent) => void,
  ) {
    client.onLog = (id, log) => emit({ id, log })
  }

  private set(s: MockStatus) {
    this.status.set(s.id, s)
    this.emit({ id: s.id, status: s })
    return s
  }

  async list(root: string): Promise<MockInfo[]> {
    return (await readDefinitions(root)).map(({ id, def }) => ({ id, def, status: this.status.get(id) ?? { id, running: false } }))
  }

  async start(root: string, id: string): Promise<MockStatus> {
    const def = validateDefinition(JSON.parse(await readFile(mockPath(root, id), 'utf8')))
    try {
      const { url } = await this.client.call('start', {
        id,
        host: def.allowLan ? '0.0.0.0' : '127.0.0.1',
        port: def.port,
        delayMs: def.delayMs,
        cors: !!def.cors,
        routes: await buildRoutes(root, def.target),
      })
      this.targets.set(id, def.target)
      return this.set({ id, running: true, url })
    } catch (e) {
      return this.set({ id, running: false, error: (e as Error).message })
    }
  }

  async stop(id: string): Promise<MockStatus> {
    await this.client.call('stop', { id }).catch(() => undefined)
    this.targets.delete(id)
    return this.set({ id, running: false })
  }

  async stopAll(): Promise<void> {
    await Promise.all([...this.targets.keys()].map((id) => this.stop(id)))
  }

  async autoStart(root: string): Promise<void> {
    for (const { id, def } of await readDefinitions(root)) if (def.autoStart) await this.start(root, id)
  }

  /** Examples changed somewhere in this collection: reload routes of mocks serving it. */
  async refresh(root: string, collectionId: string): Promise<void> {
    for (const [id, target] of this.targets) {
      if (collectionOf(target) !== collectionId) continue
      await this.client.call('setRoutes', { id, routes: await buildRoutes(root, target).catch(() => []) }).catch(() => undefined)
    }
  }

  isRunning(id: string): boolean {
    return this.targets.has(id)
  }
}

