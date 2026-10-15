import { Check, ChevronDown, ChevronRight, Clock, Folder, Globe, Layers, MoreHorizontal, Plus, Trash2 } from 'lucide-react'
import { useEffect, useRef, useState, type ReactElement } from 'react'
import type { EnvironmentInfo, TreeNode, WorkspaceInfo } from '../../shared/format/types'
import type { HistoryEntry } from '../../shared/ipc'
import { rawUrl } from '../../shared/format/url'
import { methodClass, methodLabel } from '../lib/methods'
import { dayLabel, groupBy } from '../lib/misc'
import { Menu } from './common/ui'

export type Panel = 'collections' | 'environments' | 'history'

export interface SidebarActions {
  openRequest(id: string): void
  openContainer(id: string): void
  createCollection(): void
  createFolder(parentId: string): void
  createRequest(parentId: string): void
  rename(id: string, name: string): void
  startRename(id: string | null): void
  remove(id: string, name: string): void
  exportCollection(id: string): void
  runCollection(id: string): void
  // environments
  openVariables(scope: string, title: string): void
  createEnvironment(): void
  renameEnvironment(id: string, name: string): void
  deleteEnvironment(id: string, name: string): void
  exportEnvironment(id: string): void
  setActiveEnvironment(id: string | null): void
  // history
  openHistory(entry: HistoryEntry): void
  deleteHistory(id?: string): void
  // header
  newRequest(): void
  openImport(): void
}

interface Props {
  workspace: WorkspaceInfo
  panel: Panel
  setPanel(p: Panel): void
  activeId: string | null
  renamingId: string | null
  activeEnvironment: string | null
  history: HistoryEntry[]
  actions: SidebarActions
}

export function Sidebar(p: Props) {
  const [newMenu, setNewMenu] = useState<DOMRect | null>(null)
  const rail: { id: Panel; label: string; icon: ReactElement }[] = [
    { id: 'collections', label: 'Collections', icon: <Layers size={18} /> },
    { id: 'environments', label: 'Environments', icon: <Globe size={18} /> },
    { id: 'history', label: 'History', icon: <Clock size={18} /> },
  ]
  return (
    <aside className="sidebar">
      <div className="sidebar-head">
        <span className="sidebar-title" title={p.workspace.root}>
          {p.workspace.name}
        </span>
        <span className="sidebar-head-actions">
          <button className="btn btn-small" onClick={(e) => setNewMenu(e.currentTarget.getBoundingClientRect())}>
            New
          </button>
          <button className="btn btn-small" onClick={p.actions.openImport}>
            Import
          </button>
        </span>
        {newMenu && (
          <Menu
            style={{ left: newMenu.left, top: newMenu.bottom + 4 }}
            onClose={() => setNewMenu(null)}
            items={[
              { label: 'HTTP Request', onClick: p.actions.newRequest },
              { label: 'Collection', onClick: p.actions.createCollection },
              { label: 'Environment', onClick: p.actions.createEnvironment },
            ]}
          />
        )}
      </div>
      <div className="sidebar-main">
        <nav className="sidebar-rail" aria-label="Sidebar">
          {rail.map((r) => (
            <button key={r.id} className={`rail-item${p.panel === r.id ? ' active' : ''}`} aria-current={p.panel === r.id ? 'page' : undefined} onClick={() => p.setPanel(r.id)}>
              {r.icon}
              <span>{r.label}</span>
            </button>
          ))}
        </nav>
        <div className="sidebar-panel">
          {p.panel === 'collections' && <CollectionsPanel {...p} />}
          {p.panel === 'environments' && <EnvironmentsPanel {...p} />}
          {p.panel === 'history' && <HistoryPanel {...p} />}
        </div>
      </div>
    </aside>
  )
}

function PanelHead({ title, onAdd, addLabel, extra }: { title: string; onAdd?(): void; addLabel?: string; extra?: ReactElement }) {
  return (
    <div className="panel-head">
      <span className="panel-title">{title}</span>
      {extra}
      {onAdd && (
        <button className="btn-icon" aria-label={addLabel} title={addLabel} onClick={onAdd}>
          <Plus size={16} />
        </button>
      )}
    </div>
  )
}

// ---------------- Collections ----------------

