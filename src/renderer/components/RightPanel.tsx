import { ChevronDown, ChevronRight, Code2, Info, SquareFunction, X } from 'lucide-react'
import { useState } from 'react'
import type { PmItem } from '../../shared/format/types'
import type { ResolvedVariable } from '../../shared/ipc'
import { isDynamicVariable } from '../lib/misc'
import type { Tab } from '../state'
import { tabTitle } from '../state'
import { CodePanel } from './CodePanel'

export type RightView = 'variables' | 'code' | 'info'

interface Props {
  view: RightView
  setView(v: RightView): void
  onClose(): void
  active: Tab | undefined
  resolved: ResolvedVariable[]
  environmentId: string | null
  environmentName: string | null
  onEdit(scope: 'environment' | 'collection' | 'globals'): void
}

const SCOPES: { scope: ResolvedVariable['scope']; badge: string; title: string }[] = [
  { scope: 'environment', badge: 'E', title: 'Environment' },
  { scope: 'collection', badge: 'C', title: 'Collection' },
  { scope: 'globals', badge: 'G', title: 'Globals' },
]

/** `{{name}}` references anywhere in a request (URL, headers, body, auth…), in order of appearance. */
export function referencedVariables(item: PmItem): string[] {
  const names = [...JSON.stringify(item.request).matchAll(/\{\{([^{}]+?)\}\}/g)].map((m) => m[1].trim())
  return [...new Set(names)].filter((n) => n && !isDynamicVariable(n))
}

/** Postman 12's right panel: Variables, Code, Info. */
export function RightPanel(p: Props) {
  const icons: { id: RightView; label: string; icon: React.ReactNode }[] = [
    { id: 'variables', label: 'Variables', icon: <SquareFunction size={16} /> },
    { id: 'code', label: 'Code', icon: <Code2 size={16} /> },
    { id: 'info', label: 'Info', icon: <Info size={16} /> },
  ]
  return (
    <aside className="right-panel" aria-label="Right panel">
      <div className="rp-head" role="tablist" aria-label="Right panel views">
        {icons.map((i) => (
          <button key={i.id} role="tab" aria-selected={p.view === i.id} aria-label={i.label} title={i.label} className={`rp-icon${p.view === i.id ? ' active' : ''}`} onClick={() => p.setView(i.id)}>
            {i.icon}
          </button>
        ))}
        <span className="spacer" />
        <button className="btn-icon" aria-label="Close right panel" title="Close" onClick={p.onClose}>
          <X size={14} />
        </button>
      </div>
      <div className="rp-body">
        {p.view === 'variables' && <VariablesView {...p} />}
        {p.view === 'code' &&
          (p.active?.doc.kind === 'request' ? (
            <CodePanel requestId={p.active.id} item={p.active.doc.item} environmentId={p.environmentId} onClose={p.onClose} />
          ) : (
            <p className="muted rp-note">Open a request to see its code snippet.</p>
          ))}
        {p.view === 'info' && <InfoView active={p.active} />}
      </div>
    </aside>
  )
}

function VariablesView({ active, resolved, environmentName, onEdit }: Props) {
  const [allOpen, setAllOpen] = useState(active?.doc.kind !== 'request')
  const byKey = new Map(resolved.map((v) => [v.key, v]))
  const used = active?.doc.kind === 'request' ? referencedVariables(active.doc.item) : null
  return (
    <div className="rp-variables">
      {used && (
        <>
          <div className="rp-title">Variables in request</div>
          {used.length === 0 ? (
            <p className="muted rp-note">This request doesn't use any variables. Type {'{{'} in the URL, headers or body to use one.</p>
          ) : (
            <table className="rp-table">
              <tbody>
                {used.map((name) => {
                  const v = byKey.get(name)
                  const badge = v ? SCOPES.find((s) => s.scope === v.scope)! : undefined
                  return (
                    <tr key={name}>
                      <td className="rp-badge-cell">{badge ? <span className={`scope-badge ${badge.scope}`} title={badge.title}>{badge.badge}</span> : <span className="scope-badge none" title="Not defined">–</span>}</td>
                      <td className="rp-key" title={name}>
                        {name}
                      </td>
                      <td className={`rp-value${v ? '' : ' missing'}`} title={v && !v.secret ? v.value : undefined}>
                        {v ? (v.secret ? '••••••' : v.value || <span className="muted">empty</span>) : 'Not defined'}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
          <button className="rp-toggle" aria-expanded={allOpen} onClick={() => setAllOpen(!allOpen)}>
            {allOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />} All variables
          </button>
        </>
      )}
      {!used && <div className="rp-title">All variables</div>}
      {allOpen &&
        SCOPES.map((s) => {
          const list = resolved.filter((v) => v.scope === s.scope)
          return (
            <section key={s.scope} className="rp-scope">
              <div className="rp-scope-head">
                <span className={`scope-badge ${s.scope}`}>{s.badge}</span>
                <span className="rp-scope-title">{s.scope === 'environment' && environmentName ? environmentName : s.title}</span>
                <span className="spacer" />
                {(s.scope !== 'environment' || environmentName) && (
                  <button className="link-btn" onClick={() => onEdit(s.scope)}>
                    Edit
                  </button>
                )}
              </div>
              {list.length === 0 ? (
                <p className="muted rp-note">{s.scope === 'environment' && !environmentName ? 'No environment selected.' : 'No variables.'}</p>
              ) : (
                <table className="rp-table">
                  <tbody>
                    {list.map((v) => (
                      <tr key={v.key} className={byKey.get(v.key)?.scope !== v.scope ? 'rp-overridden' : undefined}>
                        <td className="rp-key" title={v.key}>
                          {v.key}{byKey.get(v.key)?.scope !== v.scope && <span className="rp-override-label">Overridden</span>}
                        </td>
                        <td className="rp-value" title={v.secret ? undefined : v.value}>
                          {v.secret ? '••••••' : v.value}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>
          )
        })}
    </div>
  )
}

function InfoView({ active }: { active: Tab | undefined }) {
  if (!active) return <p className="muted rp-note">Nothing selected.</p>
  const rows: [string, string][] = [
    ['Name', tabTitle(active)],
    ['Type', active.doc.kind === 'request' ? 'HTTP request' : active.doc.kind === 'container' ? (active.id?.split('/').length === 2 ? 'Collection' : 'Folder') : active.doc.kind],
    ['Stored in', active.id && !['runner', 'capture', 'load'].includes(active.id) ? active.id : active.id === null ? 'Not saved yet' : '—'],
  ]
  if (active.doc.kind === 'request') rows.push(['Examples', String(active.doc.item.response?.length ?? 0)])
  return (
    <div className="rp-info">
      <div className="rp-title">Info</div>
      <dl>
        {rows.map(([k, v]) => (
          <div key={k} className="rp-info-row">
            <dt>{k}</dt>
            <dd title={v}>{v}</dd>
          </div>
        ))}
      </dl>
    </div>
  )
}
