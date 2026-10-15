// Keeps the URL text, the Params table (query, including disabled rows) and path variables in sync,
// the way Postman's URL bar and Params tab do. The bar preserves raw text; table rows are decoded.
import type { PmKeyValue, PmUrl } from './types'

export function rawUrl(url: PmUrl | undefined): string {
  if (!url) return ''
  return typeof url === 'string' ? url : (url.raw ?? '')
}

function split(raw: string): { base: string; query: string | null; hash: string } {
  const hashAt = raw.indexOf('#')
  const hash = hashAt === -1 ? '' : raw.slice(hashAt)
  const rest = hashAt === -1 ? raw : raw.slice(0, hashAt)
  const q = rest.indexOf('?')
  return q === -1 ? { base: rest, query: null, hash } : { base: rest.slice(0, q), query: rest.slice(q + 1), hash }
}

export function parseQuery(raw: string): PmKeyValue[] {
  const { query } = split(raw)
  if (query === null || query === '') return []
  return query.split('&').map((pair) => {
    const eq = pair.indexOf('=')
    const decode = (s: string) => { try { return decodeURIComponent(s) } catch { return s } }
    return eq === -1 ? { key: decode(pair), value: '', hasEquals: false } : { key: decode(pair.slice(0, eq)), value: decode(pair.slice(eq + 1)), ...(eq === pair.length - 1 ? { hasEquals: true } : {}) }
  })
}

function formatQuery(params: PmKeyValue[]): string {
  const encode = (s: string) => encodeURIComponent(s).replace(/%7B%7B(.*?)%7D%7D/g, (_, key: string) => `{{${decodeURIComponent(key)}}}`)
  return params
    .filter((p) => !p.disabled)
    .map((p) => (p.value === '' && p.hasEquals === false ? encode(p.key) : `${encode(p.key)}=${encode(p.value)}`))
    .join('&')
}

/** Path variables are `:name` segments in the path (not the `:port` after the host). */
export function pathVariableNames(raw: string): string[] {
  const { base } = split(raw)
  const afterScheme = base.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '')
  const slash = afterScheme.indexOf('/')
  if (slash === -1) return []
  const names: string[] = []
  for (const m of afterScheme.slice(slash).matchAll(/\/:([^/?#:]+)/g)) if (!names.includes(m[1])) names.push(m[1])
  return names
}

function build(raw: string, query: PmKeyValue[], variable: PmKeyValue[], previous: PmUrl): PmUrl {
  const keepQuery = query.length > 0
  if (!keepQuery && variable.length === 0) return raw
  const { query: _q, variable: _v, raw: _r, ...rest } = typeof previous === 'string' ? { raw: '' } : previous
  return { ...rest, raw, ...(keepQuery ? { query } : {}), ...(variable.length ? { variable } : {}) }
}

export function queryParams(url: PmUrl): PmKeyValue[] {
  if (typeof url !== 'string' && Array.isArray(url.query)) return url.query
  return parseQuery(rawUrl(url))
}

export function pathVariables(url: PmUrl): PmKeyValue[] {
  const known = typeof url === 'string' ? [] : (url.variable ?? [])
  return pathVariableNames(rawUrl(url)).map((key) => known.find((v) => v.key === key) ?? { key, value: '' })
}

/** The user edited the URL text: re-derive enabled params, keep disabled ones and known path values. */
export function setRaw(url: PmUrl, raw: string): PmUrl {
  const query = parseQuery(raw)
  queryParams(url).forEach((p, i) => { if (p.disabled) query.splice(Math.min(i, query.length), 0, p) })
  const previous = typeof url === 'string' ? [] : (url.variable ?? [])
  const variable = pathVariableNames(raw).map((key) => previous.find((v) => v.key === key) ?? { key, value: '' })
  return build(raw, query, variable, url)
}

/** The user edited the Params table: rewrite the query part of the URL text. */
export function setQueryParams(url: PmUrl, params: PmKeyValue[]): PmUrl {
  const { base, hash } = split(rawUrl(url))
  const q = formatQuery(params)
  const raw = `${base}${q || params.some((p) => !p.disabled) ? `?${q}` : ''}${hash}`
  return build(raw, params, pathVariables(url), url)
}

export function setPathVariables(url: PmUrl, variable: PmKeyValue[]): PmUrl {
  return build(rawUrl(url), queryParams(url), variable, url)
}
