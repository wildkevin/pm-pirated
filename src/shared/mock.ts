// Mock servers: definitions, routes built from saved examples, and Postman-like request matching.
import type { PmKeyValue } from './format/types'

/** <workspace>/mocks/<name>.mock.json */
export interface MockDefinition {
  name: string
  /** Collection or folder whose examples are served. */
  target: string
  port: number
  /** Opt-in: listen on all interfaces instead of 127.0.0.1. */
  allowLan: boolean
  delayMs: number
  autoStart: boolean
}

export interface MockRoute {
  /** Stable id: request id + example index. */
  id: string
  exampleName: string
  requestName: string
  method: string
  /** Path as written in the example (`/users/:id`, `{{base}}` stripped). */
  path: string
  query: PmKeyValue[]
  body?: string
  response: { code: number; status: string; headers: PmKeyValue[]; body: string }
}

export interface MockLogEntry {
  ts: number
  method: string
  path: string
  code: number
  matched?: string
  reason?: string
}

export interface MockStatus {
  id: string
  running: boolean
  url?: string
  error?: string
}

/** Path part of an example URL: drops scheme, host and a leading `{{base}}`-style variable. */
export function pathOf(raw: string): string {
  let rest = raw.trim().split('#')[0].split('?')[0]
  rest = rest.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '')
  if (!rest.startsWith('/')) {
    const slash = rest.indexOf('/')
    rest = slash === -1 ? '/' : rest.slice(slash)
  }
  return normalizePath(rest)
}

export function queryOf(raw: string): PmKeyValue[] {
  const q = raw.split('#')[0].split('?')[1]
  if (!q) return []
  return q
    .split('&')
    .filter(Boolean)
    .map((pair) => {
      const i = pair.indexOf('=')
      const dec = (s: string) => {
        try {
          return decodeURIComponent(s.replace(/\+/g, ' '))
        } catch {
          return s
        }
      }
      return i === -1 ? { key: dec(pair), value: '' } : { key: dec(pair.slice(0, i)), value: dec(pair.slice(i + 1)) }
    })
}

const normalizePath = (p: string) => (p.length > 1 ? p.replace(/\/+$/, '') : p) || '/'
const isWildcard = (seg: string) => seg.startsWith(':') || /^\{\{[^{}]+\}\}$/.test(seg)

/** 2 = exact, 1 = matches through wildcard segments, 0 = no match. */
export function pathScore(routePath: string, requestPath: string): number {
  const a = normalizePath(routePath).split('/')
  const b = normalizePath(requestPath).split('/')
  if (a.length !== b.length) return 0
  let exact = true
  for (let i = 0; i < a.length; i++) {
    let seg: string
    try {
      seg = decodeURIComponent(b[i])
    } catch {
      seg = b[i]
    }
    if (a[i] === seg) continue
    if (!isWildcard(a[i])) return 0
    exact = false
  }
  return exact ? 2 : 1
}

export interface IncomingRequest {
  method: string
  /** Path + query as received. */
  url: string
  headers: Record<string, string | undefined>
  body: string
}

export type MatchResult = { route: MockRoute; reason: string } | { route: null; reason: string }

/**
 * Postman's matching, simplified: method → path (exact beats wildcard) → query params (each match
 * +1, each mismatch −1) → optional body match. `x-mock-response-name` / `x-mock-response-code`
 * narrow the candidates; the first defined example wins ties.
 */
export function matchRoute(routes: MockRoute[], req: IncomingRequest): MatchResult {
  const path = pathOf(req.url)
  const query = queryOf(req.url)
  let candidates = routes
    .filter((r) => r.method.toUpperCase() === req.method.toUpperCase())
    .map((r) => ({ r, p: pathScore(r.path, path) }))
    .filter((c) => c.p > 0)
  if (!candidates.length) return { route: null, reason: `No example for ${req.method} ${path}` }

  const name = req.headers['x-mock-response-name']
  const code = req.headers['x-mock-response-code']
  if (name) candidates = candidates.filter((c) => c.r.exampleName === name)
  if (code) candidates = candidates.filter((c) => String(c.r.response.code) === code)
  if (!candidates.length) return { route: null, reason: `No example matches ${name ? `name "${name}"` : `code ${code}`}` }

  if (req.headers['x-mock-match-request-body'] === 'true') {
    const same = (a: string, b: string) => {
      try {
        return JSON.stringify(JSON.parse(a)) === JSON.stringify(JSON.parse(b))
      } catch {
        return a.trim() === b.trim()
      }
    }
    candidates = candidates.filter((c) => same(c.r.body ?? '', req.body))
    if (!candidates.length) return { route: null, reason: 'No example has the same request body' }
  }

  const scored = candidates.map(({ r, p }, order) => {
    let score = p * 100
    for (const q of r.query) {
      const got = query.find((x) => x.key === q.key)
      score += got && (got.value === q.value || /^\{\{.+\}\}$/.test(q.value)) ? 1 : -1
    }
    return { r, score, order }
  })
  scored.sort((a, b) => b.score - a.score || a.order - b.order)
  const best = scored[0].r
  return { route: best, reason: `Matched "${best.exampleName}" of ${best.requestName}` }
}
