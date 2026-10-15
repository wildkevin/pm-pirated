import { ChevronDown, ChevronRight, Play, Square, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { RunnerItemResult, RunnerSummary } from '../../shared/engine'
import type { EnvironmentInfo, TreeNode, WorkspaceInfo } from '../../shared/format/types'
import type { DataPreview, RunConfig, RunInfo, RunRecord } from '../../shared/ipc'
import { cleanError, formatBytes } from '../lib/body'
import { methodClass, methodLabel } from '../lib/methods'
import { onRunnerEvent } from '../lib/runnerBus'

interface Props {
  workspace: WorkspaceInfo
  target: string
  onTarget(id: string): void
  activeEnvironment: string | null
  onError(e: unknown): void
}

type Filter = 'all' | 'passed' | 'failed'

/** Collections and folders, flattened for the target picker. */
function containers(nodes: TreeNode[], depth = 0, out: { id: string; label: string }[] = []) {
  for (const n of nodes) {
    if (n.kind === 'request') continue
    out.push({ id: n.id, label: `${'  '.repeat(depth)}${n.name}` })
    containers(n.children ?? [], depth + 1, out)
  }
  return out
}

function findNode(nodes: TreeNode[], id: string): TreeNode | undefined {
  for (const n of nodes) {
    if (n.id === id) return n
    const hit = n.children && findNode(n.children, id)
    if (hit) return hit
  }
  return undefined
}

function requestsUnder(node: TreeNode | undefined, prefix: string[] = []): { id: string; name: string; method: string; path: string }[] {
  if (!node) return []
  if (node.kind === 'request') return [{ id: node.id, name: node.name, method: node.method ?? 'GET', path: prefix.join(' / ') }]
  return (node.children ?? []).flatMap((c) => requestsUnder(c, node.kind === 'folder' ? [...prefix, node.name] : prefix))
}

export function RunnerView({ workspace, target, onTarget, activeEnvironment, onError }: Props) {
  const node = findNode(workspace.collections, target)
  const requests = useMemo(() => requestsUnder(node), [node])
  const [selected, setSelected] = useState<Set<string>>(() => new Set(requests.map((r) => r.id)))
  const [iterations, setIterations] = useState(1)
  const [delayMs, setDelayMs] = useState(0)
  const [dataFile, setDataFile] = useState<string | null>(null)
  const [preview, setPreview] = useState<DataPreview | null>(null)
  const [environmentId, setEnvironmentId] = useState<string | null>(activeEnvironment)
  const [persistResponses, setPersist] = useState(false)
  const [keepVariables, setKeep] = useState(true)
  const [stopOnError, setStopOnError] = useState(false)

  const [runId, setRunId] = useState<string | null>(null)
  // The id is known before React re-renders; results may arrive in between.
  const runIdRef = useRef<string | null>(null)
  const [record, setRecord] = useState<RunRecord | null>(null)
  const [running, setRunning] = useState(false)
  const [filter, setFilter] = useState<Filter>('all')
  const [open, setOpen] = useState<Set<number>>(new Set())
  const [past, setPast] = useState<RunInfo[]>([])

  useEffect(() => setSelected(new Set(requests.map((r) => r.id))), [requests])
  const reloadPast = () => window.api.listRuns().then(setPast, onError)
  useEffect(() => void reloadPast(), [])

  useEffect(
    () =>
      onRunnerEvent((e) => {
        if (e.runId !== runIdRef.current) return
        if ('item' in e) setRecord((r) => (r ? { ...r, results: [...r.results, e.item] } : r))
        else if ('done' in e) {
          setRecord((r) => (r ? { ...r, summary: e.done } : r))
          setRunning(false)
          void reloadPast()
        } else {
          setRunning(false)
          onError(e.error)
        }
      }),
    [],
  )

  const start = async () => {
    const config: RunConfig = {
      target,
      requestIds: requests.filter((r) => selected.has(r.id)).map((r) => r.id),
      environmentId,
      iterations,
      delayMs,
      dataFile,
      persistResponses,
      keepVariables,
      stopOnError,
    }
    try {
      setRunning(true)
      setOpen(new Set())
      setRecord({ id: '', name: node?.name ?? '', startedAt: Date.now(), target, environment: null, config, summary: null, results: [] })
      const id = await window.api.startRun(config)
      runIdRef.current = id
      setRunId(id)
    } catch (e) {
      setRunning(false)
      onError(e)
    }
  }

  const pickData = async () => {
    const file = await window.api.pickFile('Select data file (CSV or JSON)')
    if (!file) return
    try {
      const p = await window.api.previewDataFile(file)
      setDataFile(file)
      setPreview(p)
      setIterations(Math.max(1, p.count))
    } catch (e) {
      onError(cleanError(e))
    }
  }

  const results = record?.results ?? []
  const shown = results
    .map((r, i) => ({ r, i }))
    .filter(({ r }) => filter === 'all' || (filter === 'passed' ? !r.error && r.tests.every((t) => t.passed || t.skipped) : r.error || r.tests.some((t) => !t.passed && !t.skipped)))

  return (
    <div className="runner">
      <div className="runner-config">
        <div className="section-title">Runner</div>
        <label className="field-label" htmlFor="run-target">
          Collection or folder
        </label>
        <select id="run-target" className="select wide" value={target} onChange={(e) => onTarget(e.target.value)}>
          {containers(workspace.collections).map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </select>

        <div className="run-order-head">
          <span className="field-label">Run order</span>
          <span className="spacer" />
          <button className="link-btn" onClick={() => setSelected(new Set(requests.map((r) => r.id)))}>
            Select All
          </button>
          <button className="link-btn" onClick={() => setSelected(new Set())}>
            Deselect All
          </button>
        </div>
        <div className="run-order" role="list" aria-label="Run order">
          {requests.length === 0 && <div className="muted">No requests here.</div>}
          {requests.map((r) => (
            <label key={r.id} className="run-order-row" role="listitem">
              <input
                type="checkbox"
                checked={selected.has(r.id)}
                onChange={(e) =>
                  setSelected((prev) => {
                    const next = new Set(prev)
                    e.target.checked ? next.add(r.id) : next.delete(r.id)
                    return next
                  })
                }
              />
              <span className={methodClass(r.method)}>{methodLabel(r.method)}</span>
              <span className="tree-name">
                {r.path && <span className="muted">{r.path} / </span>}
                {r.name}
              </span>
            </label>
          ))}
        </div>

        <div className="form-row">
          <label className="field-label" htmlFor="run-iterations">
            Iterations
          </label>
          <input id="run-iterations" className="input small" type="number" min={1} value={iterations} onChange={(e) => setIterations(Math.max(1, Number(e.target.value) || 1))} />
        </div>
        <div className="form-row">
          <label className="field-label" htmlFor="run-delay">
            Delay (ms)
          </label>
          <input id="run-delay" className="input small" type="number" min={0} value={delayMs} onChange={(e) => setDelayMs(Math.max(0, Number(e.target.value) || 0))} />
        </div>
        <div className="form-row">
          <span className="field-label">Data</span>
          <button className="file-pick" onClick={() => void pickData()}>
            {dataFile ? dataFile.split(/[\\/]/).pop() : 'Select File'}
          </button>
          {dataFile && (
            <button className="btn-icon" aria-label="Remove data file" onClick={() => (setDataFile(null), setPreview(null))}>
              ×
            </button>
          )}
        </div>
        {preview && (
          <div className="muted data-preview">
            {preview.count} rows · columns: {preview.columns.join(', ') || '—'}
          </div>
        )}
        <div className="form-row">
          <label className="field-label" htmlFor="run-env">
            Environment
          </label>
          <select id="run-env" className="select" value={environmentId ?? ''} onChange={(e) => setEnvironmentId(e.target.value || null)}>
            <option value="">No Environment</option>
            {workspace.environments.map((e: EnvironmentInfo) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
          </select>
        </div>
        <label className="check">
          <input type="checkbox" checked={persistResponses} onChange={(e) => setPersist(e.target.checked)} /> Persist responses for this run
        </label>
        <label className="check">
          <input type="checkbox" checked={keepVariables} onChange={(e) => setKeep(e.target.checked)} /> Keep variable values
        </label>
        <label className="check">
          <input type="checkbox" checked={stopOnError} onChange={(e) => setStopOnError(e.target.checked)} /> Stop run if an error occurs
        </label>
        {running ? (
          <button className="btn btn-secondary run-btn" onClick={() => runId && void window.api.stopRun(runId)}>
            <Square size={12} /> Stop
          </button>
        ) : (
          <button className="btn btn-primary run-btn" disabled={selected.size === 0} onClick={() => void start()}>
            <Play size={12} /> Run {node?.name ?? ''}
          </button>
        )}

        {past.length > 0 && (
          <>
            <div className="section-title">Past runs</div>
            <div className="past-runs">
              {past.map((p) => (
                <div key={p.id} className="past-run" onClick={() => window.api.readRun(p.id).then((r) => {
                  runIdRef.current = null
                  setRunId(null)
                  setRecord(r)
                }, onError)}>
                  <span className="tree-name">
                    {p.name} <span className="muted">· {new Date(p.startedAt).toLocaleString()}</span>
                  </span>
                  {p.summary && (
                    <span className={p.summary.testsFailed || p.summary.errors ? 'status-bad' : 'status-ok'}>
                      {p.summary.testsPassed}/{p.summary.testsPassed + p.summary.testsFailed}
                    </span>
                  )}
                  <button
                    className="btn-icon"
                    aria-label="Delete run"
                    onClick={(e) => {
                      e.stopPropagation()
                      void window.api.deleteRun(p.id).then(reloadPast, onError)
                    }}
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      <div className="runner-results" data-testid="runner-results">
        {!record ? (
          <div className="muted-note">Choose requests and click Run. Results appear here as each request completes.</div>
        ) : (
          <>
            <RunSummaryBar record={record} running={running} onExport={record.id ? () => void window.api.exportRun(record.id).catch(onError) : undefined} />
            <div className="body-toolbar">
              {(['all', 'passed', 'failed'] as const).map((f) => (
                <button key={f} className={`pill${filter === f ? ' active' : ''}`} onClick={() => setFilter(f)}>
                  {f[0].toUpperCase() + f.slice(1)}
                </button>
              ))}
            </div>
            <div className="run-results">
              {shown.map(({ r, i }) => (
                <ResultRow
                  key={i}
                  r={r}
                  showIteration={i === 0 || results[i - 1].iteration !== r.iteration}
                  open={open.has(i)}
                  onToggle={() =>
                    setOpen((prev) => {
                      const next = new Set(prev)
                      if (!next.delete(i)) next.add(i)
                      return next
                    })
                  }
                />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function RunSummaryBar({ record, running, onExport }: { record: RunRecord; running: boolean; onExport?(): void }) {
  const s: RunnerSummary | null = record.summary
  const results = record.results
  const passed = s?.testsPassed ?? results.reduce((n, r) => n + r.tests.filter((t) => t.passed && !t.skipped).length, 0)
  const failed = s?.testsFailed ?? results.reduce((n, r) => n + r.tests.filter((t) => !t.passed && !t.skipped).length, 0)
  return (
    <div className="run-summary">
      <div className="run-title">
        {record.name}
        <span className="muted"> · {running ? 'Running…' : s?.stopped ? 'Stopped' : s ? 'Completed' : ''}</span>
      </div>
      <div className="run-stats">
        <span>
          Iterations <b>{s?.iterations ?? Math.max(0, ...results.map((r) => r.iteration + 1))}</b>
        </span>
        <span>
          Duration <b>{s ? `${(s.durationMs / 1000).toFixed(1)}s` : '…'}</b>
        </span>
        <span>
          All tests <b>{passed + failed}</b>
        </span>
        <span className="status-ok">
          Passed <b data-testid="run-passed">{passed}</b>
        </span>
        <span className="status-bad">
          Failed <b data-testid="run-failed">{failed}</b>
        </span>
        <span>
          Avg. Resp. Time <b>{s ? `${s.avgResponseMs} ms` : '…'}</b>
        </span>
        <span className="spacer" />
        {onExport && !running && (
          <button className="btn btn-small" onClick={onExport}>
            Export Results
          </button>
        )}
      </div>
    </div>
  )
}

function ResultRow({ r, showIteration, open, onToggle }: { r: RunnerItemResult; showIteration: boolean; open: boolean; onToggle(): void }) {
  return (
    <>
      {showIteration && <div className="run-iteration">Iteration {r.iteration + 1}</div>}
      <div className="run-row" data-testid="run-row" onClick={onToggle}>
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <span className={methodClass(r.method || 'GET')}>{r.method}</span>
        <span className="run-name">{r.name}</span>
        <span className="run-url muted">{r.url}</span>
        <span className="spacer" />
        {r.error ? (
          <span className="status-bad">{r.error}</span>
        ) : (
          <span className="muted">
            <span className={r.code! < 400 ? 'status-ok' : 'status-bad'}>
              {r.code} {r.status}
            </span>{' '}
            · {Math.round(r.timeMs ?? 0)} ms · {formatBytes(r.size ?? 0)}
          </span>
        )}
      </div>
      {(r.tests.length > 0 || r.scriptErrors.length > 0) && (
        <ul className="test-list run-tests">
          {r.scriptErrors.map((e, i) => (
            <li key={`e${i}`}>
              <span className="test-badge fail">ERROR</span> {e}
            </li>
          ))}
          {r.tests.map((t, i) => (
            <li key={i}>
              <span className={`test-badge ${t.skipped ? 'skip' : t.passed ? 'pass' : 'fail'}`}>{t.skipped ? 'SKIPPED' : t.passed ? 'PASS' : 'FAIL'}</span>
              <span>{t.name}</span>
              {t.error && <span className="test-error">| {t.error}</span>}
            </li>
          ))}
        </ul>
      )}
      {open && (
        <div className="console-details run-details">
          {r.sent && (
            <>
              <div className="console-section">Request Headers</div>
              {r.sent.headers.map((h, i) => (
                <div key={i} className="console-kv">
                  <b>{h.key}:</b> {h.value}
                </div>
              ))}
              {r.sent.body && <pre className="console-pre">{r.sent.body}</pre>}
            </>
          )}
          {r.response ? (
            <>
              <div className="console-section">Response Headers</div>
              {r.response.headers.map((h, i) => (
                <div key={i} className="console-kv">
                  <b>{h.key}:</b> {h.value}
                </div>
              ))}
              <div className="console-section">Response Body</div>
              <pre className="console-pre">{r.response.body}</pre>
            </>
          ) : (
            <div className="muted">Turn on “Persist responses” to keep response bodies.</div>
          )}
          {r.logs.length > 0 && (
            <>
              <div className="console-section">Console</div>
              {r.logs.map((l, i) => (
                <div key={i} className={`console-log level-${l.level}`}>
                  {l.args.join(' ')}
                </div>
              ))}
            </>
          )}
        </div>
      )}
    </>
  )
}
