import { ChevronDown, ChevronRight, Copy, Maximize2, MoreHorizontal, X } from 'lucide-react'
import { useState } from 'react'
import type { LogEntry, RunReport } from '../../shared/engine'
import { cleanError, formatBytes } from '../lib/body'
import { methodClass } from '../lib/methods'
import { Menu, Modal } from './common/ui'
import './Console.css'

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
  const [feedback, setFeedback] = useState('')
  const [expanded, setExpanded] = useState(false)
  const [menu, setMenu] = useState<DOMRect | null>(null)
  const exchanges: ConsoleEntry[] = entries.flatMap(e => e.report.timeline?.length ? e.report.timeline.map((event, index) => ({ ...e, id: e.id * 10000 + index, method: event.kind === 'request' ? event.sent.method : e.method, report: event.kind === 'log' ? { ...e.report, logs: [event.log], timeline: undefined, scriptErrors: [], sent: undefined } : { ...e.report, logs: [], timeline: undefined, scriptErrors: [], sent: event.sent, response: event.response }, logOnly: event.kind === 'log' })) : [e])
  const copyAll = async () => {
    try { await navigator.clipboard.writeText(entries.map(e => JSON.stringify(e.report, null, 2)).join('\n')); setFeedback('Copied') }
    catch (error) { setFeedback(cleanError(error)) }
  }
  const toggle = (id: number) =>
    setOpen((prev) => {
      const next = new Set(prev)
      if (!next.delete(id)) next.add(id)
      return next
    })
  const content = (
    <div className="console" role="region" aria-label="Console">
      <div className="console-head">
        <span className="console-title">Console</span>
        <span className="spacer" />
        <span role="status">{feedback}</span>
        <button className="btn-icon" aria-label="Copy console" disabled={!entries.length} onClick={() => void copyAll()}><Copy size={14} /></button>
        <button className="btn-icon" aria-label="Console options" onClick={e => setMenu(e.currentTarget.getBoundingClientRect())}><MoreHorizontal size={14} /></button>
        {menu && <Menu style={{ left: menu.left, top: menu.bottom }} onClose={() => setMenu(null)} items={[{ label: 'Expand all requests', onClick: () => setOpen(new Set(exchanges.map(e => e.id))) }, { label: 'Collapse all requests', onClick: () => setOpen(new Set()) }, { label: 'Clear console', onClick: onClear }]} />}
        <button className="btn-icon" aria-label={expanded ? 'Dock console' : 'Expand console'} onClick={() => setExpanded(!expanded)}><Maximize2 size={14} /></button>
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
        {exchanges.map((e) => {
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
              {level === 'all' && !(e as ConsoleEntry & { logOnly?: boolean }).logOnly && (
                <>
                  <div className="console-request" role="button" tabIndex={0} aria-expanded={open.has(e.id)} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); toggle(e.id) } }} onClick={() => toggle(e.id)}>
                    {open.has(e.id) ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                    <span className={methodClass(e.method)}>{e.method}</span>
                    <span className="console-url">{r.sent?.url ?? e.url}</span>
                    <span className="spacer" />
                    {res.ok ? (
                      <span className={res.code < 400 ? 'status-ok' : 'status-bad'}>
                        {res.code} · {Math.round(res.timeMs)} ms · {formatBytes(res.size)}
                      </span>
                    ) : (
                      <span className="status-bad">Error: {cleanError(res.error)}</span>
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
        {entries.filter(e => e.report.timeline?.length).flatMap(e => e.report.scriptErrors.map((error, i) => <div key={`${e.id}-error-${i}`} className="console-log level-error">{error}</div>))}
      </div>
    </div>
  )
  return expanded ? <Modal title="Console" className="console-modal" wide onClose={() => setExpanded(false)}>{content}</Modal> : content
}
