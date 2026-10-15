import type { EngineMethods, FromEngine, ProxyJson, RunnerItemResult, ToEngine } from '../shared/engine'

type MethodMap = Record<string, { params: unknown; result: unknown }>
type Call = { type: 'call'; id: string; method: string; params: unknown }
type Reply = { type: 'reply'; id: string; result?: unknown; error?: string }

export interface ChildProcess<To, From> {
  postMessage(msg: To): void
  onMessage(cb: (msg: From) => void): void
  onExit(cb: (code: number) => void): void
  kill(): void
}

interface Pending {
  resolve(v: unknown): void
  reject(e: Error): void
}

/** Request/response RPC to a child process; (re)starts it on demand and fails in-flight calls if it dies. */
export class RpcClient<M extends MethodMap, To extends { type: string }, From extends { type: string }> {
  protected proc?: ChildProcess<To | Call, From | Reply>
  private pending = new Map<string, Pending>()
  private seq = 0

  constructor(
    private spawn: () => ChildProcess<To | Call, From | Reply>,
    private onCrash: (code: number) => void = () => undefined,
  ) {}

  call<K extends keyof M & string>(method: K, params: M[K]['params']): Promise<M[K]['result']> {
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

  /** Messages other than replies (events, questions from the child). */
  protected handle(_msg: From, _proc: ChildProcess<To | Call, From | Reply>): void {}

  private ensure(): ChildProcess<To | Call, From | Reply> {
    if (this.proc) return this.proc
    const p = this.spawn()
    p.onMessage((m) => {
      if (m.type !== 'reply') return this.handle(m as From, p)
      const r = m as Reply
      const waiter = this.pending.get(r.id)
      this.pending.delete(r.id)
      if (r.error !== undefined) waiter?.reject(new Error(r.error))
      else waiter?.resolve(r.result)
    })
    p.onExit((code) => {
      if (this.proc !== p) return
      this.proc = undefined
      if (this.pending.size === 0) return
      for (const w of this.pending.values()) w.reject(new Error('Background process stopped unexpectedly'))
      this.pending.clear()
      this.onCrash(code)
    })
    this.proc = p
    return p
  }
}

export type EngineProcess = ChildProcess<ToEngine, FromEngine>

/** The request engine: answers its "which proxy for this URL?" questions and forwards run results. */
export class EngineClient extends RpcClient<EngineMethods, ToEngine, FromEngine> {
  /** Receives streamed collection-run results. */
  onRunItem: (runId: string, item: RunnerItemResult) => void = () => undefined

  constructor(
    spawn: () => EngineProcess,
    private resolveProxy: (url: string) => Promise<ProxyJson | null> = async () => null,
    onCrash?: (code: number) => void,
  ) {
    super(spawn as never, onCrash)
  }

  protected handle(m: FromEngine, p: ChildProcess<ToEngine | Call, FromEngine | Reply>): void {
    if (m.type === 'runItem') return this.onRunItem(m.runId, m.item)
    if (m.type === 'proxy')
      void this.resolveProxy(m.url)
        .catch(() => null)
        .then((proxy) => p.postMessage({ type: 'proxyReply', id: m.id, proxy }))
  }
}
