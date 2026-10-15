import type { AppSettingsData } from '../../../shared/settings'
import { NumericInput, Toggle } from '../common/ui'

// Per-request overrides (v2.1 `protocolProfileBehavior`). Unset = use the app default.
const OPTIONS: { key: string; label: string; help: string; appDefault?: (s: AppSettingsData) => boolean; fallback: boolean }[] = [
  {
    key: 'strictSSL',
    label: 'Enable SSL certificate verification',
    help: 'Verify SSL certificates when sending a request. Verification failures will result in the request being aborted.',
    appDefault: (s) => s.general.sslVerification,
    fallback: true,
  },
  { key: 'followRedirects', label: 'Automatically follow redirects', help: 'Follow HTTP 3xx responses as redirects.', appDefault: (s) => s.general.followRedirects, fallback: true },
  { key: 'followOriginalHttpMethod', label: 'Follow original HTTP Method', help: 'Redirect with the original HTTP method instead of the default behavior of redirecting with GET.', fallback: false },
  { key: 'followAuthorizationHeader', label: 'Follow Authorization header', help: 'Retain authorization header when a redirect happens to a different hostname.', fallback: false },
  { key: 'removeRefererHeaderOnRedirect', label: 'Remove referer header on redirect', help: 'Remove the referer header when a redirect happens.', fallback: false },
  { key: 'disableUrlEncoding', label: 'Disable URL encoding', help: 'Keep URL characters such as | unencoded. Spaces still require %20 for HTTP transport.', fallback: false },
  { key: 'disableCookies', label: 'Disable cookie jar', help: 'Prevent cookies used in this request from being stored in the cookie jar.', fallback: false },
  { key: 'disableBodyPruning', label: 'Send body with GET/HEAD', help: 'Keep the request body for GET and HEAD requests.', fallback: true },
]

interface Props {
  behavior: Record<string, unknown> | undefined
  onChange(behavior: Record<string, unknown> | undefined): void
  settings: AppSettingsData | null
}

export function RequestSettings({ behavior, onChange, settings }: Props) {
  const set = (key: string, value: unknown) => {
    const next = { ...(behavior ?? {}) }
    if (value === undefined) delete next[key]
    else next[key] = value
    onChange(Object.keys(next).length ? next : undefined)
  }
  const maxRedirects = behavior?.maxRedirects
  return (
    <div className="request-settings">
      {OPTIONS.map((o) => {
        const def = settings && o.appDefault ? o.appDefault(settings) : o.fallback
        const explicit = behavior?.[o.key]
        const value = typeof explicit === 'boolean' ? explicit : def
        return (
          <div className="setting-row" key={o.key}>
            <div>
              <div className="setting-label">{o.label}</div>
              <div className="muted">{o.help}</div>
            </div>
            <div className="setting-control">
              <Toggle label={o.label} checked={value} onChange={(v) => set(o.key, v === def ? undefined : v)} />
              <div className="muted setting-default">
                Default: {def ? 'ON' : 'OFF'}
                {typeof explicit === 'boolean' && (
                  <button className="link-btn" onClick={() => set(o.key, undefined)}>
                    Reset
                  </button>
                )}
              </div>
            </div>
          </div>
        )
      })}
      <div className="setting-row">
        <div>
          <div className="setting-label">Maximum number of redirects</div>
          <div className="muted">Set a cap on the maximum number of redirects to follow.</div>
        </div>
        <NumericInput
          aria-label="Maximum number of redirects"
          className="input setting-number"
          type="number"
          min={0}
          value={typeof maxRedirects === 'number' ? maxRedirects : 10}
          onChange={(value) => set('maxRedirects', value === 10 ? undefined : value)}
        />
      </div>
    </div>
  )
}
