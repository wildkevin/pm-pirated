import type { PmItem } from '../shared/format/types'
import type { EngineReply, EngineRequest, SendResult } from '../shared/engine'

export interface EngineProcess {
  postMessage(msg: EngineRequest): void
  onMessage(cb: (msg: EngineReply) => void): void
  onExit(cb: (code: number) => void): void
  kill(): void
}

/** Talks to the engine process; (re)starts it on demand and fails in-flight work if it dies. */
export class EngineClient {
  private proc?: EngineProcess
  private pending = new Map<string, (r: SendResult) => void>()

  constructor(
    private spawn: () => EngineProcess,
    private onCrash: (code: number) => void = () => undefined,
  ) {}

  send(id: string, item: PmItem, timeoutMs = 0): Promise<SendResult> {
    return new Promise((resolve) => {
      this.pending.set(id, resolve)
      this.ensure().postMessage({ type: 'send', id, item, timeoutMs })
    })
  }

  cancel(id: string): void {
    this.proc?.postMessage({ type: 'cancel', id })
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
      this.pending.get(m.id)?.(m.result)
      this.pending.delete(m.id)
    })
    p.onExit((code) => {
      if (this.proc !== p) return
      this.proc = undefined
      if (this.pending.size === 0) return
      for (const resolve of this.pending.values()) resolve({ ok: false, error: 'Engine process stopped unexpectedly' })
      this.pending.clear()
      this.onCrash(code)
    })
    this.proc = p
    return p
  }
}
