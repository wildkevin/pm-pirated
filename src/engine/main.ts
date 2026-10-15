// Entry point of the engine utilityProcess: sends requests and owns the cookie jars.
import type {} from 'electron'
import type { EngineMethods, FromEngine, ProxyJson, ToEngine } from '../shared/engine'
import { deleteCookies, listCookies, setCookie } from './cookies'
import { startRunner, type RunnerHandle } from './runner'
import { startSend, type SendHandle } from './send'

const inflight = new Map<string, SendHandle>()
const runs = new Map<string, RunnerHandle>()
const proxyWaiters = new Map<string, (p: ProxyJson | null) => void>()
let proxySeq = 0

const post = (m: FromEngine) => process.parentPort.postMessage(m)

/** Ask the main process (Electron's session) which proxy the OS uses for this URL. */
function resolveSystemProxy(url: string): Promise<ProxyJson | null> {
  const id = `p${++proxySeq}`
  return new Promise((resolve) => {
    proxyWaiters.set(id, resolve)
    post({ type: 'proxy', id, url })
  })
}

type Handlers = { [M in keyof EngineMethods]: (p: EngineMethods[M]['params']) => Promise<EngineMethods[M]['result']> | EngineMethods[M]['result'] }

const handlers: Handlers = {
  async send({ sendId, spec }) {
    const handle = startSend(spec, { resolveSystemProxy })
    inflight.set(sendId, handle)
    try {
      return await handle.result
    } finally {
      inflight.delete(sendId)
    }
  },
  cancel({ sendId }) {
    inflight.get(sendId)?.cancel()
  },
  'cookies.list': ({ cookieFile }) => listCookies(cookieFile),
  'cookies.delete': ({ cookieFile, domain, path, key }) => deleteCookies(cookieFile, domain, path, key),
  'cookies.set': ({ cookieFile, url, cookie }) => setCookie(cookieFile, url, cookie),
  async run({ runId, spec }) {
    const handle = startRunner(spec, (item) => post({ type: 'runItem', runId, item }), { resolveSystemProxy })
    runs.set(runId, handle)
    try {
      return await handle.result
    } finally {
      runs.delete(runId)
    }
  },
  runStop({ runId }) {
    runs.get(runId)?.stop()
  },
}

process.parentPort.on('message', ({ data }: { data: ToEngine }) => {
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
