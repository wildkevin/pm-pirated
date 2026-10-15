import { ChevronDown, ChevronRight, X } from 'lucide-react'
import { useState } from 'react'
import type { LogEntry, RunReport } from '../../shared/engine'
import { formatBytes } from '../lib/body'
import { methodClass } from '../lib/methods'

export interface ConsoleEntry {
  id: number
  ts: number
  method: string
  url: string
  report: RunReport
}

type Level = 'all' | LogEntry['level']

const decoder = new TextDecoder()

/** Bottom console: requests as sent (after variables/scripts), their responses, and script console output. */
export function Console({ entries, onClear, onClose }: { entries: ConsoleEntry[]; onClear(): void; onClose(): void }) {
  const [level, setLevel] = useState<Level>('all')
  const [open, setOpen] = useState<Set<number>>(new Set())
  const toggle = (id: number) =>
    setOpen((prev) => {
      const next = new Set(prev)
      if (!next.delete(id)) next.add(id)
      return next
    })
  return (
    <div className="console" role="region" aria-label="Console">
      <div className="console-head">
        <span className="console-title">Console</span>
        <span className="spacer" />
        <select aria-label="Log level" className="select" value={level} onChange={(e) => setLevel(e.target.value as Level)}>
          <option value="all">All Logs</option>
          <option value="log">Log</option>
          <option value="info">Info</option>
          <option value="warn">Warning</option>
          <option value="error">Error</option>
        </select>
        <button className="btn btn-small" onClick={onClear} disabled={!entries.length}>
          Clear
        </button>
        <button className="btn-icon" aria-label="Close console" onClick={onClose}>
          <X size={14} />
        </button>
      </div>
      <div className="console-body">
        {entries.length === 0 && (
          <div className="muted-note">
            <b>No logs yet</b>
            <br />
            Send a request to view its details in the console.
          </div>
        )}
        {entries.map((e) => {
          const r = e.report
          const res = r.response
          const logs = r.logs.filter((l) => level === 'all' || l.level === level)
          return (
            <div key={e.id} className="console-entry">
              {logs.map((l, i) => (
                <div key={i} className={`console-log level-${l.level}`}>
                  {l.args.join(' ')}
                </div>
              ))}
              {r.scriptErrors.map((s, i) => (
                <div key={`e${i}`} className="console-log level-error">
                  {s}
                </div>
              ))}
              {level === 'all' && (
                <>
                  <div className="console-request" onClick={() => toggle(e.id)}>
                    {open.has(e.id) ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                    <span className={methodClass(e.method)}>{e.method}</span>
                    <span className="console-url">{r.sent?.url ?? e.url}</span>
                    <span className="spacer" />
                    {res.ok ? (
                      <span className={res.code < 400 ? 'status-ok' : 'status-bad'}>
                        {res.code} · {Math.round(res.timeMs)} ms · {formatBytes(res.size)}
                      </span>
                    ) : (
                      <span className="status-bad">Error: {res.error}</span>
                    )}
                  </div>
                  {open.has(e.id) && (
                    <div className="console-details">
                      {r.sent && (
                        <>
                          <div className="console-section">Request Headers</div>
                          {r.sent.headers.map((h, i) => (
                            <div key={i} className="console-kv">
                              <b>{h.key}:</b> {h.value}
                            </div>
                          ))}
                          {r.sent.body && (
                            <>
                              <div className="console-section">Request Body</div>
                              <pre className="console-pre">{r.sent.body.slice(0, 10_000)}</pre>
                            </>
                          )}
                        </>
                      )}
                      {res.ok && (
                        <>
                          <div className="console-section">Response Headers</div>
                          {res.headers.map((h, i) => (
                            <div key={i} className="console-kv">
                              <b>{h.key}:</b> {h.value}
                            </div>
                          ))}
                          <div className="console-section">Response Body</div>
                          <pre className="console-pre">{decoder.decode(res.body.subarray(0, 10_000))}</pre>
                        </>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
