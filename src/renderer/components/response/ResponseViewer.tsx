import { useSettings } from '../../settings'
import { ChevronDown, Copy, History, MoreHorizontal, Search } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { openSearchPanel } from '@codemirror/search'
import type { EditorView } from '@codemirror/view'
import type { RunReport } from '../../../shared/engine'
import { cleanError, formatBytes, viewBody } from '../../lib/body'
import { CodeEditor, type EditorLanguage } from '../common/CodeEditor'
import { Menu, type MenuItem } from '../common/ui'

type Section = 'body' | 'cookies' | 'headers' | 'tests'
type BodyMode = 'pretty' | 'raw' | 'preview'
type TestFilter = 'all' | 'passed' | 'skipped' | 'failed'

interface Props {
  examples?: unknown[]
  report: RunReport | undefined
  sending: boolean
  onCancel(): void
  onSaveBody(report: RunReport): void
  onSaveExample(): void
  /** This session's earlier responses (newest first). */
  past: { ts: number; report: RunReport }[]
  onShowPast(index: number): void
  onClear(): void
}

const pastLabel = (p: { ts: number; report: RunReport }) => {
  const r = p.report.response
  const time = new Date(p.ts).toLocaleTimeString()
  const request = p.report.sent ? `${p.report.sent.method} ${p.report.sent.url} · ` : ''
  return r.ok ? `${request}${r.code} ${r.status} · ${Math.round(r.timeMs)} ms · ${time}` : `${request}Error · ${time}`
}

/** "History ▾": earlier responses of this tab, like Postman's response history. */
function HistoryButton({ past, current, onShow }: { past: Props['past']; current?: RunReport; onShow(i: number): void }) {
  const [at, setAt] = useState<DOMRect | null>(null)
  return (
    <>
      <button className="btn btn-ghost btn-small response-history" disabled={!past.length} onClick={(e) => setAt(e.currentTarget.getBoundingClientRect())}>
        <History size={14} /> History <ChevronDown size={12} />
      </button>
      {at && (
        <Menu
          label="Response history"
          style={{ left: at.left, top: at.bottom + 4 }}
          onClose={() => setAt(null)}
          items={past.map((p, i) => ({ label: pastLabel(p), shortcut: p.report === current ? '✓' : undefined, onClick: () => onShow(i) }))}
        />
      )}
    </>
  )
}

function MoreButton({ items }: { items: MenuItem[] }) {
  const [at, setAt] = useState<DOMRect | null>(null)
  return (
    <>
      <button className="btn-icon" aria-label="Response options" title="More" onClick={(e) => setAt(e.currentTarget.getBoundingClientRect())}>
        <MoreHorizontal size={16} />
      </button>
      {at && <Menu style={{ left: at.right - 200, top: at.bottom + 4 }} onClose={() => setAt(null)} items={items} />}
    </>
  )
}

