// OAuth 2.0 "Get New Access Token". Pure helpers are separate from the Electron window/fetch glue.
import { createHash, randomBytes } from 'node:crypto'
import type { OAuth2Config, OAuth2Token } from '../shared/ipc'

const base64url = (b: Buffer) => b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

export function pkcePair(method: 'S256' | 'plain' = 'S256'): { verifier: string; challenge: string } {
  const verifier = base64url(randomBytes(32))
  const challenge = method === 'S256' ? base64url(createHash('sha256').update(verifier).digest()) : verifier
  return { verifier, challenge }
}

/** Only web URLs: net.fetch/loadURL would otherwise also read file:// and custom schemes. */
function webUrl(value: string | undefined, label: string): URL {
  if (!value) throw new Error(`${label} is required`)
  let u: URL
  try {
    u = new URL(value)
  } catch {
    throw new Error(`${label} is not a valid URL`)
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error(`${label} must be an http(s) URL`)
  return u
}

export function buildAuthUrl(cfg: OAuth2Config, challenge?: string): string {
  const u = webUrl(cfg.authUrl, 'Auth URL')
  u.searchParams.set('response_type', cfg.grant_type === 'implicit' ? 'token' : 'code')
  u.searchParams.set('client_id', cfg.clientId ?? '')
  if (cfg.redirect_uri) u.searchParams.set('redirect_uri', cfg.redirect_uri)
  if (cfg.scope) u.searchParams.set('scope', cfg.scope)
  if (cfg.state) u.searchParams.set('state', cfg.state)
  if (challenge) {
    u.searchParams.set('code_challenge', challenge)
    u.searchParams.set('code_challenge_method', cfg.challengeAlgorithm === 'plain' ? 'plain' : 'S256')
  }
  return u.toString()
}

/** If `url` is the callback, returns the parameters from its query and fragment; otherwise null. */
export function parseCallback(url: string, redirectUri: string): Record<string, string> | null {
  const strip = (s: string) => s.split(/[?#]/)[0].replace(/\/$/, '')
  if (!redirectUri || strip(url) !== strip(redirectUri)) return null
  const u = new URL(url)
  const out: Record<string, string> = {}
  for (const [k, v] of u.searchParams) out[k] = v
  for (const [k, v] of new URLSearchParams(u.hash.slice(1))) out[k] = v
  return out
}

export function tokenRequest(cfg: OAuth2Config, extra: Record<string, string>): { url: string; headers: Record<string, string>; body: string } {
  const url = webUrl(cfg.accessTokenUrl, 'Access Token URL').toString()
  const params = new URLSearchParams(extra)
  const headers: Record<string, string> = { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' }
  if (cfg.scope && !extra.code) params.set('scope', cfg.scope)
  if (cfg.client_authentication === 'body') {
    params.set('client_id', cfg.clientId ?? '')
    if (cfg.clientSecret) params.set('client_secret', cfg.clientSecret)
  } else {
    headers.Authorization = `Basic ${Buffer.from(`${encodeURIComponent(cfg.clientId ?? '')}:${encodeURIComponent(cfg.clientSecret ?? '')}`).toString('base64')}`
  }
  return { url, headers, body: params.toString() }
}

export function parseToken(text: string, contentType: string): OAuth2Token {
  let data: Record<string, unknown>
  if (/json/i.test(contentType) || /^\s*\{/.test(text)) data = JSON.parse(text)
  else data = Object.fromEntries(new URLSearchParams(text))
  if (typeof data.error === 'string') throw new Error(`${data.error}${data.error_description ? `: ${data.error_description}` : ''}`)
  if (typeof data.access_token !== 'string') throw new Error('The token response has no access_token')
  return {
    access_token: data.access_token,
    ...(typeof data.token_type === 'string' ? { token_type: data.token_type } : {}),
    ...(typeof data.refresh_token === 'string' ? { refresh_token: data.refresh_token } : {}),
    ...(data.expires_in !== undefined ? { expires_in: Number(data.expires_in) } : {}),
    ...(typeof data.scope === 'string' ? { scope: data.scope } : {}),
  }
}

export interface OAuth2Deps {
  /** Opens the provider's login page; resolves with the callback URL once the browser is redirected to it. */
  authorize(authUrl: string, redirectUri: string): Promise<string>
  fetch(url: string, init: { method: string; headers: Record<string, string>; body: string }): Promise<{ ok: boolean; status: number; text(): Promise<string>; contentType: string }>
}

export async function getToken(cfg: OAuth2Config, deps: OAuth2Deps): Promise<OAuth2Token> {
  const grant = cfg.grant_type ?? 'authorization_code'
  const exchange = async (extra: Record<string, string>) => {
    const req = tokenRequest(cfg, extra)
    const res = await deps.fetch(req.url, { method: 'POST', headers: req.headers, body: req.body })
    const text = await res.text()
    if (!res.ok) throw new Error(`Token request failed (${res.status}): ${text.slice(0, 500)}`)
    return parseToken(text, res.contentType)
  }
  if (grant === 'client_credentials') return exchange({ grant_type: 'client_credentials' })
  if (grant === 'password_credentials') return exchange({ grant_type: 'password', username: cfg.username ?? '', password: cfg.password ?? '' })

  if (!cfg.redirect_uri) throw new Error('Callback URL is required')
  const pkce = grant === 'authorization_code_with_pkce' ? pkcePair(cfg.challengeAlgorithm === 'plain' ? 'plain' : 'S256') : undefined
  const callback = parseCallback(await deps.authorize(buildAuthUrl(cfg, pkce?.challenge), cfg.redirect_uri), cfg.redirect_uri)!
  if (callback.error) throw new Error(`${callback.error}${callback.error_description ? `: ${callback.error_description}` : ''}`)
  if (cfg.state && callback.state !== cfg.state) throw new Error('The state returned by the server does not match')
  if (grant === 'implicit') return parseToken(JSON.stringify(callback), 'application/json')
  if (!callback.code) throw new Error('The callback did not contain an authorization code')
  return exchange({
    grant_type: 'authorization_code',
    code: callback.code,
    redirect_uri: cfg.redirect_uri,
    ...(pkce ? { code_verifier: pkce.verifier } : {}),
  })
}
