import type { PmAuth, PmAuthAttribute } from '../../shared/format/types'

export interface AuthField {
  key: string
  label: string
  kind?: 'text' | 'password' | 'select' | 'checkbox' | 'textarea'
  options?: string[]
  default?: string | boolean
  advanced?: boolean
  placeholder?: string
}

export interface AuthType {
  type: string
  label: string
  description: string
  fields: AuthField[]
}

// Field keys are the parameter names postman-runtime's authorizers read.
export const AUTH_TYPES: AuthType[] = [
  { type: 'noauth', label: 'No Auth', description: 'This request does not use any authorization.', fields: [] },
  {
    type: 'basic',
    label: 'Basic Auth',
    description: 'The authorization header will be automatically generated when you send the request.',
    fields: [
      { key: 'username', label: 'Username' },
      { key: 'password', label: 'Password', kind: 'password' },
    ],
  },
  {
    type: 'bearer',
    label: 'Bearer Token',
    description: 'The authorization header will be automatically generated when you send the request.',
    fields: [{ key: 'token', label: 'Token', kind: 'password' }],
  },
  {
    type: 'jwt',
    label: 'JWT Bearer',
    description: 'A JWT is generated and signed when you send the request.',
    fields: [
      { key: 'addTokenTo', label: 'Add JWT token to', kind: 'select', options: ['header', 'queryParam'], default: 'header' },
      { key: 'algorithm', label: 'Algorithm', kind: 'select', options: ['HS256', 'HS384', 'HS512', 'RS256', 'RS384', 'RS512', 'PS256', 'PS384', 'PS512', 'ES256', 'ES384', 'ES512'], default: 'HS256' },
      { key: 'secret', label: 'Secret', kind: 'password' },
      { key: 'isSecretBase64Encoded', label: 'Secret Base64 encoded', kind: 'checkbox', default: false },
      { key: 'privateKey', label: 'Private key (RS/PS/ES)', kind: 'textarea' },
      { key: 'payload', label: 'Payload', kind: 'textarea', default: '{}' },
      { key: 'headerPrefix', label: 'Request header prefix', default: 'Bearer', advanced: true },
      { key: 'queryParamKey', label: 'Query param name', default: 'token', advanced: true },
      { key: 'header', label: 'JWT headers', kind: 'textarea', default: '{}', advanced: true },
    ],
  },
  {
    type: 'digest',
    label: 'Digest Auth',
    description: 'By default, Postman extracts values from the received response and retries the request.',
    fields: [
      { key: 'username', label: 'Username' },
      { key: 'password', label: 'Password', kind: 'password' },
      { key: 'disableRetryRequest', label: 'Disable retrying the request', kind: 'checkbox', default: false },
      { key: 'realm', label: 'Realm', advanced: true },
      { key: 'nonce', label: 'Nonce', advanced: true },
      { key: 'algorithm', label: 'Algorithm', kind: 'select', options: ['MD5', 'MD5-sess', 'SHA-256', 'SHA-256-sess', 'SHA-512-256', 'SHA-512-256-sess'], default: 'MD5', advanced: true },
      { key: 'qop', label: 'qop', advanced: true },
      { key: 'nonceCount', label: 'Nonce Count', advanced: true },
      { key: 'clientNonce', label: 'Client Nonce', advanced: true },
      { key: 'opaque', label: 'Opaque', advanced: true },
    ],
  },
  {
    type: 'oauth1',
    label: 'OAuth 1.0',
    description: 'The signature is generated when you send the request.',
    fields: [
      { key: 'addParamsToHeader', label: 'Add authorization data to request headers', kind: 'checkbox', default: true },
      { key: 'signatureMethod', label: 'Signature Method', kind: 'select', options: ['HMAC-SHA1', 'HMAC-SHA256', 'HMAC-SHA512', 'RSA-SHA1', 'RSA-SHA256', 'RSA-SHA512', 'PLAINTEXT'], default: 'HMAC-SHA1' },
      { key: 'consumerKey', label: 'Consumer Key' },
      { key: 'consumerSecret', label: 'Consumer Secret', kind: 'password' },
      { key: 'token', label: 'Access Token' },
      { key: 'tokenSecret', label: 'Token Secret', kind: 'password' },
      { key: 'privateKey', label: 'Private key (RSA)', kind: 'textarea', advanced: true },
      { key: 'callback', label: 'Callback URL', advanced: true },
      { key: 'verifier', label: 'Verifier', advanced: true },
      { key: 'timestamp', label: 'Timestamp', advanced: true },
      { key: 'nonce', label: 'Nonce', advanced: true },
      { key: 'version', label: 'Version', default: '1.0', advanced: true },
      { key: 'realm', label: 'Realm', advanced: true },
      { key: 'includeBodyHash', label: 'Include body hash', kind: 'checkbox', default: false, advanced: true },
      { key: 'addEmptyParamsToSign', label: 'Add empty parameters to signature', kind: 'checkbox', default: false, advanced: true },
    ],
  },
  {
    type: 'oauth2',
    label: 'OAuth 2.0',
    description: 'Use "Get New Access Token" to obtain a token, or paste one.',
    fields: [
      { key: 'addTokenTo', label: 'Add auth data to', kind: 'select', options: ['header', 'queryParams'], default: 'header' },
      { key: 'accessToken', label: 'Access Token', kind: 'password' },
      { key: 'headerPrefix', label: 'Header Prefix', default: 'Bearer' },
    ],
  },
  {
    type: 'hawk',
    label: 'Hawk Authentication',
    description: 'The authorization header will be generated when you send the request.',
    fields: [
      { key: 'authId', label: 'Hawk Auth ID' },
      { key: 'authKey', label: 'Hawk Auth Key', kind: 'password' },
      { key: 'algorithm', label: 'Algorithm', kind: 'select', options: ['sha256', 'sha1'], default: 'sha256' },
      { key: 'user', label: 'User', advanced: true },
      { key: 'nonce', label: 'Nonce', advanced: true },
      { key: 'extraData', label: 'ext', advanced: true },
      { key: 'app', label: 'app', advanced: true },
      { key: 'delegation', label: 'dlg', advanced: true },
      { key: 'timestamp', label: 'Timestamp', advanced: true },
      { key: 'includePayloadHash', label: 'Include payload hash', kind: 'checkbox', default: false, advanced: true },
    ],
  },
  {
    type: 'awsv4',
    label: 'AWS Signature',
    description: 'The request is signed with AWS Signature Version 4 when you send it.',
    fields: [
      { key: 'addAuthDataToQuery', label: 'Add authorization data to query params', kind: 'checkbox', default: false },
      { key: 'accessKey', label: 'AccessKey' },
      { key: 'secretKey', label: 'SecretKey', kind: 'password' },
      { key: 'region', label: 'AWS Region', placeholder: 'us-east-1', advanced: true },
      { key: 'service', label: 'Service Name', advanced: true },
      { key: 'sessionToken', label: 'Session Token', kind: 'password', advanced: true },
    ],
  },
  {
    type: 'ntlm',
    label: 'NTLM Authentication',
    description: 'Postman performs the NTLM handshake when you send the request.',
    fields: [
      { key: 'username', label: 'Username' },
      { key: 'password', label: 'Password', kind: 'password' },
      { key: 'disableRetryRequest', label: 'Disable retrying the request', kind: 'checkbox', default: false },
      { key: 'domain', label: 'Domain', advanced: true },
      { key: 'workstation', label: 'Workstation', advanced: true },
    ],
  },
  {
    type: 'apikey',
    label: 'API Key',
    description: 'The key/value pair is added to the request when you send it.',
    fields: [
      { key: 'key', label: 'Key' },
      { key: 'value', label: 'Value', kind: 'password' },
      { key: 'in', label: 'Add to', kind: 'select', options: ['header', 'query'], default: 'header' },
    ],
  },
  {
    type: 'edgegrid',
    label: 'Akamai EdgeGrid',
    description: 'The EdgeGrid signature is generated when you send the request.',
    fields: [
      { key: 'accessToken', label: 'Access Token' },
      { key: 'clientToken', label: 'Client Token' },
      { key: 'clientSecret', label: 'Client Secret', kind: 'password' },
      { key: 'nonce', label: 'Nonce', advanced: true },
      { key: 'timestamp', label: 'Timestamp', advanced: true },
      { key: 'baseURL', label: 'Base URL', advanced: true },
      { key: 'headersToSign', label: 'Headers to Sign', advanced: true },
    ],
  },
  {
    type: 'asap',
    label: 'ASAP (Atlassian)',
    description: 'A signed ASAP token is generated when you send the request.',
    fields: [
      { key: 'alg', label: 'Algorithm', kind: 'select', options: ['RS256', 'RS384', 'RS512', 'PS256', 'PS384', 'PS512', 'ES256', 'ES384', 'ES512'], default: 'RS256' },
      { key: 'iss', label: 'Issuer' },
      { key: 'aud', label: 'Audience' },
      { key: 'kid', label: 'Key ID' },
      { key: 'privateKey', label: 'Private Key', kind: 'textarea' },
      { key: 'sub', label: 'Subject', advanced: true },
      { key: 'claims', label: 'Additional claims', kind: 'textarea', advanced: true },
      { key: 'exp', label: 'Expiry', advanced: true },
    ],
  },
]

export const authType = (type: string | undefined) => AUTH_TYPES.find((t) => t.type === type)

export function getAttr(auth: PmAuth | undefined, key: string): unknown {
  if (!auth) return undefined
  const attrs = auth[auth.type]
  return Array.isArray(attrs) ? attrs.find((a) => a.key === key)?.value : undefined
}

/** Returns a new auth object with one attribute set (v2.1 array form). */
export function setAttr(auth: PmAuth, key: string, value: unknown): PmAuth {
  const attrs = Array.isArray(auth[auth.type]) ? (auth[auth.type] as PmAuthAttribute[]) : []
  const type = typeof value === 'boolean' ? 'boolean' : 'string'
  const next = attrs.some((a) => a.key === key) ? attrs.map((a) => (a.key === key ? { ...a, value, type } : a)) : [...attrs, { key, value, type }]
  return { ...auth, [auth.type]: next }
}

/** Switching type keeps other types' attributes (as Postman does), so switching back restores them. */
export function withType(auth: PmAuth | undefined, type: string): PmAuth {
  return { ...(auth ?? {}), type }
}
