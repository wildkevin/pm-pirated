// Load tests in main: process client and saved results in .pmlocal/perf/<id>.json.
import { mkdir, readdir, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import type { FromLoad, LoadMethods, ProxyJson, ToLoad } from '../shared/engine'
import type { LoadInfo, LoadRecord } from '../shared/ipc'
import type { Tick } from '../loadtest/metrics'
import { RpcClient, type ChildProcess } from './engineClient'
import { writeFileAtomic } from './workspace/fsAtomic'
import { WorkspaceError } from './workspace/store'

export class LoadClient extends RpcClient<LoadMethods, ToLoad, FromLoad> {
  onTick: (runId: string, tick: Tick) => void = () => undefined
  constructor(
    spawn: () => ChildProcess<ToLoad, FromLoad>,
    private resolveProxy: (url: string) => Promise<ProxyJson | null>,
    onCrash?: (code: number) => void,
  ) {
    super(spawn as never, onCrash)
  }
  protected handle(m: FromLoad, p: ChildProcess<ToLoad | { type: 'call'; id: string; method: string; params: unknown }, unknown>): void {
    if (m.type === 'tick') return this.onTick(m.runId, m.tick)
    if (m.type === 'proxy')
      void this.resolveProxy(m.url)
        .catch(() => null)
        .then((proxy) => p.postMessage({ type: 'proxyReply', id: m.id, proxy }))
  }
}

const dir = (root: string) => join(root, '.pmlocal', 'perf')
function recordPath(root: string, id: string) {
  if (!/^[\w.-]+$/.test(id)) throw new WorkspaceError(`Invalid load test id: ${id}`)
  return join(dir(root), `${id}.json`)
}

export async function saveLoadRecord(root: string, r: LoadRecord): Promise<void> {
  await mkdir(dir(root), { recursive: true })
  await writeFileAtomic(recordPath(root, r.id), JSON.stringify(r))
}

export async function listLoadRecords(root: string): Promise<LoadInfo[]> {
  const files = (await readdir(dir(root)).catch(() => [] as string[])).filter((f) => f.endsWith('.json'))
  const infos = await Promise.all(
    files.map(async (f) => {
      try {
        const r = JSON.parse(await readFile(join(dir(root), f), 'utf8')) as LoadRecord
        return { id: r.id, name: r.name, startedAt: r.startedAt, profile: r.profile, summary: r.summary } satisfies LoadInfo
      } catch {
        return null
      }
    }),
  )
  return infos.filter((i): i is LoadInfo => !!i).sort((a, b) => b.startedAt - a.startedAt)
}

export async function readLoadRecord(root: string, id: string): Promise<LoadRecord> {
  return JSON.parse(await readFile(recordPath(root, id), 'utf8'))
}

export async function deleteLoadRecord(root: string, id: string): Promise<void> {
  await rm(recordPath(root, id), { force: true })
}