function CollectionsPanel({ workspace, activeId, renamingId, actions }: Props) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [menu, setMenu] = useState<{ node: TreeNode; x: number; y: number } | null>(null)

  // Reveal newly created / renamed / opened nodes by expanding their ancestors.
  useEffect(() => {
    const target = renamingId ?? activeId
    if (!target?.startsWith('collections/')) return
    setExpanded((prev) => {
      const next = new Set(prev)
      const parts = target.split('/')
      for (let i = 2; i < parts.length; i++) next.add(parts.slice(0, i).join('/'))
      return next.size === prev.size ? prev : next
    })
  }, [renamingId, activeId])

  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev)
      if (!next.delete(id)) next.add(id)
      return next
    })

  const rows: ReactElement[] = []
  const walk = (nodes: TreeNode[], depth: number) => {
    for (const node of nodes) {
      rows.push(
        <TreeRow
          key={node.id}
          node={node}
          depth={depth}
          open={expanded.has(node.id)}
          active={node.id === activeId}
          renaming={node.id === renamingId}
          onToggle={() => toggle(node.id)}
          onClick={() => {
            if (node.kind === 'request') return actions.openRequest(node.id)
            if (!expanded.has(node.id)) toggle(node.id)
            actions.openContainer(node.id)
          }}
          onMenu={(x, y) => setMenu({ node, x, y })}
          onRename={(name) => (name && name !== node.name ? actions.rename(node.id, name) : actions.startRename(null))}
          onStartRename={() => actions.startRename(node.id)}
        />,
      )
      if (node.children && expanded.has(node.id)) walk(node.children, depth + 1)
    }
  }
  walk(workspace.collections, 0)

  const n = menu?.node
  return (
    <>
      <PanelHead title="Collections" onAdd={actions.createCollection} addLabel="New collection" />
      <div className="tree" role="tree">
        {rows.length ? rows : <div className="tree-empty">Create a collection for your requests. Click + or use Import.</div>}
      </div>
      {menu && n && (
        <Menu
          style={{ left: menu.x, top: menu.y }}
          onClose={() => setMenu(null)}
          items={[
            ...(n.kind !== 'request'
              ? [
                  { label: 'Add request', onClick: () => actions.createRequest(n.id) },
                  { label: 'Add folder', onClick: () => actions.createFolder(n.id) },
                  { label: 'Edit', onClick: () => actions.openContainer(n.id) },
                  { label: 'Run', onClick: () => actions.runCollection(n.id) },
                ]
              : []),
            ...(n.kind === 'collection' ? [{ label: 'Export', onClick: () => actions.exportCollection(n.id) }] : []),
            { label: 'Rename', onClick: () => actions.startRename(n.id) },
            { label: 'Delete', danger: true, onClick: () => actions.remove(n.id, n.name) },
          ]}
        />
      )}
    </>
  )
}

interface RowProps {
  node: TreeNode
  depth: number
  open: boolean
  active: boolean
  renaming: boolean
  onClick(): void
  onToggle(): void
  onMenu(x: number, y: number): void
  onRename(name: string): void
  onStartRename(): void
}

function TreeRow({ node, depth, open, active, renaming, onClick, onToggle, onMenu, onRename, onStartRename }: RowProps) {
  const Chevron = open ? ChevronDown : ChevronRight
  return (
    <div
      className={`tree-row${active ? ' active' : ''}`}
      data-testid="tree-row"
      role="treeitem"
      aria-expanded={node.kind === 'request' ? undefined : open}
      style={{ paddingLeft: 8 + depth * 16 }}
      onClick={onClick}
      onDoubleClick={onStartRename}
      onContextMenu={(e) => {
        e.preventDefault()
        onMenu(e.clientX, e.clientY)
      }}
    >
      {node.kind === 'request' ? (
        <span className={methodClass(node.method ?? 'GET')}>{methodLabel(node.method ?? 'GET')}</span>
      ) : (
        <>
          <Chevron
            size={14}
            className="tree-chevron"
            onClick={(e) => {
              e.stopPropagation()
              onToggle()
            }}
          />
          {node.kind === 'folder' && <Folder size={14} className="tree-icon" />}
        </>
      )}
      {renaming ? (
        <RenameInput initial={node.name} onDone={onRename} />
      ) : (
        <span className="tree-name" title={node.name}>
          {node.name}
        </span>
      )}
      {node.error && (
        <span className="badge-error" title={node.error}>
          !
        </span>
      )}
      <button
        className="btn-icon tree-more"
        aria-label={`Actions for ${node.name}`}
        onClick={(e) => {
          e.stopPropagation()
          const r = e.currentTarget.getBoundingClientRect()
          onMenu(r.left, r.bottom)
        }}
      >
        <MoreHorizontal size={14} />
      </button>
    </div>
  )
}

export function RenameInput({ initial, onDone }: { initial: string; onDone(name: string): void }) {
  const ref = useRef<HTMLInputElement>(null)
  const done = useRef(false)
  useEffect(() => ref.current?.select(), [])
  const finish = (value: string) => {
    if (done.current) return
    done.current = true
    onDone(value.trim())
  }
  return (
    <input
      ref={ref}
      className="rename-input"
      aria-label="Name"
      defaultValue={initial}
      autoFocus
      onClick={(e) => e.stopPropagation()}
      onBlur={(e) => finish(e.currentTarget.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') finish(e.currentTarget.value)
        if (e.key === 'Escape') finish(initial)
      }}
    />
  )
}

