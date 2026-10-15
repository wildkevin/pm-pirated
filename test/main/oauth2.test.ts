import { describe, expect, it, vi } from 'vitest'
import { buildAuthUrl, getToken, parseCallback, parseToken, pkcePair, tokenRequest, type OAuth2Deps } from '../../src/main/oauth2'
import { createHash } from 'node:crypto'

const cfg = {
  authUrl: 'https://auth.test/authorize',
  accessTokenUrl: 'https://auth.test/token',
  clientId: 'cid',
  clientSecret: 'sec',
  redirect_uri: 'https://oauth.pstmn.io/v1/callback',
  scope: 'read write',
  state: 'xyz',
}

const fakeFetch = (body: string, ok = true): OAuth2Deps['fetch'] =>
  vi.fn(async () => ({ ok, status: ok ? 200 : 401, text: async () => body, contentType: 'application/json' }))

describe('OAuth 2.0 helpers', () => {
  it('builds the authorization URL, with PKCE when asked', () => {
    const u = new URL(buildAuthUrl({ ...cfg, grant_type: 'authorization_code_with_pkce' }, 'CH'))
    expect(Object.fromEntries(u.searchParams)).toEqual({
      response_type: 'code',
      client_id: 'cid',
      redirect_uri: cfg.redirect_uri,
      scope: 'read write',
      state: 'xyz',
      code_challenge: 'CH',
      code_challenge_method: 'S256',
    })
    expect(new URL(buildAuthUrl({ ...cfg, grant_type: 'implicit' })).searchParams.get('response_type')).toBe('token')
  })

  it('refuses non-web URLs (file://, custom schemes)', () => {
    expect(() => buildAuthUrl({ ...cfg, authUrl: 'file:///etc/passwd' })).toThrow(/http\(s\)/)
    expect(() => tokenRequest({ ...cfg, accessTokenUrl: 'file:///C:/Users/me/secret.txt' }, {})).toThrow(/http\(s\)/)
    expect(() => tokenRequest({ ...cfg, accessTokenUrl: 'not a url' }, {})).toThrow(/not a valid URL/)
  })

  it('creates a valid S256 PKCE pair', () => {
    const { verifier, challenge } = pkcePair()
    expect(verifier).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(challenge).toBe(createHash('sha256').update(verifier).digest('base64url'))
  })

  it('recognises the callback and reads query and fragment', () => {
    expect(parseCallback('https://oauth.pstmn.io/v1/callback?code=abc&state=xyz', cfg.redirect_uri)).toEqual({ code: 'abc', state: 'xyz' })
    expect(parseCallback('https://oauth.pstmn.io/v1/callback#access_token=t&token_type=bearer', cfg.redirect_uri)).toEqual({ access_token: 't', token_type: 'bearer' })
    expect(parseCallback('https://auth.test/login?next=x', cfg.redirect_uri)).toBeNull()
  })

  it('sends client credentials in the header or the body', () => {
    const header = tokenRequest(cfg, { grant_type: 'client_credentials' })
    expect(header.headers.Authorization).toBe(`Basic ${Buffer.from('cid:sec').toString('base64')}`)
    expect(new URLSearchParams(header.body).get('scope')).toBe('read write')
    const body = tokenRequest({ ...cfg, client_authentication: 'body' }, { grant_type: 'client_credentials' })
    expect(body.headers.Authorization).toBeUndefined()
    expect(Object.fromEntries(new URLSearchParams(body.body))).toMatchObject({ client_id: 'cid', client_secret: 'sec' })
  })

  it('parses JSON and form-encoded token responses, and errors', () => {
    expect(parseToken('{"access_token":"a","expires_in":"3600","token_type":"Bearer"}', 'application/json')).toEqual({ access_token: 'a', expires_in: 3600, token_type: 'Bearer' })
    expect(parseToken('access_token=b&scope=x', 'application/x-www-form-urlencoded')).toEqual({ access_token: 'b', scope: 'x' })
    expect(() => parseToken('{"error":"invalid_client","error_description":"bad secret"}', 'application/json')).toThrow('invalid_client: bad secret')
  })
})

describe('getToken flows', () => {
  it('client credentials: posts to the token URL', async () => {
    const fetch = fakeFetch('{"access_token":"cc"}')
    expect(await getToken({ ...cfg, grant_type: 'client_credentials' }, { authorize: vi.fn(), fetch })).toEqual({ access_token: 'cc' })
    expect(vi.mocked(fetch).mock.calls[0][0]).toBe('https://auth.test/token')
  })

  it('authorization code with PKCE: logs in, checks state, exchanges code with the verifier', async () => {
    const fetch = fakeFetch('{"access_token":"ac"}')
    const authorize = vi.fn(async (url: string) => {
      expect(new URL(url).searchParams.get('code_challenge')).toBeTruthy()
      return `${cfg.redirect_uri}?code=C1&state=xyz`
    })
    expect(await getToken({ ...cfg, grant_type: 'authorization_code_with_pkce' }, { authorize, fetch })).toEqual({ access_token: 'ac' })
    const body = new URLSearchParams(vi.mocked(fetch).mock.calls[0][1].body)
    expect(body.get('code')).toBe('C1')
    expect(body.get('code_verifier')).toMatch(/^[A-Za-z0-9_-]{43}$/)
  })

  it('rejects a mismatched state and reports provider errors', async () => {
    const fetch = fakeFetch('{}')
    await expect(getToken({ ...cfg, grant_type: 'authorization_code' }, { authorize: async () => `${cfg.redirect_uri}?code=C&state=evil`, fetch })).rejects.toThrow(/state/)
    await expect(getToken({ ...cfg, grant_type: 'authorization_code' }, { authorize: async () => `${cfg.redirect_uri}?error=access_denied`, fetch })).rejects.toThrow('access_denied')
    await expect(getToken({ ...cfg, grant_type: 'client_credentials' }, { authorize: vi.fn(), fetch: fakeFetch('nope', false) })).rejects.toThrow(/401/)
  })

  it('implicit: takes the token from the callback fragment', async () => {
    expect(await getToken({ ...cfg, grant_type: 'implicit' }, { authorize: async () => `${cfg.redirect_uri}#access_token=imp&state=xyz`, fetch: vi.fn() })).toEqual({ access_token: 'imp' })
  })
})
