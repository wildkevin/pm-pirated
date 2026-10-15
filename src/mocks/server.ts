// One mock HTTP server: serves saved examples using Postman-like matching.
import { VariableScope } from 'postman-collection'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { matchRoute, type MockLogEntry, type MockRoute } from '../shared/mock'

const MAX_BODY = 10 * 1024 * 1024
// Headers that describe the original transfer, not the body we send.
const SKIP_HEADERS = /^(content-length|transfer-encoding|content-encoding|connection|keep-alive)$/i

export interface RunningMock {
  url: string
  setRoutes(routes: MockRoute[]): void
  close(): Promise<void>
}

const NOT_FOUND = (message: string) =>
  JSON.stringify({ error: { name: 'mockRequestNotFoundError', message: 'Double check your method and the request path and try again.', header: 'No matching requests', details: message } })

const LOCAL_HOSTS = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i

export function startMockServer(
  config: { host: string; port: number; delayMs: number; cors?: boolean },
  initialRoutes: MockRoute[],
  onLog: (entry: MockLogEntry) => void,
): Promise<RunningMock> {
  let routes = initialRoutes
  const dynamic = new VariableScope({ values: [] })

  const server = http.createServer((req, res) => {
    // Localhost-only mocks refuse other Host names (DNS rebinding from a web page).
    if (config.host === '127.0.0.1' && !LOCAL_HOSTS.test(req.headers.host ?? '')) {
      res.writeHead(403, { 'Content-Type': 'text/plain' })
      return void res.end('Forbidden host')
    }
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (d: Buffer) => {
      size += d.length
      if (size > MAX_BODY) req.destroy()
      else chunks.push(d)
    })
    req.on('end', () => {
      const url = req.url ?? '/'
      const result = matchRoute(routes, {
        method: req.method ?? 'GET',
        url,
        headers: req.headers as Record<string, string | undefined>,
        body: Buffer.concat(chunks).toString('utf8'),
      })
      const log = (code: number) => onLog({ ts: Date.now(), method: req.method ?? 'GET', path: url, code, matched: result.route?.exampleName, reason: result.reason })
      if (config.cors) {
        res.setHeader('Access-Control-Allow-Origin', '*')
        if (req.method === 'OPTIONS' && req.headers['access-control-request-method']) {
          res.writeHead(204, {
            'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS',
            'Access-Control-Allow-Headers': String(req.headers['access-control-request-headers'] ?? '*'),
          })
          return void res.end()
        }
      }
      if (!result.route) {
        res.writeHead(404, { 'Content-Type': 'application/json' })
        res.end(NOT_FOUND(result.reason))
        return log(404)
      }
      const r = result.route.response
      const send = () => {
        for (const h of r.headers) if (h.key && !SKIP_HEADERS.test(h.key)) res.setHeader(h.key, dynamic.replaceIn(h.value))
        res.statusCode = r.code
        res.statusMessage = r.status || http.STATUS_CODES[r.code] || ''
        res.end(dynamic.replaceIn(r.body))
        log(r.code)
      }
      if (config.delayMs > 0) setTimeout(send, config.delayMs)
      else send()
    })
  })

  return new Promise((resolve, reject) => {
    server.once('error', (e: NodeJS.ErrnoException) =>
      reject(new Error(e.code === 'EADDRINUSE' ? `Port ${config.port} is already in use` : e.code === 'EACCES' ? `Not allowed to listen on port ${config.port}` : e.message)),
    )
    server.listen(config.port, config.host, () => {
      const { port } = server.address() as AddressInfo
      resolve({
        url: `http://${config.host === '0.0.0.0' ? 'localhost' : config.host}:${port}`,
        setRoutes: (next) => (routes = next),
        close: () => new Promise((r) => (server.closeAllConnections(), server.close(() => r()))),
      })
    })
  })
}
