import { useState } from 'react'
import type { PmAuth } from '../../../shared/format/types'
import { AUTH_TYPES, authType, getAttr, setAttr, withType, type AuthField } from '../../lib/auth'

interface Props {
  auth: PmAuth | undefined
  onChange(auth: PmAuth | undefined): void
  /** Requests and folders can inherit; collections cannot. */
  canInherit: boolean
  /** Name of the parent the auth would be inherited from, for the hint. */
  inheritedFrom?: string
  onGetOAuth2Token?(auth: PmAuth): Promise<void>
}

const INHERIT = 'inherit'

export function AuthEditor({ auth, onChange, canInherit, inheritedFrom, onGetOAuth2Token }: Props) {
  const [showAdvanced, setShowAdvanced] = useState(false)
  const current = auth?.type ?? (canInherit ? INHERIT : 'noauth')
  const def = authType(current)
  const fields = def?.fields ?? []
  const basic = fields.filter((f) => !f.advanced)
  const advanced = fields.filter((f) => f.advanced)

  return (
    <div className="auth-editor">
      <div className="auth-left">
        <label className="field-label" htmlFor="auth-type">
          Auth Type
        </label>
        <select
          id="auth-type"
          aria-label="Auth type"
          className="select"
          value={current}
          onChange={(e) => onChange(e.target.value === INHERIT ? undefined : withType(auth, e.target.value))}
        >
          {canInherit && <option value={INHERIT}>Inherit auth from parent</option>}
          {AUTH_TYPES.map((t) => (
            <option key={t.type} value={t.type}>
              {t.label}
            </option>
          ))}
        </select>
        <p className="muted auth-desc">
          {current === INHERIT
            ? `This request is using the auth from ${inheritedFrom ?? 'its parent collection or folder'}.`
            : def?.description}
        </p>
      </div>
      <div className="auth-right">
        {current === INHERIT || current === 'noauth' ? (
          <div className="muted-note">
            {current === INHERIT ? 'Auth is inherited from the parent.' : 'This request does not use any authorization.'}
          </div>
        ) : (
          <>
            {basic.map((f) => (
              <AuthFieldRow key={f.key} field={f} auth={auth!} onChange={onChange} />
            ))}
            {advanced.length > 0 && (
              <>
                <button className="link-btn advanced-toggle" onClick={() => setShowAdvanced(!showAdvanced)}>
                  {showAdvanced ? '▾' : '▸'} Advanced configuration
                </button>
                {showAdvanced && advanced.map((f) => <AuthFieldRow key={f.key} field={f} auth={auth!} onChange={onChange} />)}
              </>
            )}
            {current === 'oauth2' && <OAuth2Config auth={auth!} onChange={onChange} onGetToken={onGetOAuth2Token} />}
          </>
        )}
      </div>
    </div>
  )
}

function AuthFieldRow({ field, auth, onChange }: { field: AuthField; auth: PmAuth; onChange(a: PmAuth): void }) {
  const raw = getAttr(auth, field.key)
  const value = raw ?? field.default ?? ''
  const set = (v: unknown) => onChange(setAttr(auth, field.key, v))
  const id = `auth-${field.key}`
  return (
    <div className="form-row">
      <label className="field-label" htmlFor={id}>
        {field.label}
      </label>
      {field.kind === 'select' ? (
        <select id={id} className="select" value={String(value)} onChange={(e) => set(e.target.value)}>
          {field.options!.map((o) => (
            <option key={o}>{o}</option>
          ))}
        </select>
      ) : field.kind === 'checkbox' ? (
        <input id={id} type="checkbox" checked={value === true || value === 'true'} onChange={(e) => set(e.target.checked)} />
      ) : field.kind === 'textarea' ? (
        <textarea id={id} className="input textarea" spellCheck={false} value={String(value)} onChange={(e) => set(e.target.value)} />
      ) : (
        <input
          id={id}
          className="input"
          type={field.kind === 'password' ? 'password' : 'text'}
          placeholder={field.placeholder ?? field.label}
          spellCheck={false}
          value={String(value)}
          onChange={(e) => set(e.target.value)}
        />
      )}
    </div>
  )
}

const OAUTH2_GRANTS = ['authorization_code', 'authorization_code_with_pkce', 'implicit', 'password_credentials', 'client_credentials']
const OAUTH2_FIELDS: (AuthField & { grants?: string[] })[] = [
  { key: 'tokenName', label: 'Token Name' },
  { key: 'grant_type', label: 'Grant type', kind: 'select', options: OAUTH2_GRANTS, default: 'authorization_code' },
  { key: 'redirect_uri', label: 'Callback URL', placeholder: 'https://oauth.pstmn.io/v1/callback', grants: ['authorization_code', 'authorization_code_with_pkce', 'implicit'] },
  { key: 'authUrl', label: 'Auth URL', grants: ['authorization_code', 'authorization_code_with_pkce', 'implicit'] },
  { key: 'accessTokenUrl', label: 'Access Token URL', grants: ['authorization_code', 'authorization_code_with_pkce', 'password_credentials', 'client_credentials'] },
  { key: 'clientId', label: 'Client ID' },
  { key: 'clientSecret', label: 'Client Secret', kind: 'password', grants: ['authorization_code', 'authorization_code_with_pkce', 'password_credentials', 'client_credentials'] },
  { key: 'username', label: 'Username', grants: ['password_credentials'] },
  { key: 'password', label: 'Password', kind: 'password', grants: ['password_credentials'] },
  { key: 'challengeAlgorithm', label: 'Code Challenge Method', kind: 'select', options: ['S256', 'plain'], default: 'S256', grants: ['authorization_code_with_pkce'] },
  { key: 'scope', label: 'Scope', placeholder: 'e.g. read:org' },
  { key: 'state', label: 'State', grants: ['authorization_code', 'authorization_code_with_pkce', 'implicit'] },
  { key: 'client_authentication', label: 'Client Authentication', kind: 'select', options: ['header', 'body'], default: 'header' },
]

function OAuth2Config({ auth, onChange, onGetToken }: { auth: PmAuth; onChange(a: PmAuth): void; onGetToken?(auth: PmAuth): Promise<void> }) {
  const [busy, setBusy] = useState(false)
  const grant = String(getAttr(auth, 'grant_type') ?? 'authorization_code')
  return (
    <div className="oauth2-config">
      <div className="section-title">Configure New Token</div>
      {OAUTH2_FIELDS.filter((f) => !f.grants || f.grants.includes(grant)).map((f) => (
        <AuthFieldRow key={f.key} field={f} auth={auth} onChange={onChange} />
      ))}
      <button
        className="btn btn-primary"
        disabled={busy || !onGetToken}
        onClick={async () => {
          setBusy(true)
          try {
            await onGetToken?.(auth)
          } finally {
            setBusy(false)
          }
        }}
      >
        {busy ? 'Waiting for authorization…' : 'Get New Access Token'}
      </button>
    </div>
  )
}
