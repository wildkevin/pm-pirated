import { describe, expect, it, vi } from 'vitest'
import { EngineClient, type EngineProcess } from '../../src/main/engineClient'
import type { FromEngine, ToEngine } from '../../src/shared/engine'

class FakeProcess implements EngineProcess {
  sent: ToEngine[] = []
  private msg?: (m: FromEngine) => void
  private exit?: (code: number) => void
  postMessage(m: ToEngine) {
    this.sent.push(m)
  }
  onMessage(cb: (m: FromEngine) => void) {
    this.msg = cb
  }
  onExit(cb: (code: number) => void) {
    this.exit = cb
  }
  kill = vi.fn()
  emit(m: FromEngine) {
    this.msg!(m)
  }
  die(code: number) {
    this.exit!(code)
  }
  lastCallId() {
    const calls = this.sent.filter((m) => m.type === 'call')
    return calls.at(-1)!.id
  }
}

describe('EngineClient', () => {
  it('routes replies and errors to the matching call', async () => {
    const proc = new FakeProcess()
    const client = new EngineClient(() => proc)
    const a = client.call('cookies.list', { cookieFile: 'a' })
    const idA = proc.lastCallId()
    const b = client.call('cancel', { sendId: 'x' })
    const idB = proc.lastCallId()
    proc.emit({ type: 'reply', id: idB, error: 'nope' })
    proc.emit({ type: 'reply', id: idA, result: [{ key: 'k' }] })
    expect(await a).toEqual([{ key: 'k' }])
    await expect(b).rejects.toThrow('nope')
  })

  it('answers proxy questions from the engine', async () => {
    const proc = new FakeProcess()
    const resolveProxy = vi.fn(async () => ({ host: 'proxy.corp', port: 8080, tunnel: false }))
    new EngineClient(() => proc, resolveProxy).call('cancel', { sendId: 'x' })
    proc.emit({ type: 'proxy', id: 'p1', url: 'https://api.test/x' })
    await vi.waitFor(() => expect(proc.sent.at(-1)).toEqual({ type: 'proxyReply', id: 'p1', proxy: { host: 'proxy.corp', port: 8080, tunnel: false } }))
    expect(resolveProxy).toHaveBeenCalledWith('https://api.test/x')
  })

  it('fails in-flight calls when the engine dies, then restarts it', async () => {
    const procs: FakeProcess[] = []
    const onCrash = vi.fn()
    const client = new EngineClient(
      () => {
        procs.push(new FakeProcess())
        return procs.at(-1)!
      },
      undefined,
      onCrash,
    )
    const a = client.call('cancel', { sendId: 'x' })
    procs[0].die(9)
    await expect(a).rejects.toThrow('Background process stopped unexpectedly')
    expect(onCrash).toHaveBeenCalledWith(9)
    const b = client.call('cookies.list', { cookieFile: 'f' })
    expect(procs).toHaveLength(2)
    procs[1].emit({ type: 'reply', id: procs[1].lastCallId(), result: [] })
    expect(await b).toEqual([])
  })

  it('does not report a crash after dispose', () => {
    const proc = new FakeProcess()
    const onCrash = vi.fn()
    const client = new EngineClient(() => proc, undefined, onCrash)
    void client.call('cancel', { sendId: 'x' }).catch(() => undefined)
    client.dispose()
    proc.die(0)
    expect(proc.kill).toHaveBeenCalled()
    expect(onCrash).not.toHaveBeenCalled()
  })
})
