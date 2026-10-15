import { describe, expect, it, vi } from 'vitest'
import { EngineClient, type EngineProcess } from '../../src/main/engineClient'
import type { EngineReply, EngineRequest } from '../../src/shared/engine'

class FakeProcess implements EngineProcess {
  sent: EngineRequest[] = []
  private msg?: (m: EngineReply) => void
  private exit?: (code: number) => void
  postMessage(m: EngineRequest) {
    this.sent.push(m)
  }
  onMessage(cb: (m: EngineReply) => void) {
    this.msg = cb
  }
  onExit(cb: (code: number) => void) {
    this.exit = cb
  }
  kill = vi.fn()
  reply(m: EngineReply) {
    this.msg!(m)
  }
  die(code: number) {
    this.exit!(code)
  }
}

const item = { name: 'x', request: { method: 'GET', url: 'http://a', header: [] } }
const ok = (code: number) => ({ ok: true as const, code, status: '', headers: [], body: new Uint8Array(), size: 0, timeMs: 0 })

describe('EngineClient', () => {
  it('routes replies to the matching send', async () => {
    const proc = new FakeProcess()
    const client = new EngineClient(() => proc)
    const a = client.send('a', item)
    const b = client.send('b', item)
    proc.reply({ id: 'b', result: ok(201) })
    proc.reply({ id: 'a', result: ok(200) })
    expect(await a).toMatchObject({ code: 200 })
    expect(await b).toMatchObject({ code: 201 })
    expect(proc.sent.map((m) => m.type)).toEqual(['send', 'send'])
  })

  it('fails in-flight sends when the engine dies, then restarts it', async () => {
    const procs: FakeProcess[] = []
    const onCrash = vi.fn()
    const client = new EngineClient(() => {
      procs.push(new FakeProcess())
      return procs.at(-1)!
    }, onCrash)
    const a = client.send('a', item)
    procs[0].die(9)
    expect(await a).toEqual({ ok: false, error: 'Engine process stopped unexpectedly' })
    expect(onCrash).toHaveBeenCalledWith(9)

    const b = client.send('b', item)
    expect(procs).toHaveLength(2)
    procs[1].reply({ id: 'b', result: ok(200) })
    expect(await b).toMatchObject({ code: 200 })
  })

  it('forwards cancel and does not report a crash after dispose', () => {
    const proc = new FakeProcess()
    const onCrash = vi.fn()
    const client = new EngineClient(() => proc, onCrash)
    void client.send('a', item)
    client.cancel('a')
    expect(proc.sent.at(-1)).toEqual({ type: 'cancel', id: 'a' })
    client.dispose()
    proc.die(0)
    expect(proc.kill).toHaveBeenCalled()
    expect(onCrash).not.toHaveBeenCalled()
  })
})
