import { Eye, Folder, Gauge, Globe, Layers, PlayCircle, Plus, Radio, Server, X } from 'lucide-react'
import { useState } from 'react'
import type { EnvironmentInfo } from '../../shared/format/types'
import type { ResolvedVariable } from '../../shared/ipc'
import { methodClass, methodLabel } from '../lib/methods'
import { isDirty, tabTitle, type Tab } from '../state'
import { Menu } from './common/ui'

interface Props {
  tabs: Tab[]
  activeKey: string | null
  onActivate(key: string): void
  onClose(tab: Tab): void
  onCloseMany(tabs: Tab[]): void
  onNew(): void
  environments: EnvironmentInfo[]
  activeEnvironment: string | null
  onEnvironment(id: string | null): void
  quickLook: ResolvedVariable[]
  onEditEnvironment(): void
}

function TabIcon({ tab }: { tab: Tab }) {
  if (tab.doc.kind === 'request') {
    const m = tab.doc.item.request.method
    return <span className={methodClass(m)}>{methodLabel(m)}</span>
  }
  if (tab.doc.kind === 'variables') return <Globe size={12} className="tab-icon" />
  if (tab.doc.kind === 'runner') return <PlayCircle size={12} className="tab-icon" />
  if (tab.doc.kind === 'mock') return <Server size={12} className="tab-icon" />
  if (tab.doc.kind === 'capture') return <Radio size={12} className="tab-icon" />
  if (tab.doc.kind === 'load') return <Gauge size={12} className="tab-icon" />
  return tab.id?.split('/').length === 2 ? <Layers size={12} className="tab-icon" /> : <Folder size={12} className="tab-icon" />
}

export function TabsBar(p: Props) {
  const [look, setLook] = useState(false)
  const [menu, setMenu] = useState<{ x: number; y: number; key: string } | null>(null)
  const menuItems = (key: string) => {
    const i = p.tabs.findIndex((t) => t.key === key)
    const tab = p.tabs[i]
    if (!tab) return []
    const others = p.tabs.filter((t) => t.key !== key)
    const close = (tabs: Tab[]) => () => p.onCloseMany(tabs)
    return [
      { label: 'Close tab', onClick: () => p.onClose(tab) },
      ...(others.length ? [{ label: 'Close other tabs', onClick: close(others) }] : []),
      ...(i > 0 ? [{ label: 'Close tabs to the left', onClick: close(p.tabs.slice(0, i)) }] : []),
      ...(i < p.tabs.length - 1 ? [{ label: 'Close tabs to the right', onClick: close(p.tabs.slice(i + 1)) }] : []),
      { label: 'Close all tabs', onClick: () => p.onCloseMany(p.tabs) },
    ]
  }
  return (
    <div className="tabs-row">
      <div className="tabs" role="tablist">
        {p.tabs.map((tab) => {
          const title = tabTitle(tab)
          return (
            <div
              key={tab.key}
              role="tab"
              aria-selected={tab.key === p.activeKey}
              className={`tab${tab.key === p.activeKey ? ' active' : ''}${tab.id === null ? ' draft' : ''}`}
              title={title}
              onClick={() => p.onActivate(tab.key)}
              onAuxClick={(e) => e.button === 1 && p.onClose(tab)}
              onContextMenu={(e) => {
                e.preventDefault()
                setMenu({ x: e.clientX, y: e.clientY, key: tab.key })
              }}
            >
              <TabIcon tab={tab} />
              <span className="tab-name">{title}</span>
              {isDirty(tab) && <span className="tab-dirty" aria-label="Unsaved changes" />}
              <button
                className="btn-icon tab-close"
                aria-label={`Close ${title}`}
                onClick={(e) => {
                  e.stopPropagation()
                  p.onClose(tab)
                }}
              >
                <X size={12} />
              </button>
            </div>
          )
        })}
        <button className="btn-icon tab-new" aria-label="New request tab" title="New request" onClick={p.onNew}>
          <Plus size={16} />
        </button>
      </div>
      {menu && <Menu style={{ left: menu.x, top: menu.y }} onClose={() => setMenu(null)} items={menuItems(menu.key)} />}
      <div className="env-selector">
        <select aria-label="Environment" className="select env-select" value={p.activeEnvironment ?? ''} onChange={(e) => p.onEnvironment(e.target.value || null)}>
          <option value="">No Environment</option>
          {p.environments.map((e) => (
            <option key={e.id} value={e.id}>
              {e.name}
            </option>
          ))}
        </select>
        <button className={`btn-icon${look ? ' active' : ''}`} aria-label="Environment quick look" title="Environment quick look" onClick={() => setLook(!look)}>
          <Eye size={16} />
        </button>
        {look && <QuickLook vars={p.quickLook} hasEnv={!!p.activeEnvironment} onEdit={p.onEditEnvironment} onClose={() => setLook(false)} />}
      </div>
    </div>
  )
}

function QuickLook({ vars, hasEnv, onEdit, onClose }: { vars: ResolvedVariable[]; hasEnv: boolean; onEdit(): void; onClose(): void }) {
  const section = (scope: ResolvedVariable['scope'], title: string) => {
    const list = vars.filter((v) => v.scope === scope)
    return (
      <div className="ql-section">
        <div className="ql-title">{title}</div>
        {list.length === 0 ? (
          <div className="muted ql-empty">{scope === 'environment' && !hasEnv ? 'No active environment' : 'No variables'}</div>
        ) : (
          <table className="ql-table">
            <thead>
              <tr>
                <th>Variable</th>
                <th>Current value</th>
              </tr>
            </thead>
            <tbody>
              {list.map((v) => (
                <tr key={v.key}>
                  <td>{v.key}</td>
                  <td>{v.secret ? '••••••' : v.value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    )
  }
  return (
    <div className="quick-look" role="dialog" aria-label="Environment quick look">
      <div className="ql-head">
        <span />
        {hasEnv && (
          <button
            className="link-btn"
            onClick={() => {
              onClose()
              onEdit()
            }}
          >
            Edit
          </button>
        )}
      </div>
      {section('environment', 'Environment')}
      {section('globals', 'Globals')}
    </div>
  )
}
