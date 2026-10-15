import { Download, Play, ShieldCheck, ShieldOff, Square, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { CapturedExchange } from '../../shared/engine'
import type { PmItem, WorkspaceInfo } from '../../shared/format/types'
import type { CaptureState } from '../../shared/ipc'
import { formatBytes } from '../lib/body'
import { methodClass } from '../lib/methods'
import { Toggle } from './common/ui'
import { containerOptions } from './MockView'

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']
const csv = (s: string) => s.split(',').map((x) => x.trim()).filter(Boolean)

interface Props {
  state: CaptureState | null
  workspace: WorkspaceInfo
  captured: CapturedExchange[]
  onClear(): void
  onOpenInTab(item: PmItem): void
  onError(e: unknown): void
}

export function CaptureView({ state, workspace, captured, onClear, onOpenInTab, onError }: Props) {
  const [port, setPort] = useState(state?.port ?? 5555)
  const [decrypt, setDecrypt] = useState(state?.decrypt ?? false)
  const [include, setInclude] = useState(state?.filter.includeHosts.join(', ') ?? '')
  const [exclude, setExclude] = useState(state?.filter.excludeHosts.join(', ') ?? '')
  const [selected, setSelected] = useState<number | null>(null)
  const [saveTarget, setSaveTarget] = useState(workspace.collections[0]?.id ?? '')
  useEffect(() => {
    if (!state) return
    setPort(state.port)
    setDecrypt(state.decrypt)
  }, [state?.running])

  if (!state) return <div className="muted-note">Loading…</div>
  const call = (p: Promise<unknown>) => void p.catch(onError)
  const options = (patch: Partial<{ include: string; exclude: string; methods: string[]; destination: string }>) =>
    call(
      window.api.setCaptureOptions(
        {
          includeHosts: csv(patch.include ?? include),
          excludeHosts: csv(patch.exclude ?? exclude),
          methods: patch.methods ?? state.filter.methods,
        },
        patch.destination ?? state.destination,
      ),
    )
  const sel = captured.find((c) => c.id === selected)

  return (
    <div className="capture">
      <div className="capture-config">
        <div className="section-title">Capture requests</div>
        <p className="muted">Point an app or browser at this proxy to record its requests. Only this computer can use it.</p>
        <div className="form-row">
          <label className="field-label" htmlFor="cap-port">
            Port
          </label>
          <input id="cap-port" className="input small" type="number" min={1} max={65535} disabled={state.running} value={port} onChange={(e) => setPort(Number(e.target.value) || 0)} />
        </div>
        <div className="setting-row">
          <div>
            <div className="setting-label">Decrypt HTTPS</div>
            <div className="muted">Needs the PM Local certificate to be trusted. Off: HTTPS passes through and only the host is shown.</div>
          </div>
          <Toggle label="Decrypt HTTPS" checked={decrypt} onChange={(v) => (setDecrypt(v), state.running && call(window.api.startCapture(port, v)))} />
        </div>
        {state.running ? (
          <button className="btn btn-secondary run-btn" onClick={() => call(window.api.stopCapture())}>
            <Square size={12} /> Stop proxy
          </button>
        ) : (
          <button className="btn btn-primary run-btn" onClick={() => call(window.api.startCapture(port, decrypt))}>
            <Play size={12} /> Start proxy
          </button>
        )}
        <div className="capture-status" data-testid="capture-status">
          <span className={`status-dot${state.running ? ' on' : ''}`} /> {state.running ? `Listening on 127.0.0.1:${state.port}` : 'Stopped'}
        </div>
        {state.error && (
          <div className="form-error" role="alert">
            {state.error}
          </div>
        )}

        <div className="setting-row">
          <div>
            <div className="setting-label">Use as system proxy</div>
            <div className="muted">{state.systemProxySupported ? 'Routes this computer’s traffic through the capture proxy; your previous settings are restored when you stop or quit.' : 'Set 127.0.0.1:' + state.port + ' as the proxy in your system or browser settings.'}</div>
          </div>
          <Toggle label="Use as system proxy" checked={state.systemProxy} onChange={(v) => call(window.api.setSystemProxy(v))} />
        </div>

        <div className="section-title">Certificate</div>
        <div className="ca-row">
          {state.caTrusted ? (
            <span className="status-ok">
              <ShieldCheck size={14} /> Trusted
            </span>
          ) : (
            <span className="muted">
              <ShieldOff size={14} /> {state.caTrusted === false ? 'Not trusted' : 'Unknown'}
            </span>
          )}
          <span className="spacer" />
          {state.caTrusted ? (
            <button className="btn btn-small" onClick={() => call(window.api.untrustCaptureCa())}>
              Remove
            </button>
          ) : (
            <button className="btn btn-small" onClick={() => call(window.api.trustCaptureCa())}>
              Trust certificate
            </button>
          )}
          <button className="btn btn-small" onClick={() => call(window.api.exportCaptureCa())}>
            <Download size={12} /> Export
          </button>
        </div>

        <div className="section-title">Filters</div>
        <label className="field-label" htmlFor="cap-include">
          Only hosts (comma separated, * wildcard)
        </label>
        <input id="cap-include" className="input wide" placeholder="api.example.com, *.corp.local" value={include} onChange={(e) => setInclude(e.target.value)} onBlur={() => options({ include })} />
        <label className="field-label" htmlFor="cap-exclude">
          Exclude hosts
        </label>
        <input id="cap-exclude" className="input wide" placeholder="telemetry, *.googleapis.com" value={exclude} onChange={(e) => setExclude(e.target.value)} onBlur={() => options({ exclude })} />
        <div className="field-label">Methods (none = all)</div>
        <div className="chips">
          {METHODS.map((m) => {
            const on = state.filter.methods.includes(m)
            return (
              <button key={m} className={`chip${on ? ' on' : ''}`} onClick={() => options({ methods: on ? state.filter.methods.filter((x) => x !== m) : [...state.filter.methods, m] })}>
                {m}
              </button>
            )
          })}
        </div>
        <label className="field-label" htmlFor="cap-dest">
          Save captured requests to
        </label>
        <select id="cap-dest" className="select wide" value={state.destination} onChange={(e) => options({ destination: e.target.value })}>
          <option value="history">History</option>
          <option value="none">Don’t save</option>
          {containerOptions(workspace.collections).map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </select>
      </div>

      <div className="capture-results">
        <div className="mock-log-head">
          <span className="section-title">Captured ({captured.length})</span>
          <span className="spacer" />
          <button className="btn btn-small" onClick={onClear} disabled={!captured.length}>
            <Trash2 size={12} /> Clear
          </button>
        </div>
        <div className="capture-list" data-testid="capture-list">
          {captured.length === 0 && <div className="muted-note">Requests through the proxy appear here.</div>}
          {[...captured].reverse().map((c) => {
            const u = new URL(c.url)
            return (
              <div key={c.id} className={`capture-row${selected === c.id ? ' selected' : ''}`} onClick={() => setSelected(c.id)}>
                <span className={methodClass(c.method)}>{c.method}</span>
                <span className="capture-host">{u.host}</span>
                <span className="capture-path muted">{c.tunnel ? '(encrypted)' : u.pathname + u.search}</span>
                <span className="spacer" />
                {c.error ? <span className="status-bad">{c.error}</span> : c.status ? <span className={c.status < 400 ? 'status-ok' : 'status-bad'}>{c.status}</span> : null}
                <span className="muted">{c.timeMs} ms</span>
              </div>
            )
          })}
        </div>
        {sel && !sel.tunnel && (
          <div className="capture-details">
            <div className="capture-actions">
              <button
                className="btn btn-small"
                onClick={() =>
                  onOpenInTab({
                    name: `${sel.method} ${new URL(sel.url).pathname}`,
                    request: {
                      method: sel.method,
                      url: sel.url,
                      header: sel.requestHeaders.filter((h) => !/^(host|content-length|connection|proxy-connection|accept-encoding)$/i.test(h.key)),
                      ...(sel.requestBody ? { body: { mode: 'raw' as const, raw: sel.requestBody } } : {}),
                    },
                    response: [],
                  })
                }
              >
                Open in tab
              </button>
              <select aria-label="Save to" className="select" value={saveTarget} onChange={(e) => setSaveTarget(e.target.value)}>
                {containerOptions(workspace.collections).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
              </select>
              <button className="btn btn-small" disabled={!saveTarget} onClick={() => call(window.api.saveCaptured(sel, saveTarget))}>
                Save to collection
              </button>
            </div>
            <div className="console-section">Request</div>
            <div className="console-kv">{sel.method} {sel.url}</div>
            {sel.requestHeaders.map((h, i) => (
              <div key={i} className="console-kv">
                <b>{h.key}:</b> {h.value}
              </div>
            ))}
            {sel.requestBody && <pre className="console-pre">{sel.requestBody}</pre>}
            <div className="console-section">Response {sel.status}</div>
            {sel.responseHeaders.map((h, i) => (
              <div key={i} className="console-kv">
                <b>{h.key}:</b> {h.value}
              </div>
            ))}
            {sel.responseBody && <pre className="console-pre">{sel.responseBody.slice(0, 20_000)}</pre>}
            {sel.bodyTruncated && <div className="muted">Bodies are kept up to {formatBytes(1024 * 1024)}.</div>}
          </div>
        )}
      </div>
    </div>
  )
}