export function ResponseViewer({ examples = [], report: liveReport, sending, onCancel, onSaveBody, onSaveExample, past, onShowPast, onClear }: Props) {
  const settings = useSettings()
  const [selectedExample, setSelectedExample] = useState<number | null>(null)
  const [feedback, setFeedback] = useState('')
  const editor = useRef<EditorView | null>(null)
  useEffect(() => { setSelectedExample(null); setFeedback('') }, [liveReport, sending])
  const report = selectedExample === null ? liveReport : exampleReport(examples[selectedExample]) ?? liveReport
  const clear = () => { setSelectedExample(null); onClear() }
  const [section, setSection] = useState<Section>('body')
  const [mode, setMode] = useState<BodyMode>('pretty')
  const [filter, setFilter] = useState<TestFilter>('all')
  const res = report?.response
  const contentType = res?.ok ? (res.headers.find((h) => h.key.toLowerCase() === 'content-type')?.value ?? '') : ''
  const view = useMemo(() => (res?.ok ? viewBody(res.body, settings.general.responseFormat === 'json' ? 'application/json' : contentType) : null), [res, contentType, settings.general.responseFormat])
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
  const titleRow = (
    <div className="response-title-row">
      <span className="response-title">Response</span>
      {examples.length > 0 && <select className="select" aria-label="Saved examples" value={selectedExample ?? ''} onChange={e => setSelectedExample(e.target.value === '' ? null : Number(e.target.value))}><option value="">Live response</option>{examples.map((example, index) => <option key={index} value={index}>{String((example as { name?: string })?.name ?? `Example ${index + 1}`)}</option>)}</select>}
      <HistoryButton past={past} current={report} onShow={onShowPast} />
      <span className="spacer" />
      {report && <MoreButton items={[{ label: 'Clear response', onClick: clear }]} />}
    </div>
  )
  if (!report || !res) {
    return (
      <div className="response">
        {titleRow}
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
        {titleRow}
        {scriptErrors}
        <div className="response-center grow" data-testid="response-error">
          <p className="error-title">Could not send request</p>
          <p className="error-detail">
            {res.code && <code>{res.code}</code>} {cleanError(res.error)}
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
          <b data-testid="response-status" className={`status-pill ${res.code < 400 ? 'ok' : 'bad'}`}>
            {res.code} {res.status}
          </b>
          <span className="meta-sep">·</span>
          <span title="Time">{Math.round(res.timeMs)} ms</span>
          <span className="meta-sep">·</span>
          <span title="Size">{formatBytes(res.size)}</span>
          {examples.length > 0 && <select className="select" aria-label="Saved examples" value={selectedExample ?? ''} onChange={e => setSelectedExample(e.target.value === '' ? null : Number(e.target.value))}><option value="">Live response</option>{examples.map((example, index) => <option key={index} value={index}>{String((example as { name?: string })?.name ?? `Example ${index + 1}`)}</option>)}</select>}
      <HistoryButton past={past} current={report} onShow={onShowPast} />
          <MoreButton
            items={[
              ...(selectedExample === null ? [{ label: 'Save as example', onClick: onSaveExample }] : []),
              { label: 'Save response to file', onClick: () => onSaveBody(report) },
              'separator',
              { label: 'Clear response', onClick: clear },
            ]}
          />
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
            <span role="status">{feedback}</span>
            {view?.kind === 'text' && mode !== 'preview' && <button className="btn-icon" aria-label="Search response body" title="Find (Ctrl/Cmd+F)" onClick={() => editor.current && openSearchPanel(editor.current)}><Search size={14} /></button>}
            {view?.kind === 'text' && (
              <button className="btn-icon" aria-label="Copy response body" title="Copy" onClick={() => void navigator.clipboard.writeText(view.text).then(() => setFeedback('Copied')).catch(e => setFeedback(cleanError(e)))}>
                <Copy size={14} />
              </button>
            )}
          </div>
          {view?.kind === 'text' && view.truncated && <div className="notice">Response is larger than 2 MB; showing the first 2 MB. Use “Save response to file” for the rest.</div>}
          {isImage && imageUrl && mode === 'pretty' ? <div className="preview-image"><img src={imageUrl} alt="Response preview" /></div> : mode === 'preview' ? (
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
            <div className="muted-note">Binary response ({formatBytes(view.size)}) — {isImage ? 'select Pretty or Preview to view the image.' : 'use “Save response to file” to open it.'}</div>
          ) : view?.kind === 'text' ? (
            <div className="code-view" data-testid="response-body" tabIndex={0} onKeyDownCapture={e => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'f') { e.preventDefault(); if (editor.current) openSearchPanel(editor.current) } }}>
              <CodeEditor editorRef={editor} readOnly ariaLabel="Response body" language={mode === 'pretty' ? lang : 'text'} value={mode === 'pretty' ? view.pretty : view.text} />
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
                {f[0].toUpperCase() + f.slice(1)} ({f === 'all' ? tests.length : f === 'passed' ? passed : f === 'skipped' ? tests.filter(t => t.skipped).length : tests.filter(t => !t.passed && !t.skipped).length})
              </button>
            ))}
          </div>
          {tests.length === 0 ? (
            <div className="muted-note">There are no tests for this request. Write a test script in Scripts &gt; After response.</div>
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

function exampleReport(value: unknown): RunReport | undefined {
  if (!value || typeof value !== 'object') return undefined
  const example = value as { code?: number; status?: string; body?: string; header?: { key: string; value: string }[] }
  const body = new TextEncoder().encode(example.body ?? '')
  return { response: { ok: true, code: example.code ?? 200, status: example.status ?? 'OK', headers: example.header ?? [], body, size: body.length, timeMs: 0 }, tests: [], logs: [], scriptErrors: [], cookies: [] }
}
