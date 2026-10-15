// Entry point of the engine utilityProcess: sends requests on behalf of the main process.
import type {} from 'electron'
import type { EngineReply, EngineRequest } from '../shared/engine'
import { clearProxyEnv, startSend, type SendHandle } from './send'

clearProxyEnv()
const inflight = new Map<string, SendHandle>()

process.parentPort.on('message', ({ data }: { data: EngineRequest }) => {
  if (data.type === 'cancel') {
    inflight.get(data.id)?.cancel()
    return
  }
  const handle = startSend(data.item, { timeoutMs: data.timeoutMs })
  inflight.set(data.id, handle)
  void handle.result.then((result) => {
    inflight.delete(data.id)
    process.parentPort.postMessage({ id: data.id, result } satisfies EngineReply)
  })
})
