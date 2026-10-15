import { useMemo, useState } from 'react'
import { formatBytes, viewBody } from '../lib/body'
import type { Tab } from '../state'

type Section = 'body' | 'headers'
type BodyMode = 'pretty' | 'raw'

export function ResponseViewer({ tab, onCancel }: { tab: Tab; onCancel(): void }) {
  const [section, setSection] = useState<Section>('body')
  const [mode, setMode] = useState<BodyMode>('pretty')
  const res = tab.response
  const contentType = res?.ok ? (res.headers.find((h) => h.key.toLowerCase() === 'content-type')?.value ?? '') : ''
  const view = useMemo(() => (res?.ok ? viewBody(res.body, contentType) : null), [res, contentType])

  if (tab.sendId) {
    return (
      <div className="response response-center">
        <div className="spinner" />
        <p>Sending request…</p>
        <button className="btn btn-secondary" onClick={onCancel}>
          Cancel
        </button>
      </div>
    )
  }
  if (!res) {
    return (
      <div className="response response-center">
        <p className="muted">Enter the URL and click Send to get a response</p>
      </div>
    )
  }
  if (!res.ok) {
    return (
      <div className="response response-center" data-testid="response-error">
        <p className="error-title">Could not send request</p>
        <p className="error-detail">
          {res.code && <code>{res.code}</code>} {res.error}
        </p>
      </div>
    )
  }

  return (
    <div className="response">
      <div className="response-head">
        <div className="subtabs" role="tablist">
          <button role="tab" aria-selected={section === 'body'} onClick={() => setSection('body')}>
            Body
          </button>
          <button role="tab" aria-selected={section === 'headers'} onClick={() => setSection('headers')}>
            Headers<span className="count">({res.headers.length})</span>
          </button>
        </div>
        <div className="response-meta">
          <span>
            Status:{' '}
            <b data-testid="response-status" className={res.code < 400 ? 'status-ok' : 'status-bad'}>
              {res.code} {res.status}
            </b>
          </span>
          <span>
            Time: <b className="status-ok">{Math.round(res.timeMs)} ms</b>
          </span>
          <span>
            Size: <b className="status-ok">{formatBytes(res.size)}</b>
          </span>
        </div>
      </div>

      {section === 'headers' ? (
        <div className="subtab-panel">
          <table className="kv kv-readonly">
            <thead>
              <tr>
                <th>Key</th>
                <th>Value</th>
              </tr>
            </thead>
            <tbody>
              {res.headers.map((h, i) => (
                <tr key={i}>
                  <td>{h.key}</td>
                  <td>{h.value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="response-body">
          {view?.kind === 'text' && (
            <div className="body-toolbar">
              {(['pretty', 'raw'] as const).map((m) => (
                <button key={m} className={`pill${mode === m ? ' active' : ''}`} onClick={() => setMode(m)}>
                  {m === 'pretty' ? 'Pretty' : 'Raw'}
                </button>
              ))}
              {mode === 'pretty' && <span className="muted">{view.language.toUpperCase()}</span>}
            </div>
          )}
          {view?.kind === 'text' && view.truncated && (
            <div className="notice">Response is larger than 2 MB; showing the first 2 MB.</div>
          )}
          {view?.kind === 'empty' && <div className="muted-note">This response has no body</div>}
          {view?.kind === 'binary' && (
            <div className="muted-note">Binary response ({formatBytes(view.size)}) — preview is not available.</div>
          )}
          {view?.kind === 'text' && (
            <pre className="code-view" data-testid="response-body">
              {mode === 'pretty' ? view.pretty : view.text}
            </pre>
          )}
        </div>
      )}
    </div>
  )
}
