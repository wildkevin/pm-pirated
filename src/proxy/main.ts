// Entry point of the capture-proxy utilityProcess.
import type {} from 'electron'
import type { FromProxy, ProxyMethods, ToProxy, UpstreamProxy } from '../shared/engine'
import { startCaptureProxy, type RunningProxy } from './server'

let running: RunningProxy | undefined
const waiters = new Map<string, (u: UpstreamProxy | null) => void>()
let seq = 0
const post = (m: FromProxy) => process.parentPort.postMessage(m)

/** Main decides the upstream (corporate proxy, PAC, custom proxy) per URL. */
function resolveUpstream(url: string): Promise<UpstreamProxy | null> {
  const id = `u${++seq}`
  return new Promise((resolve) => {
    waiters.set(id, resolve)
    post({ type: 'upstream', id, url })
  })
}

type Handlers = { [M in keyof ProxyMethods]: (p: ProxyMethods[M]['params']) => Promise<ProxyMethods[M]['result']> | ProxyMethods[M]['result'] }
const handlers: Handlers = {
  async start({ port, decrypt, ca, filter, extraCa }) {
    await running?.close()
    running = await startCaptureProxy({ port, decrypt, ca, filter, extraCa }, { resolveUpstream, onCapture: (exchange) => post({ type: 'capture', exchange }) })
    return { port: running.port }
  },
  async stop() {
    await running?.close()
    running = undefined
  },
  setFilter({ filter }) {
    running?.setFilter(filter)
  },
}

process.parentPort.on('message', ({ data }: { data: ToProxy }) => {
  if (data.type === 'upstreamReply') {
    waiters.get(data.id)?.(data.upstream)
    waiters.delete(data.id)
    return
  }
  const handler = handlers[data.method] as (p: unknown) => unknown
  Promise.resolve()
    .then(() => handler(data.params))
    .then(
      (result) => post({ type: 'reply', id: data.id, result }),
      (e: Error) => post({ type: 'reply', id: data.id, error: e?.message ?? String(e) }),
    )
})
