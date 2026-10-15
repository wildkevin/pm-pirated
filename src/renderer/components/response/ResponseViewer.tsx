import { Copy, Download, Save } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type { RunReport } from '../../../shared/engine'
import { formatBytes, viewBody } from '../../lib/body'
import { CodeEditor, type EditorLanguage } from '../common/CodeEditor'

type Section = 'body' | 'cookies' | 'headers' | 'tests'
type BodyMode = 'pretty' | 'raw' | 'preview'
type TestFilter = 'all' | 'passed' | 'skipped' | 'failed'

interface Props {
  report: RunReport | undefined
  sending: boolean
  onCancel(): void
  onSaveBody(): void
  onSaveExample(): void
}

export function ResponseViewer({ report, sending, onCancel, onSaveBody, onSaveExample }: Props) {
  const [section, setSection] = useState<Section>('body')
  const [mode, setMode] = useState<BodyMode>('pretty')
  const [filter, setFilter] = useState<TestFilter>('all')
  const res = report?.response
  const contentType = res?.ok ? (res.headers.find((h) => h.key.toLowerCase() === 'content-type')?.value ?? '') : ''
  const view = useMemo(() => (res?.ok ? viewBody(res.body, contentType) : null), [res, contentType])
  const isImage = /^image\//i.test(contentType)
  const imageUrl = useMemo(() => (res?.ok && isImage ? URL.createObjectURL(new Blob([res.body as BlobPart], { type: contentType })) : null), [res, isImage, contentType])
  useEffect(() => () => void (imageUrl && URL.revokeObjectURL(imageUrl)), [imageUrl])

  if (sending) {
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
  if (!report || !res) {
    return (
      <div className="response">
        <div className="response-title">Response</div>
        <div className="response-center grow">
          <p className="muted">Enter the URL and click Send to get a response</p>
        </div>
      </div>
    )
  }

  const tests = report.tests
  const passed = tests.filter((t) => t.passed && !t.skipped).length
  const scriptErrors = report.scriptErrors.length > 0 && (
    <div className="script-errors" role="alert">
      {report.scriptErrors.map((e, i) => (
        <div key={i}>There was an error in evaluating a script: {e}</div>
      ))}
    </div>
  )

  if (!res.ok) {
    return (
      <div className="response">
        <div className="response-title">Response</div>
        {scriptErrors}
        <div className="response-center grow" data-testid="response-error">
          <p className="error-title">Could not send request</p>
          <p className="error-detail">
            {res.code && <code>{res.code}</code>} {res.error}
          </p>
          <p className="muted">{hint(res.code, res.error)}</p>
        </div>
      </div>
    )
  }

  const shownTests = tests.filter((t) => (filter === 'all' ? true : filter === 'passed' ? t.passed && !t.skipped : filter === 'skipped' ? t.skipped : !t.passed && !t.skipped))
  const lang: EditorLanguage = view?.kind === 'text' ? view.language : 'text'

  return (
    <div className="response">
      <div className="response-head">
        <div className="subtabs" role="tablist">
          <button role="tab" aria-selected={section === 'body'} onClick={() => setSection('body')}>
            Body
          </button>
          <button role="tab" aria-selected={section === 'cookies'} onClick={() => setSection('cookies')}>
            Cookies{report.cookies.length > 0 && <span className="count">({report.cookies.length})</span>}
          </button>
          <button role="tab" aria-selected={section === 'headers'} onClick={() => setSection('headers')}>
            Headers<span className="count">({res.headers.length})</span>
          </button>
          <button role="tab" aria-selected={section === 'tests'} onClick={() => setSection('tests')}>
            Test Results
            {tests.length > 0 && <span className={passed === tests.length ? 'count' : 'count count-bad'}>({passed}/{tests.length})</span>}
          </button>
        </div>
        <div className="response-meta">
          <span>
            Status: <b data-testid="response-status" className={res.code < 400 ? 'status-ok' : 'status-bad'}>{res.code} {res.status}</b>
          </span>
          <span>
            Time: <b className="status-ok">{Math.round(res.timeMs)} ms</b>
          </span>
          <span>
            Size: <b className="status-ok">{formatBytes(res.size)}</b>
          </span>
          <button className="btn-icon" title="Save as example" aria-label="Save as example" onClick={onSaveExample}>
            <Save size={14} />
          </button>
          <button className="btn-icon" title="Save response to file" aria-label="Save response to file" onClick={onSaveBody}>
            <Download size={14} />
          </button>
        </div>
      </div>
      {scriptErrors}

      {section === 'body' && (
        <div className="response-body">
          <div className="body-toolbar">
            {(['pretty', 'raw', 'preview'] as const).map((m) => (
              <button key={m} className={`pill${mode === m ? ' active' : ''}`} onClick={() => setMode(m)}>
                {m[0].toUpperCase() + m.slice(1)}
              </button>
            ))}
            {mode === 'pretty' && view?.kind === 'text' && <span className="muted lang-tag">{view.language.toUpperCase()}</span>}
            <span className="spacer" />
            {view?.kind === 'text' && (
              <button className="btn-icon" aria-label="Copy response body" title="Copy" onClick={() => void navigator.clipboard.writeText(view.text)}>
                <Copy size={14} />
              </button>
            )}
          </div>
          {view?.kind === 'text' && view.truncated && <div className="notice">Response is larger than 2 MB; showing the first 2 MB. Use “Save response to file” for the rest.</div>}
          {mode === 'preview' ? (
            isImage && imageUrl ? (
              <div className="preview-image">
                <img src={imageUrl} alt="Response preview" />
              </div>
            ) : view?.kind === 'text' ? (
              // No allow-scripts: previewed HTML cannot run code.
              <iframe className="preview-frame" title="Response preview" sandbox="" srcDoc={view.text} />
            ) : (
              <div className="muted-note">Nothing to preview</div>
            )
          ) : view?.kind === 'empty' ? (
            <div className="muted-note">This response has no body</div>
          ) : view?.kind === 'binary' ? (
            <div className="muted-note">Binary response ({formatBytes(view.size)}) — preview is not available. Use “Save response to file”.</div>
          ) : view?.kind === 'text' ? (
            <div className="code-view" data-testid="response-body">
              <CodeEditor readOnly ariaLabel="Response body" language={mode === 'pretty' ? lang : 'text'} value={mode === 'pretty' ? view.pretty : view.text} />
            </div>
          ) : null}
        </div>
      )}

      {section === 'cookies' && (
        <div className="subtab-panel">
          {report.cookies.length === 0 ? (
            <div className="muted-note">No cookies received from the server</div>
          ) : (
            <table className="kv kv-readonly">
              <thead>
                <tr>
                  {['Name', 'Value', 'Domain', 'Path', 'Expires', 'HttpOnly', 'Secure'].map((h) => (
                    <th key={h}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {report.cookies.map((c, i) => (
                  <tr key={i}>
                    <td>{c.key}</td>
                    <td>{c.value}</td>
                    <td>{c.domain}</td>
                    <td>{c.path}</td>
                    <td>{c.expires ?? 'Session'}</td>
                    <td>{String(c.httpOnly)}</td>
                    <td>{String(c.secure)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {section === 'headers' && (
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
      )}

      {section === 'tests' && (
        <div className="subtab-panel">
          <div className="body-toolbar">
            {(['all', 'passed', 'skipped', 'failed'] as const).map((f) => (
              <button key={f} className={`pill${filter === f ? ' active' : ''}`} onClick={() => setFilter(f)}>
                {f[0].toUpperCase() + f.slice(1)}
              </button>
            ))}
          </div>
          {tests.length === 0 ? (
            <div className="muted-note">There are no tests for this request. Write a test script in the Tests tab.</div>
          ) : (
            <ul className="test-list" data-testid="test-results">
              {shownTests.map((t, i) => (
                <li key={i}>
                  <span className={`test-badge ${t.skipped ? 'skip' : t.passed ? 'pass' : 'fail'}`}>{t.skipped ? 'SKIPPED' : t.passed ? 'PASS' : 'FAIL'}</span>
                  <span>{t.name}</span>
                  {t.error && <span className="test-error">| {t.error}</span>}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}

/** A hint for common network failures, especially on corporate networks. */
function hint(code: string | undefined, error: string): string {
  if (/self.signed|unable to (get|verify)|certificate/i.test(`${code} ${error}`))
    return 'The server certificate is not trusted. On a company network, add the corporate root CA in Settings > Certificates, or turn off SSL verification for this request.'
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return 'The host name could not be resolved. Check the URL, VPN, or the proxy settings in Settings > Proxy.'
  if (code === 'ECONNREFUSED') return 'Nothing is listening at that address and port.'
  if (code === 'ETIMEDOUT' || code === 'ESOCKETTIMEDOUT') return 'The server did not answer in time. Check the timeout in Settings > General, or the proxy settings.'
  if (/407|proxy/i.test(error)) return 'The proxy requires authentication: set credentials in Settings > Proxy.'
  return ''
}
