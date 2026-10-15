import type { EngineMethod, EngineMethods, FromEngine, ProxyJson, RunnerItemResult, ToEngine } from '../shared/engine'

export interface EngineProcess {
  postMessage(msg: ToEngine): void
  onMessage(cb: (msg: FromEngine) => void): void
  onExit(cb: (code: number) => void): void
  kill(): void
}

interface Pending {
  resolve(v: unknown): void
  reject(e: Error): void
}

/** RPC to the engine process; (re)starts it on demand and fails in-flight calls if it dies. */
export class EngineClient {
  private proc?: EngineProcess
  private pending = new Map<string, Pending>()
  private seq = 0

  constructor(
    private spawn: () => EngineProcess,
    private resolveProxy: (url: string) => Promise<ProxyJson | null> = async () => null,
    private onCrash: (code: number) => void = () => undefined,
  ) {}

  /** Receives streamed collection-run results. */
  onRunItem: (runId: string, item: RunnerItemResult) => void = () => undefined

  call<M extends EngineMethod>(method: M, params: EngineMethods[M]['params']): Promise<EngineMethods[M]['result']> {
    return new Promise((resolve, reject) => {
      const id = `c${++this.seq}`
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject })
      this.ensure().postMessage({ type: 'call', id, method, params })
    })
  }

  dispose(): void {
    const p = this.proc
    this.proc = undefined
    p?.kill()
  }

  private ensure(): EngineProcess {
    if (this.proc) return this.proc
    const p = this.spawn()
    p.onMessage((m) => {
      if (m.type === 'runItem') return this.onRunItem(m.runId, m.item)
      if (m.type === 'proxy') {
        void this.resolveProxy(m.url)
          .catch(() => null)
          .then((proxy) => p.postMessage({ type: 'proxyReply', id: m.id, proxy }))
        return
      }
      const waiter = this.pending.get(m.id)
      this.pending.delete(m.id)
      if (m.error !== undefined) waiter?.reject(new Error(m.error))
      else waiter?.resolve(m.result)
    })
    p.onExit((code) => {
      if (this.proc !== p) return
      this.proc = undefined
      if (this.pending.size === 0) return
      for (const w of this.pending.values()) w.reject(new Error('Engine process stopped unexpectedly'))
      this.pending.clear()
      this.onCrash(code)
    })
    this.proc = p
    return p
  }
}
