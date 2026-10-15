// Entry point of the load-test utilityProcess (kept apart so a heavy test cannot slow the app).
import type {} from 'electron'
import type { FromLoad, LoadMethods, ProxyJson, ToLoad } from '../shared/engine'
import { startLoadTest, type LoadHandle } from './runner'

const runs = new Map<string, LoadHandle>()
const proxyWaiters = new Map<string, (p: ProxyJson | null) => void>()
let seq = 0
const post = (m: FromLoad) => process.parentPort.postMessage(m)

function resolveSystemProxy(url: string): Promise<ProxyJson | null> {
  const id = `p${++seq}`
  return new Promise((resolve) => {
    proxyWaiters.set(id, resolve)
    post({ type: 'proxy', id, url })
  })
}

type Handlers = { [M in keyof LoadMethods]: (p: LoadMethods[M]['params']) => Promise<LoadMethods[M]['result']> | LoadMethods[M]['result'] }
const handlers: Handlers = {
  async start({ runId, spec }) {
    const handle = startLoadTest(spec, (tick) => post({ type: 'tick', runId, tick }), { resolveSystemProxy })
    runs.set(runId, handle)
    try {
      return await handle.result
    } finally {
      runs.delete(runId)
    }
  },
  stop({ runId }) {
    runs.get(runId)?.stop()
  },
}

process.parentPort.on('message', ({ data }: { data: ToLoad }) => {
  if (data.type === 'proxyReply') {
    proxyWaiters.get(data.id)?.(data.proxy)
    proxyWaiters.delete(data.id)
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
