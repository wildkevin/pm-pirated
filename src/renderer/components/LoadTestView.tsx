import './operational.css'
import { NumberField } from './common/NumberField'
import { Play, Square, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { TreeNode, WorkspaceInfo } from '../../shared/format/types'
import type { DataPreview, LoadInfo, LoadRecord } from '../../shared/ipc'
import type { LoadSummary, Tick } from '../../loadtest/metrics'
import { MAX_DURATION_SEC, MAX_VUS, profileSeries, type LoadProfile, type ProfileKind } from '../../loadtest/profile'
import { cleanError } from '../lib/body'
import { onLoadEvent } from '../lib/runnerBus'
import { LineChart } from './common/LineChart'
import { containerOptions } from './MockView'

function requestIds(nodes: TreeNode[], target: string): string[] {
  const out: string[] = []
  const walk = (list: TreeNode[], inside: boolean) => {
    for (const n of list) {
      const here = inside || n.id === target
      if (n.kind === 'request' && here) out.push(n.id)
      if (n.children) walk(n.children, here)
    }
  }
  walk(nodes, false)
  return out
}

const PROFILES: { kind: ProfileKind; label: string; help: string }[] = [
  { kind: 'fixed', label: 'Fixed', help: 'The same number of virtual users for the whole test.' },
  { kind: 'ramp-up', label: 'Ramp up', help: 'Start with one virtual user and increase steadily.' },
  { kind: 'spike', label: 'Spike', help: 'A sudden burst to the maximum in the middle of the test.' },
  { kind: 'peak', label: 'Peak', help: 'Increase to the maximum, hold it, then decrease.' },
]

interface Props {
  workspace: WorkspaceInfo
  target: string
  onTarget(id: string): void
  activeEnvironment: string | null
  onError(e: unknown): void
}

export function LoadTestView({ workspace, target, onTarget, activeEnvironment, onError }: Props) {
  const [profile, setProfile] = useState<LoadProfile>({ kind: 'fixed', vus: 10, durationSec: 30, rampUpSec: 10, baseShare: 0.2 })
  const [environmentId, setEnvironmentId] = useState<string | null>(activeEnvironment)
  const [dataFile, setDataFile] = useState<string | null>(null)
  const [preview, setPreview] = useState<DataPreview | null>(null)
  const [record, setRecord] = useState<LoadRecord | null>(null)
  const [running, setRunning] = useState(false)
  const [past, setPast] = useState<LoadInfo[]>([])
  const runIdRef = useRef<string | null>(null)
  const ids = useMemo(() => requestIds(workspace.collections, target), [workspace, target])
  const reloadPast = () => window.api.listLoadTests().then(setPast, onError)
  useEffect(() => void reloadPast(), [])

  useEffect(
    () =>
      onLoadEvent((e) => {
        if (e.runId !== runIdRef.current) return
        if ('tick' in e) setRecord((r) => (r ? { ...r, ticks: [...r.ticks, e.tick] } : r))
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
    try {
      setRunning(true)
      setRecord({ id: '', name: '', startedAt: Date.now(), profile, environment: null, summary: null, ticks: [] })
      const id = await window.api.startLoadTest({ target, requestIds: ids, environmentId, profile, dataFile })
      runIdRef.current = id
      setRecord((r) => r ? { ...r, id } : r)
    } catch (e) {
      setRunning(false)
      setRecord(null)
      onError(cleanError(e))
    }
  }

  const pickData = async () => {
    try {
      const file = await window.api.pickFile('Select data file (CSV or JSON)')
      if (!file) return
      const next = await window.api.previewDataFile(file)
      setDataFile(file)
      setPreview(next)
    } catch (e) { onError(cleanError(e)) }
  }

  const set = (patch: Partial<LoadProfile>) => setProfile((p) => ({ ...p, ...patch }))
  const ticks = record?.ticks ?? []

  return (
    <div className="runner loadtest">
      <div className="runner-config">
        <div className="section-title">Performance test</div>
        <label className="field-label" htmlFor="load-target">
          Collection or folder
        </label>
        <select id="load-target" className="select wide" value={target} onChange={(e) => onTarget(e.target.value)}>
          {containerOptions(workspace.collections).map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </select>
        <div className="muted data-preview-left">{ids.length} {ids.length === 1 ? 'request' : 'requests'} per iteration</div>
        <div className="form-row">
          <label className="field-label" htmlFor="load-vus">
            Virtual users
          </label>
          <NumberField id="load-vus" min={1} max={MAX_VUS} value={profile.vus} onChange={(vus) => set({ vus })} />
        </div>
        <div className="form-row">
          <label className="field-label" htmlFor="load-duration">
            Duration (s)
          </label>
          <NumberField id="load-duration" min={1} max={MAX_DURATION_SEC} value={profile.durationSec} onChange={(durationSec) => set({ durationSec })} />
        </div>
        <div className="field-label">Load profile</div>
        <div className="chips">
          {PROFILES.map((p) => (
            <button key={p.kind} className={`chip${profile.kind === p.kind ? ' on' : ''}`} onClick={() => set({ kind: p.kind })}>
              {p.label}
            </button>
          ))}
        </div>
        <p className="muted">{PROFILES.find((p) => p.kind === profile.kind)?.help}</p>
        {profile.kind === 'ramp-up' && (
          <div className="form-row">
            <label className="field-label" htmlFor="load-ramp">
              Ramp up (s)
            </label>
            <NumberField id="load-ramp" min={1} max={profile.durationSec} value={profile.rampUpSec ?? 10} onChange={(rampUpSec) => set({ rampUpSec })} />
          </div>
        )}
        {(profile.kind === 'spike' || profile.kind === 'peak') && (
          <div className="form-row">
            <label className="field-label" htmlFor="load-base">
              Base load (%)
            </label>
            <input id="load-base" className="input small" type="number" min={0} max={100} value={Math.round((profile.baseShare ?? 0.2) * 100)} onChange={(e) => set({ baseShare: Math.min(1, Math.max(0, (Number(e.target.value) || 0) / 100)) })} />
          </div>
        )}
        <LineChart ariaLabel="Load profile preview" height={90} series={[{ label: 'Peak virtual users', legendValue: profile.vus, color: 'var(--brand)', values: profileSeries(profile) }]} />
        <div className="form-row">
          <label className="field-label" htmlFor="load-env">
            Environment
          </label>
          <select id="load-env" className="select" value={environmentId ?? ''} onChange={(e) => setEnvironmentId(e.target.value || null)}>
            <option value="">No Environment</option>
            {workspace.environments.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
          </select>
        </div>
        <div className="form-row">
          <span className="field-label">Data</span>
          <button className="file-pick" onClick={() => void pickData()}>
            {dataFile ? dataFile.split(/[\\/]/).pop() : 'Select File'}
          </button>
          {dataFile && (
            <button className="btn-icon" aria-label="Remove data file" onClick={() => { setDataFile(null); setPreview(null) }}>
              ×
            </button>
          )}
        </div>
        {preview && <div className="muted data-preview">{preview.count} rows · columns: {preview.columns.join(', ')}</div>}
        {running ? (
          <button className="btn btn-secondary run-btn" onClick={() => runIdRef.current && void window.api.stopLoadTest(runIdRef.current)}>
            <Square size={12} /> Stop
          </button>
        ) : (
          <button className="btn btn-primary run-btn" disabled={!ids.length} onClick={() => void start()}>
            <Play size={12} /> Run
          </button>
        )}
        {past.length > 0 && (
          <>
            <div className="section-title">Past tests</div>
            <div className="past-runs">
              {past.map((p) => (
                <div key={p.id} className="past-run" onClick={() => window.api.readLoadTest(p.id).then((r) => ((runIdRef.current = null), setRecord(r)), onError)}>
                  <span className="tree-name">
                    {p.name} <span className="muted">· {PROFILES.find((profile) => profile.kind === p.profile.kind)?.label} · {p.profile.vus} VUs · {p.profile.durationSec}s · {new Date(p.startedAt).toLocaleString()}</span>
                  </span>
                  {p.summary && <span className="muted">{p.summary.avgMs} ms</span>}
                  <button
                    className="btn-icon"
                    aria-label="Delete load test"
                    onClick={(e) => {
                      e.stopPropagation()
                      void window.api.deleteLoadTest(p.id).then(reloadPast, onError)
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

      <div className="runner-results" data-testid="load-results">
        {!record ? (
          <div className="muted-note">Simulate traffic with virtual users that loop the collection. Results update every second.</div>
        ) : (
          <LoadResults ticks={ticks} summary={record.summary} running={running} />
        )}
      </div>
    </div>
  )
}

function LoadResults({ ticks, summary, running }: { ticks: Tick[]; summary: LoadSummary | null; running: boolean }) {
  const totals = ticks.reduce((a, t) => ({ requests: a.requests + t.requests, errors: a.errors + t.errors }), { requests: 0, errors: 0 })
  const last = ticks[ticks.length - 1]
  const cards: [string, string][] = summary
    ? [
        ['Total requests', String(summary.totalRequests)],
        ['Throughput', `${summary.throughput} req/s`],
        ['Avg. response time', `${summary.avgMs} ms`],
        ['P90', `${summary.p90Ms} ms`],
        ['P95', `${summary.p95Ms} ms`],
        ['P99', `${summary.p99Ms} ms`],
        ['Error rate', `${summary.errorRate}%`],
        ['Virtual users', `${summary.maxVus}`],
      ]
    : [
        ['Total requests', String(totals.requests)],
        ['Throughput', `${last?.requests ?? 0} req/s`],
        ['Avg. response time', `${last?.avgMs ?? 0} ms`],
        ['P90', `${last?.p90Ms ?? 0} ms`],
        ['P95', `${last?.p95Ms ?? 0} ms`],
        ['P99', `${last?.p99Ms ?? 0} ms`],
        ['Error rate', `${totals.requests ? Math.round((totals.errors / totals.requests) * 1000) / 10 : 0}%`],
        ['Virtual users', `${last?.vus ?? 0}`],
      ]
  return (
    <>
      <div className="run-title">
        {running ? 'Running…' : summary?.stopped ? 'Stopped' : summary ? 'Completed' : ''}
        {last && <span className="muted"> · {last.second}s · CPU {last.cpuPercent}%</span>}
      </div>
      {summary?.warning && (
        <div className="notice" role="alert">
          {summary.warning}
        </div>
      )}
      <div className="metric-cards" data-testid="load-cards">
        {cards.map(([k, v]) => (
          <div key={k} className="metric-card">
            <div className="muted">{k}</div>
            <div className="metric-value">{v}</div>
          </div>
        ))}
      </div>
      <LineChart
        ariaLabel="Throughput and response time"
        series={[
          { label: 'Requests/s', color: 'var(--send)', values: ticks.map((t) => t.requests) },
          { label: 'Avg. response (ms)', color: 'var(--brand)', values: ticks.map((t) => t.avgMs) },
          { label: 'P90 (ms)', color: 'var(--method-patch)', values: ticks.map((t) => t.p90Ms) },
        ]}
      />
      <LineChart ariaLabel="Virtual users and errors" height={90} series={[
        { label: 'Virtual users', color: 'var(--success)', values: ticks.map((t) => t.vus) },
        { label: 'Errors/s', color: 'var(--error)', values: ticks.map((t) => t.errors) },
      ]} />
      {summary && summary.requests.length > 0 && (
        <div className="load-table-scroll"><table className="kv kv-readonly load-table">
          <thead>
            <tr>
              <th>Request</th>
              <th>Count</th>
              <th>Avg</th>
              <th>Min</th>
              <th>Max</th>
              <th>P90</th>
              <th>P95</th>
              <th>Errors</th>
            </tr>
          </thead>
          <tbody>
            {summary.requests.map((r) => (
              <tr key={r.requestId}>
                <td>{r.name}</td>
                <td>{r.count}</td>
                <td>{r.avgMs} ms</td>
                <td>{r.minMs} ms</td>
                <td>{r.maxMs} ms</td>
                <td>{r.p90Ms} ms</td>
                <td>{r.p95Ms} ms</td>
                <td className={r.errors ? 'status-bad' : undefined}>{r.errors}</td>
              </tr>
            ))}
          </tbody>
        </table></div>
      )}
    </>
  )
}
