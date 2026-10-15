// Code snippets (cURL, PowerShell, Python, …) via postman-code-generators, as in Postman's </> panel.
import codegen from 'postman-code-generators'
import { Request, Url } from 'postman-collection'
import { promisify } from 'node:util'
import type { PmAuth, PmItem, PmVariable } from '../shared/format/types'
import { rawUrl } from '../shared/format/url'
import type { CodeLanguage } from '../shared/ipc'

// Postman CLI needs a Postman account; not offered.
const HIDDEN = new Set(['postman-cli'])

export function codeLanguages(): CodeLanguage[] {
  return codegen
    .getLanguageList()
    .filter((l) => !HIDDEN.has(l.key))
    .map((l) => ({ key: l.key, label: l.label, variants: l.variants.map((v) => v.key), syntax: l.syntax_mode }))
}

/** Replaces {{var}} with known values (unknown ones stay as typed, like Postman). */
export function substitute(text: string, vars: Map<string, string>): string {
  return text.replace(/\{\{([^{}]+)\}\}/g, (m, name: string) => vars.get(name.trim()) ?? m)
}

function attr(auth: PmAuth, key: string): string {
  const list = auth[auth.type]
  const v = Array.isArray(list) ? list.find((a) => a.key === key)?.value : undefined
  return v == null ? '' : String(v)
}

/**
 * Adds the headers/params the common auth types produce. Signature-based types (OAuth 1, AWS,
 * Hawk, Digest, NTLM, EdgeGrid, JWT, ASAP) are computed at send time and are not shown.
 */
export function applyAuth(item: PmItem, auth: PmAuth | undefined): PmItem {
  if (!auth) return item
  const header = [...item.request.header]
  let url = rawUrl(item.request.url)
  const setHeader = (key: string, value: string) => header.push({ key, value })
  switch (auth.type) {
    case 'basic':
      setHeader('Authorization', `Basic ${Buffer.from(`${attr(auth, 'username')}:${attr(auth, 'password')}`).toString('base64')}`)
      break
    case 'bearer':
      setHeader('Authorization', `Bearer ${attr(auth, 'token')}`)
      break
    case 'oauth2':
      if (attr(auth, 'addTokenTo') === 'queryParams') url += `${url.includes('?') ? '&' : '?'}access_token=${attr(auth, 'accessToken')}`
      else setHeader('Authorization', `${attr(auth, 'headerPrefix') || 'Bearer'} ${attr(auth, 'accessToken')}`)
      break
    case 'apikey':
      if (attr(auth, 'in') === 'query') url += `${url.includes('?') ? '&' : '?'}${attr(auth, 'key')}=${attr(auth, 'value')}`
      else setHeader(attr(auth, 'key'), attr(auth, 'value'))
      break
  }
  return { ...item, request: { ...item.request, header, url: typeof item.request.url === 'string' ? url : { ...item.request.url, raw: url } } }
}

/** substitute() inside a JSON document: values are JSON-escaped so quotes/backslashes stay valid. */
function substituteJson<T>(value: T, vars: Map<string, string>): T {
  const escaped = new Map([...vars].map(([k, v]) => [k, JSON.stringify(v).slice(1, -1)]))
  return JSON.parse(substitute(JSON.stringify(value), escaped)) as T
}

const RAW_CONTENT_TYPE: Record<string, string> = {
  json: 'application/json',
  xml: 'application/xml',
  html: 'text/html',
  javascript: 'application/javascript',
  text: 'text/plain',
}

export async function generateCode(
  item: PmItem,
  inheritedAuth: PmAuth | undefined,
  variables: PmVariable[],
  language: string,
  variant: string,
): Promise<string> {
  const vars = new Map(variables.map((v) => [v.key, v.value]))
  const resolved = substituteJson(item, vars)
  const auth = resolved.request.auth ?? (inheritedAuth && substituteJson(inheritedAuth, vars))
  const withAuth = applyAuth(resolved, auth)
  const req = withAuth.request
  if (item.protocolProfileBehavior?.disableBodyPruning === false && /^(GET|HEAD)$/i.test(req.method)) req.body = undefined
  const raw = rawUrl(req.url)
  // The app sends raw bodies with a Content-Type for their language (postman-runtime adds it);
  // snippets must too, or e.g. curl --data posts JSON as form data.
  const rawLang = req.body?.mode === 'raw' && !(req.body as { disabled?: boolean }).disabled ? (req.body.options?.raw?.language ?? 'text') : null
  const implied = rawLang ? RAW_CONTENT_TYPE[rawLang] : undefined
  if (implied && !req.header.some((h) => !h.disabled && h.key.toLowerCase() === 'content-type')) req.header = [...req.header, { key: 'Content-Type', value: implied }]
  const request = new Request({
    ...req,
    url: typeof req.url === 'string' ? raw : { ...Url.parse(raw), ...(req.url.variable ? { variable: req.url.variable } : {}), query: Url.parse(raw).query },
    header: req.header.filter((h) => !h.disabled && h.key),
    ...(req.body && !(req.body as { disabled?: boolean }).disabled ? { body: req.body } : { body: undefined }),
  })
  const convert = promisify((cb: (e: Error | null, s: string) => void) => codegen.convert(language, variant, request, { trimRequestBody: true, followRedirect: true }, cb))
  return convert()
}