// ---------------- Environments ----------------

function EnvironmentsPanel({ workspace, activeEnvironment, renamingId, actions }: Props) {
  const [menu, setMenu] = useState<{ env: EnvironmentInfo; x: number; y: number } | null>(null)
  return (
    <>
      <PanelHead title="Environments" onAdd={actions.createEnvironment} addLabel="New environment" />
      <div className="tree">
        <div className="tree-row" data-testid="env-row" onClick={() => actions.openVariables('globals', 'Globals')}>
          <Globe size={14} className="tree-icon" />
          <span className="tree-name">Globals</span>
        </div>
        {workspace.environments.map((env) => (
          <div
            key={env.id}
            className="tree-row"
            data-testid="env-row"
            onClick={() => actions.openVariables(`env:${env.id}`, env.name)}
            onDoubleClick={() => actions.startRename(env.id)}
            onContextMenu={(e) => {
              e.preventDefault()
              setMenu({ env, x: e.clientX, y: e.clientY })
            }}
          >
            <button
              className={`btn-icon env-check${activeEnvironment === env.id ? ' on' : ''}`}
              aria-label={activeEnvironment === env.id ? `Deactivate ${env.name}` : `Set ${env.name} active`}
              title={activeEnvironment === env.id ? 'Active environment' : 'Set active'}
              onClick={(e) => {
                e.stopPropagation()
                actions.setActiveEnvironment(activeEnvironment === env.id ? null : env.id)
              }}
            >
              <Check size={13} />
            </button>
            {renamingId === env.id ? (
              <RenameInput initial={env.name} onDone={(name) => (name && name !== env.name ? actions.renameEnvironment(env.id, name) : actions.startRename(null))} />
            ) : (
              <span className="tree-name">{env.name}</span>
            )}
            {env.error && (
              <span className="badge-error" title={env.error}>
                !
              </span>
            )}
            <button
              className="btn-icon tree-more"
              aria-label={`Actions for ${env.name}`}
              onClick={(e) => {
                e.stopPropagation()
                const r = e.currentTarget.getBoundingClientRect()
                setMenu({ env, x: r.left, y: r.bottom })
              }}
            >
              <MoreHorizontal size={14} />
            </button>
          </div>
        ))}
        {workspace.environments.length === 0 && <div className="tree-empty">An environment is a set of variables, like Dev or Prod. Click + to create one.</div>}
      </div>
      {menu && (
        <Menu
          style={{ left: menu.x, top: menu.y }}
          onClose={() => setMenu(null)}
          items={[
            { label: 'Rename', onClick: () => actions.startRename(menu.env.id) },
            { label: 'Export', onClick: () => actions.exportEnvironment(menu.env.id) },
            { label: 'Delete', danger: true, onClick: () => actions.deleteEnvironment(menu.env.id, menu.env.name) },
          ]}
        />
      )}
    </>
  )
}

// ---------------- History ----------------

function HistoryPanel({ history, actions }: Props) {
  const [filter, setFilter] = useState('')
  const shown = filter ? history.filter((h) => `${h.item.request.method} ${rawUrl(h.item.request.url)}`.toLowerCase().includes(filter.toLowerCase())) : history
  return (
    <>
      <PanelHead
        title="History"
        extra={
          history.length ? (
            <button className="link-btn" onClick={() => window.confirm('Clear all history?') && actions.deleteHistory()}>
              Clear all
            </button>
          ) : undefined
        }
      />
      <div className="panel-filter">
        <input className="input" placeholder="Filter history" aria-label="Filter history" value={filter} onChange={(e) => setFilter(e.target.value)} />
      </div>
      <div className="tree">
        {shown.length === 0 && <div className="tree-empty">Requests you send will appear here.</div>}
        {groupBy(shown, (h) => dayLabel(h.ts)).map(([day, entries]) => (
          <div key={day}>
            <div className="history-day">{day}</div>
            {entries.map((h) => (
              <div key={h.id} className="tree-row" data-testid="history-row" onClick={() => actions.openHistory(h)} title={rawUrl(h.item.request.url)}>
                <span className={methodClass(h.item.request.method)}>{methodLabel(h.item.request.method)}</span>
                <span className="tree-name">{rawUrl(h.item.request.url) || h.name}</span>
                <button
                  className="btn-icon tree-more"
                  aria-label="Delete history entry"
                  onClick={(e) => {
                    e.stopPropagation()
                    actions.deleteHistory(h.id)
                  }}
                >
                  <Trash2 size={13} />
                </button>
              </div>
            ))}
          </div>
        ))}
      </div>
    </>
  )
}
