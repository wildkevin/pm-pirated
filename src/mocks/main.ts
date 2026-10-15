// Entry point of the mock-server utilityProcess: hosts every running mock of the workspace.
import type {} from 'electron'
import type { FromMocks, MockMethods, ToMocks } from '../shared/mock'
import { startMockServer, type RunningMock } from './server'

const running = new Map<string, RunningMock>()
const post = (m: FromMocks) => process.parentPort.postMessage(m)

type Handlers = { [M in keyof MockMethods]: (p: MockMethods[M]['params']) => Promise<MockMethods[M]['result']> | MockMethods[M]['result'] }

const handlers: Handlers = {
  async start({ id, host, port, delayMs, routes }) {
    await running.get(id)?.close()
    running.delete(id)
    const mock = await startMockServer({ host, port, delayMs }, routes, (entry) => post({ type: 'log', mockId: id, entry }))
    running.set(id, mock)
    return { url: mock.url }
  },
  async stop({ id }) {
    await running.get(id)?.close()
    running.delete(id)
  },
  setRoutes({ id, routes }) {
    running.get(id)?.setRoutes(routes)
  },
}

process.parentPort.on('message', ({ data }: { data: ToMocks }) => {
  const handler = handlers[data.method] as (p: unknown) => unknown
  Promise.resolve()
    .then(() => handler(data.params))
    .then(
      (result) => post({ type: 'reply', id: data.id, result }),
      (e: Error) => post({ type: 'reply', id: data.id, error: e?.message ?? String(e) }),
    )
})
