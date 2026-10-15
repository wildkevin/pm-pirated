import { Copy, Play, Save, Square } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { TreeNode, WorkspaceInfo } from '../../shared/format/types'
import type { MockDefinition, MockInfo, MockLogEntry, MockRoute } from '../../shared/mock'
import { methodClass } from '../lib/methods'
import { Modal, Toggle } from './common/ui'

export function containerOptions(nodes: TreeNode[], depth = 0, out: { id: string; label: string }[] = []) {
  for (const n of nodes) {
    if (n.kind === 'request') continue
    out.push({ id: n.id, label: `${'  '.repeat(depth)}${n.name}` })
    containerOptions(n.children ?? [], depth + 1, out)
  }
  return out
}

function MockForm({ def, workspace, onChange }: { def: MockDefinition; workspace: WorkspaceInfo; onChange(d: MockDefinition): void }) {
  return (
    <div className="mock-form">
      <div className="form-row">
        <label className="field-label" htmlFor="mock-name">
          Name
        </label>
        <input id="mock-name" className="input" value={def.name} onChange={(e) => onChange({ ...def, name: e.target.value })} />
      </div>
      <div className="form-row">
        <label className="field-label" htmlFor="mock-target">
          Collection or folder
        </label>
        <select id="mock-target" className="select" value={def.target} onChange={(e) => onChange({ ...def, target: e.target.value })}>
          {containerOptions(workspace.collections).map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </select>
      </div>
      <div className="form-row">
        <label className="field-label" htmlFor="mock-port">
          Port
        </label>
        <input id="mock-port" className="input small" type="number" min={1} max={65535} value={def.port} onChange={(e) => onChange({ ...def, port: Number(e.target.value) || 0 })} />
      </div>
      <div className="form-row">
        <label className="field-label" htmlFor="mock-delay">
          Response delay (ms)
        </label>
        <input id="mock-delay" className="input small" type="number" min={0} value={def.delayMs} onChange={(e) => onChange({ ...def, delayMs: Math.max(0, Number(e.target.value) || 0) })} />
      </div>
      <div className="setting-row">
        <div>
          <div className="setting-label">Start when the workspace opens</div>
        </div>
        <Toggle label="Auto start" checked={def.autoStart} onChange={(autoStart) => onChange({ ...def, autoStart })} />
      </div>
      <div className="setting-row">
        <div>
          <div className="setting-label">Allow access from other computers</div>
          <div className="muted">Off: only this computer can call the mock (127.0.0.1). On: anyone on your network can.</div>
        </div>
        <Toggle label="Allow LAN access" checked={def.allowLan} onChange={(allowLan) => onChange({ ...def, allowLan })} />
      </div>
      <div className="setting-row">
        <div>
          <div className="setting-label">Allow browser access (CORS)</div>
          <div className="muted">Lets web pages you open in a browser call the mock, e.g. a front-end in development.</div>
        </div>
        <Toggle label="Allow browser access" checked={!!def.cors} onChange={(cors) => onChange({ ...def, cors })} />
      </div>
    </div>
  )
}

export function CreateMockModal({ workspace, existingPorts, defaultTarget, onClose, onCreate }: { workspace: WorkspaceInfo; existingPorts: number[]; defaultTarget?: string; onClose(): void; onCreate(def: MockDefinition): Promise<void> }) {
  let port = 3000
  while (existingPorts.includes(port)) port++
  const [def, setDef] = useState<MockDefinition>({
    name: 'New Mock Server',
    target: defaultTarget ?? workspace.collections[0]?.id ?? '',
    port,
    allowLan: false,
    delayMs: 0,
    autoStart: false,
    cors: false,
  })
  return (
    <Modal
      title="Create mock server"
      onClose={onClose}
      footer={
        <>
          <span className="spacer" />
          <button className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" disabled={!def.target || !def.name.trim()} onClick={() => void onCreate(def)}>
            Create Mock Server
          </button>
        </>
      }
    >
      <p className="muted">The mock answers with the examples saved in the collection (use “Save as example” in the response pane).</p>
      <MockForm def={def} workspace={workspace} onChange={setDef} />
    </Modal>
  )
}

interface Props {
  info: MockInfo | undefined
  workspace: WorkspaceInfo
  logs: MockLogEntry[]
  onSave(def: MockDefinition): Promise<void>
  onStart(): void
  onStop(): void
  onClearLog(): void
  onError(e: unknown): void
}

export function MockView({ info, workspace, logs, onSave, onStart, onStop, onClearLog, onError }: Props) {
  const [def, setDef] = useState<MockDefinition | null>(info?.def ?? null)
  const [routes, setRoutes] = useState<MockRoute[]>([])
  const id = info?.id
  useEffect(() => setDef(info?.def ?? null), [id])
  useEffect(() => {
    if (id) window.api.mockRoutes(id).then(setRoutes, () => setRoutes([]))
  }, [id, info?.status.running, info?.def.target, workspace])
  if (!info || !def) return <div className="muted-note">This mock server no longer exists.</div>
  const dirty = JSON.stringify(def) !== JSON.stringify(info.def)
  const { status } = info
  return (
    <div className="editor mock-view">
      <div className="editor-title">
        <span className="editor-breadcrumb">
          <span className={`status-dot${status.running ? ' on' : ''}`} />
          <span className="editor-name">{info.def.name}</span>
          {status.url && (
            <>
              <code className="mock-url" data-testid="mock-url">
                {status.url}
              </code>
              <button className="btn-icon" aria-label="Copy mock URL" onClick={() => void navigator.clipboard.writeText(status.url!)}>
                <Copy size={13} />
              </button>
            </>
          )}
        </span>
        <span className="editor-actions">
          <button className="btn btn-ghost" disabled={!dirty} onClick={() => void onSave(def).catch(onError)}>
            <Save size={14} /> Save
          </button>
          {status.running ? (
            <button className="btn btn-secondary" onClick={onStop}>
              <Square size={12} /> Stop
            </button>
          ) : (
            <button className="btn btn-primary" onClick={onStart}>
              <Play size={12} /> Start
            </button>
          )}
        </span>
      </div>
      {status.error && (
        <div className="form-error" role="alert">
          {status.error}
        </div>
      )}
      <div className="mock-body">
        <div className="mock-left">
          <div className="section-title">Settings</div>
          <MockForm def={def} workspace={workspace} onChange={setDef} />
          <div className="section-title">Examples served ({routes.length})</div>
          {routes.length === 0 ? (
            <div className="muted">No saved examples in this collection yet. Send a request and click “Save as example” in the response pane.</div>
          ) : (
            <table className="kv kv-readonly">
              <tbody>
                {routes.map((r) => (
                  <tr key={r.id}>
                    <td className={methodClass(r.method)} style={{ width: 70, textAlign: 'left' }}>
                      {r.method}
                    </td>
                    <td>{r.path}</td>
                    <td>{r.exampleName}</td>
                    <td style={{ width: 50 }}>{r.response.code}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <div className="mock-right">
          <div className="mock-log-head">
            <span className="section-title">Request log</span>
            <span className="spacer" />
            <button className="btn btn-small" onClick={onClearLog} disabled={!logs.length}>
              Clear
            </button>
          </div>
          <div className="mock-log" data-testid="mock-log">
            {logs.length === 0 && <div className="muted">Calls to the mock appear here.</div>}
            {[...logs].reverse().map((l, i) => (
              <div key={i} className="mock-log-row">
                <span className="muted">{new Date(l.ts).toLocaleTimeString()}</span>
                <span className={methodClass(l.method)}>{l.method}</span>
                <span className="mock-log-path">{l.path}</span>
                <span className={l.code < 400 ? 'status-ok' : 'status-bad'}>{l.code}</span>
                <span className="muted mock-log-reason">{l.reason}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
