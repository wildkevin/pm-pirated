import { findShortcut, displayBinding, type ShortcutId } from '../../shared/shortcuts'
import { useSettings, useShortcutLabel } from '../settings'
import { Box, Check, ChevronDown, ChevronRight, Clock, Folder, Import, ListFilter, MoreHorizontal, Plus, Star, X } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { EnvironmentInfo, TreeNode, WorkspaceInfo } from '../../shared/format/types'
import type { HistoryEntry } from '../../shared/ipc'
import type { MockInfo } from '../../shared/mock'
import { rawUrl } from '../../shared/format/url'
import { methodClass, methodLabel } from '../lib/methods'
import { dayLabel, groupBy } from '../lib/misc'
import { Menu, type MenuItem } from './common/ui'

/** Which sidebar view (Workspace items or History) to show, and which section to reveal. */
export type Panel = 'collections' | 'environments' | 'history' | 'mocks'
type Section = Exclude<Panel, 'history'>

export interface SidebarActions {
  /** `preview`: single click — reuses the preview tab. */
  openRequest(id: string, preview?: boolean): void
  openContainer(id: string, preview?: boolean): void
  createCollection(): void
  createFolder(parentId: string): void
  createRequest(parentId: string): void
  rename(id: string, name: string): void
  startRename(id: string | null): void
  duplicate(id: string): void
  remove(id: string, name: string): void
  toggleFavorite(id: string): void
  exportCollection(id: string): void
  runCollection(id: string): void
  loadTest(id: string): void
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
  // mock servers
  openMock(id: string, name: string): void
  createMock(target?: string): void
  startMock(id: string): void
  stopMock(id: string): void
  deleteMock(id: string, name: string): void
  // toolbar
  newRequest(): void
  openImport(): void
  openWorkspace(): void
}

interface Props {
  workspace: WorkspaceInfo
  panel: Panel
  setPanel(p: Panel): void
  activeId: string | null
  renamingId: string | null
  activeEnvironment: string | null
  favorites: string[]
  history: HistoryEntry[]
  mocks: MockInfo[]
  actions: SidebarActions
}

type MenuState = { x: number; y: number; items: MenuItem[]; searchable?: boolean } | null

const SECTIONS: { id: Section; title: string }[] = [
  { id: 'collections', title: 'Collections' },
  { id: 'environments', title: 'Environments' },
  { id: 'mocks', title: 'Mocks' },
]

function loadOpenSections(): Set<Section> {
  try {
    const saved = JSON.parse(localStorage.getItem('pm-local.sections') ?? '')
    if (Array.isArray(saved)) return new Set(saved)
  } catch {
    // first run
  }
  return new Set(['collections'])
}

export function Sidebar(p: Props) {
  const [filter, setFilter] = useState('')
  const [menu, setMenu] = useState<MenuState>(null)
  const [open, setOpen] = useState(loadOpenSections)
  const view = p.panel === 'history' ? 'history' : 'workspace'

  const setSections = (next: Set<Section>) => {
    localStorage.setItem('pm-local.sections', JSON.stringify([...next]))
    setOpen(next)
  }
  // Reveal the section asked for (e.g. after creating an environment).
  useEffect(() => {
    if (p.panel !== 'history' && !open.has(p.panel)) setSections(new Set([...open, p.panel]))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.panel])

  const showMenu = (e: React.MouseEvent, items: MenuItem[], at: 'pointer' | 'below' = 'below', searchable = false) => {
    e.preventDefault()
    e.stopPropagation()
    const r = e.currentTarget.getBoundingClientRect()
    setMenu(at === 'pointer' ? { x: e.clientX, y: e.clientY, items, searchable } : { x: r.left, y: r.bottom + 2, items, searchable })
  }

  const createItems: MenuItem[] = [
    { label: 'HTTP', icon: <span className="menu-http">HTTP</span>, onClick: p.actions.newRequest },
    'separator',
    { label: 'Collection', icon: <Box size={14} />, onClick: p.actions.createCollection },
    { label: 'Environment', icon: <Check size={14} />, onClick: p.actions.createEnvironment },
    { label: 'Mock Server', icon: <MockIcon />, onClick: () => p.actions.createMock() },
  ]

  return (
    <aside className="sidebar" aria-label="Sidebar">
      <div className="sb-tabs" role="tablist" aria-label="Sidebar views">
        <SbTab label="Collections, environments and mocks" active={view === 'workspace'} onClick={() => p.setPanel('collections')}>
          <Box size={16} />
        </SbTab>
        <SbTab label="History" active={view === 'history'} onClick={() => p.setPanel('history')}>
          <Clock size={16} />
        </SbTab>
      </div>

      <div className="sb-toolbar">
        <label className="sb-filter">
          <ListFilter size={12} />
          <input aria-label={view === 'history' ? 'Filter history' : 'Filter sidebar'} value={filter} onChange={(e) => setFilter(e.target.value)} />
          {filter && (
            <button className="btn-icon" aria-label="Clear filter" onClick={() => setFilter('')}>
              <X size={12} />
            </button>
          )}
        </label>
        {view === 'workspace' ? (
          <>
            <button className="btn-icon sb-tool" aria-label="Create new" title="Create new" onClick={(e) => showMenu(e, createItems, 'below', true)}>
              <Plus size={14} />
            </button>
            <button className="btn-icon sb-tool" aria-label="Import" title="Import" onClick={p.actions.openImport}>
              <Import size={14} />
            </button>
            <button
              className="btn-icon sb-tool"
              aria-label="Sidebar options"
              title="More"
              onClick={(e) =>
                showMenu(e, [
                  { label: 'Open workspace…', onClick: p.actions.openWorkspace },
                  { label: 'Collapse all sections', onClick: () => setSections(new Set()) },
                ])
              }
            >
              <MoreHorizontal size={14} />
            </button>
          </>
        ) : (
          <button
            className="btn-icon sb-tool"
            aria-label="History options"
            title="More"
            onClick={(e) => showMenu(e, [{ label: 'Clear all history', danger: true, disabled: !p.history.length, onClick: () => window.confirm('Clear all history?') && p.actions.deleteHistory() }])}
          >
            <MoreHorizontal size={14} />
          </button>
        )}
      </div>

      {view === 'workspace' ? (
        <div className="sb-sections">
          {SECTIONS.map((s) => {
            const expanded = open.has(s.id) || !!filter
            return (
              <section key={s.id} className={`sb-section${expanded ? ' open' : ''}`} aria-label={s.title}>
                <button
                  className="sb-section-head"
                  aria-expanded={expanded}
                  onClick={() => {
                    const next = new Set(open)
                    if (!next.delete(s.id)) next.add(s.id)
                    setSections(next)
                  }}
                >
                  {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                  <span>{s.title}</span>
                </button>
                {expanded && (
                  <div className="sb-section-body">
                    {s.id === 'collections' && <CollectionsTree {...p} filter={filter} showMenu={showMenu} />}
                    {s.id === 'environments' && <EnvironmentList {...p} filter={filter} showMenu={showMenu} />}
                    {s.id === 'mocks' && <MockList {...p} filter={filter} showMenu={showMenu} />}
                  </div>
                )}
              </section>
            )
          })}
        </div>
      ) : (
        <HistoryList {...p} filter={filter} showMenu={showMenu} />
      )}
      {menu && <Menu items={menu.items} style={{ left: menu.x, top: menu.y }} onClose={() => setMenu(null)} searchable={menu.searchable} label={menu.searchable ? 'Create new' : undefined} />}
    </aside>
  )
}

function SbTab({ label, active, onClick, children }: { label: string; active: boolean; onClick(): void; children: ReactNode }) {
  return (
    <button role="tab" aria-selected={active} aria-label={label} title={label} className={`sb-tab${active ? ' active' : ''}`} onClick={onClick}>
      {children}
    </button>
  )
}

function MockIcon() {
  return <span className="menu-mock">◫</span>
}

type ListProps = Props & { filter: string; showMenu(e: React.MouseEvent, items: MenuItem[], at?: 'pointer' | 'below'): void }

const matches = (name: string, filter: string) => name.toLowerCase().includes(filter.trim().toLowerCase())

// ---------------- Collections ----------------

/** Nodes matching the filter, plus their ancestors (Postman keeps the path visible). */
function filterTree(nodes: TreeNode[], filter: string): TreeNode[] {
  if (!filter.trim()) return nodes
  return nodes.flatMap((n) => {
    if (matches(n.name, filter)) return [n]
    const children = filterTree(n.children ?? [], filter)
    return children.length ? [{ ...n, children }] : []
  })
}

function CollectionsTree({ workspace, activeId, renamingId, favorites, actions, filter, showMenu }: ListProps) {
  const settings = useSettings()
  const shortcut = (id: ShortcutId) => settings.ui.shortcuts ? displayBinding(settings.shortcutBindings[id], /Mac/.test(navigator.platform)) : ''
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

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

  const menuFor = (n: TreeNode): MenuItem[] => {
    const edit: MenuItem[] = [
      { label: 'Rename', shortcut: shortcut('sidebarRename'), onClick: () => actions.startRename(n.id) },
      { label: 'Duplicate', shortcut: shortcut('sidebarDuplicate'), onClick: () => actions.duplicate(n.id) },
      { label: 'Delete', danger: true, shortcut: shortcut('sidebarDelete'), onClick: () => actions.remove(n.id, n.name) },
    ]
    if (n.kind === 'request')
      return [{ label: 'Open in new tab', onClick: () => actions.openRequest(n.id, false) }, 'separator', ...edit]
    return [
      { label: 'Add request', onClick: () => actions.createRequest(n.id) },
      { label: 'Add folder', onClick: () => actions.createFolder(n.id) },
      'separator',
      { label: 'Run', onClick: () => actions.runCollection(n.id) },
      'separator',
      ...edit,
      'separator',
      {
        label: 'More',
        children: [
          { label: n.kind === 'collection' ? 'Collection settings' : 'Folder settings', onClick: () => actions.openContainer(n.id, false) },
          { label: 'Mock', onClick: () => actions.createMock(n.id) },
          { label: 'Run performance test', onClick: () => actions.loadTest(n.id) },
          ...(n.kind === 'collection' ? [{ label: 'Export', onClick: () => actions.exportCollection(n.id) }] : []),
        ],
      },
    ]
  }

  const filtering = !!filter.trim()
  const collections = filterTree(workspace.collections, filter)
  // Favorites first (Postman pins starred collections to the top), otherwise by name.
  const sorted = [...collections.filter((c) => favorites.includes(c.id)), ...collections.filter((c) => !favorites.includes(c.id))]
  const rows: ReactNode[] = []
  const walk = (nodes: TreeNode[], depth: number) => {
    for (const node of nodes) {
      const isOpen = filtering || expanded.has(node.id)
      rows.push(
        <TreeRow
          key={node.id}
          node={node}
          depth={depth}
          open={isOpen}
          active={node.id === activeId}
          renaming={node.id === renamingId}
          favorite={favorites.includes(node.id)}
          onToggle={() => toggle(node.id)}
          onOpen={(preview) => {
            if (node.kind === 'request') return actions.openRequest(node.id, preview)
            if (!expanded.has(node.id)) toggle(node.id)
            actions.openContainer(node.id, preview)
          }}
          onMenu={(e, at) => showMenu(e, menuFor(node), at)}
          onAdd={() => actions.createRequest(node.id)}
          onFavorite={() => actions.toggleFavorite(node.id)}
          onRename={(name) => (name && name !== node.name ? actions.rename(node.id, name) : actions.startRename(null))}
          onKey={(e) => {
            if (renamingId || !settings.ui.shortcuts || e.target !== e.currentTarget) return
            let command = findShortcut(settings.shortcutBindings, e, /Mac/.test(navigator.platform), true)
            if (!command && e.key === 'F2' && settings.shortcutBindings.sidebarRename === 'Mod+KeyE') command = 'sidebarRename'
            if (!command && e.key === 'Delete' && settings.shortcutBindings.sidebarDelete === 'Backspace') command = 'sidebarDelete'
            const row = e.currentTarget as HTMLElement
            const visible = Array.from(row.closest('[role="tree"]')?.querySelectorAll<HTMLElement>('[role="treeitem"]') ?? [])
            const index = visible.indexOf(row)
            let target: HTMLElement | undefined
            const descendants = (n: TreeNode): string[] => [n.id, ...(n.children ?? []).flatMap(descendants)]
            if (command === 'sidebarNext') target = visible[Math.min(visible.length - 1, index + 1)]
            else if (command === 'sidebarPrevious') target = visible[Math.max(0, index - 1)]
            else if (e.key === 'Home' && !e.metaKey && !e.ctrlKey && !e.altKey) target = visible[0]
            else if (e.key === 'End' && !e.metaKey && !e.ctrlKey && !e.altKey) target = visible.at(-1)
            else if (command === 'sidebarExpand') {
              if (node.children && !isOpen) toggle(node.id)
              else if (node.children?.length) target = visible[index + 1]
            } else if (command === 'sidebarCollapse') {
              if (node.children && isOpen) toggle(node.id)
              else target = visible.slice(0, index).reverse().find(r => Number(r.getAttribute('aria-level')) < depth + 1)
            } else if (command === 'sidebarExpandAll') setExpanded(prev => new Set([...prev, ...descendants(node)]))
            else if (command === 'sidebarCollapseAll') { const ids = new Set(descendants(node)); setExpanded(prev => new Set([...prev].filter(id => !ids.has(id)))) }
            else if (command === 'sidebarRename') actions.startRename(node.id)
            else if (command === 'sidebarDuplicate') actions.duplicate(node.id)
            else if (command === 'sidebarDelete') actions.remove(node.id, node.name)
            else if (command === 'sidebarSelect') node.kind === 'request' ? actions.openRequest(node.id, false) : toggle(node.id)
            else return
            e.preventDefault(); e.stopPropagation(); target?.focus()
          }}
        />,
      )
      if (node.children && isOpen) walk(node.children, depth + 1)
    }
  }
  walk(sorted, 0)

  return (
    <div className="tree" role="tree" aria-label="Collections">
      {rows.length ? (
        rows
      ) : filtering ? (
        <div className="tree-empty">No collections match "{filter}".</div>
      ) : (
        <div className="tree-empty">
          Create a collection for your requests.{' '}
          <button className="link-btn" onClick={actions.createCollection}>
            Create collection
          </button>
        </div>
      )}
    </div>
  )
}

interface RowProps {
  node: TreeNode
  depth: number
  open: boolean
  active: boolean
  renaming: boolean
  favorite: boolean
  onOpen(preview: boolean): void
  onToggle(): void
  onMenu(e: React.MouseEvent, at: 'pointer' | 'below'): void
  onAdd(): void
  onFavorite(): void
  onRename(name: string): void
  onKey(e: React.KeyboardEvent): void
}

function TreeRow({ node, depth, open, active, renaming, favorite, onOpen, onToggle, onMenu, onAdd, onFavorite, onRename, onKey }: RowProps) {
  const Chevron = open ? ChevronDown : ChevronRight
  return (
    <div
      className={`tree-row${active ? ' active' : ''}`}
      data-testid="tree-row"
      role="treeitem"
      tabIndex={0}
      aria-selected={active}
      aria-level={depth + 1}
      aria-expanded={node.kind === 'request' ? undefined : open}
      style={{ paddingLeft: 12 + depth * 12 }}
      // Single click: preview tab. Double click: keep the tab (Postman).
      onClick={() => onOpen(true)}
      onDoubleClick={() => onOpen(false)}
      onKeyDown={onKey}
      onContextMenu={(e) => onMenu(e, 'pointer')}
    >
      {node.kind === 'request' ? (
        <span className={`tree-method ${methodClass(node.method ?? 'GET')}`}>{methodLabel(node.method ?? 'GET')}</span>
      ) : (
        <>
          <button
            className="btn-icon tree-chevron"
            aria-label={open ? 'Collapse' : 'Expand'}
            onClick={(e) => {
              e.stopPropagation()
              onToggle()
            }}
            onDoubleClick={(e) => e.stopPropagation()}
          >
            <Chevron size={14} />
          </button>
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
      <span className="tree-actions" onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
        {node.kind !== 'request' && (
          <button className="btn-icon tree-hover" aria-label={`Add request to ${node.name}`} title="Add request" onClick={onAdd}>
            <Plus size={14} />
          </button>
        )}
        {node.kind === 'collection' && (
          <button
            className={`btn-icon tree-star${favorite ? ' on' : ' tree-hover'}`}
            aria-label={favorite ? `Unfavorite ${node.name}` : `Favorite ${node.name}`}
            aria-pressed={favorite}
            title={favorite ? 'Remove from favorites' : 'Add to favorites'}
            onClick={onFavorite}
          >
            <Star size={13} fill={favorite ? 'currentColor' : 'none'} />
          </button>
        )}
        <button className="btn-icon tree-hover" aria-label={`Actions for ${node.name}`} title="View more actions" onClick={(e) => onMenu(e, 'below')}>
          <MoreHorizontal size={14} />
        </button>
      </span>
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
      onDoubleClick={(e) => e.stopPropagation()}
      onBlur={(e) => finish(e.currentTarget.value)}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === 'Enter') finish(e.currentTarget.value)
        if (e.key === 'Escape') finish(initial)
      }}
    />
  )
}

// ---------------- Environments ----------------

function EnvironmentList({ workspace, activeEnvironment, renamingId, actions, filter, showMenu }: ListProps) {
  const settings = useSettings()
  const shortcut = useShortcutLabel()
  const envs = workspace.environments.filter((e) => matches(e.name, filter))
  const menuFor = (env: EnvironmentInfo): MenuItem[] => [
    { label: activeEnvironment === env.id ? 'Deactivate' : 'Set active', onClick: () => actions.setActiveEnvironment(activeEnvironment === env.id ? null : env.id) },
    'separator',
    { label: 'Rename', shortcut: shortcut('sidebarRename'), onClick: () => actions.startRename(env.id) },
    { label: 'Export', onClick: () => actions.exportEnvironment(env.id) },
    { label: 'Delete', danger: true, shortcut: shortcut('sidebarDelete'), onClick: () => actions.deleteEnvironment(env.id, env.name) },
  ]
  return (
    <div className="tree" role="tree" aria-label="Environments">
      {envs.map((env) => {
        const on = activeEnvironment === env.id
        return (
          <div
            key={env.id}
            className="tree-row"
            data-testid="env-row"
            role="treeitem"
            tabIndex={0}
            onClick={() => actions.openVariables(`env:${env.id}`, env.name)}
            onKeyDown={(e) => {
              if (renamingId || !settings.ui.shortcuts || e.target !== e.currentTarget) return
              const command = findShortcut(settings.shortcutBindings, e, /Mac/.test(navigator.platform), true)
              if (command === 'sidebarRename') actions.startRename(env.id)
              else if (command === 'sidebarDelete') actions.deleteEnvironment(env.id, env.name)
              else if (command === 'sidebarSelect') actions.openVariables(`env:${env.id}`, env.name)
              else if (command === 'sidebarNext' || command === 'sidebarPrevious') {
                const rows = [...e.currentTarget.parentElement!.querySelectorAll<HTMLElement>('[role="treeitem"]')]
                rows[Math.max(0, Math.min(rows.length - 1, rows.indexOf(e.currentTarget) + (command === 'sidebarNext' ? 1 : -1)))]?.focus()
              } else return
              e.preventDefault(); e.stopPropagation()
            }}
            onContextMenu={(e) => showMenu(e, menuFor(env), 'pointer')}
          >
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
            <span className="tree-actions" onClick={(e) => e.stopPropagation()}>
              <button
                className={`btn-icon env-check${on ? ' on' : ' tree-hover'}`}
                aria-label={on ? `Deactivate ${env.name}` : `Set ${env.name} active`}
                aria-pressed={on}
                title={on ? 'Active environment' : 'Set active'}
                onClick={() => actions.setActiveEnvironment(on ? null : env.id)}
              >
                <Check size={11} strokeWidth={3} />
              </button>
              <button className="btn-icon tree-hover" aria-label={`Actions for ${env.name}`} title="View more actions" onClick={(e) => showMenu(e, menuFor(env))}>
                <MoreHorizontal size={14} />
              </button>
            </span>
          </div>
        )
      })}
      {workspace.environments.length === 0 && (
        <div className="tree-empty">
          An environment is a set of variables, like Dev or Prod.{' '}
          <button className="link-btn" onClick={actions.createEnvironment}>
            Create environment
          </button>
        </div>
      )}
    </div>
  )
}

// ---------------- Mock servers ----------------

function MockList({ mocks, actions, filter, showMenu }: ListProps) {
  const shown = mocks.filter((m) => matches(m.def.name, filter))
  const menuFor = (m: MockInfo): MenuItem[] => [
    m.status.running ? { label: 'Stop', onClick: () => actions.stopMock(m.id) } : { label: 'Start', onClick: () => actions.startMock(m.id) },
    'separator',
    { label: 'Delete', danger: true, onClick: () => actions.deleteMock(m.id, m.def.name) },
  ]
  return (
    <div className="tree" role="tree" aria-label="Mocks">
      {mocks.length === 0 && (
        <div className="tree-empty">
          A mock server answers with the examples saved in a collection.{' '}
          <button className="link-btn" onClick={() => actions.createMock()}>
            Create mock server
          </button>
        </div>
      )}
      {shown.map((m) => (
        <div
          key={m.id}
          className="tree-row"
          data-testid="mock-row"
          role="treeitem"
          tabIndex={0}
          onClick={() => actions.openMock(m.id, m.def.name)}
          onContextMenu={(e) => showMenu(e, menuFor(m), 'pointer')}
          title={m.status.url ?? m.status.error ?? ''}
        >
          <span className={`status-dot${m.status.running ? ' on' : m.status.error ? ' error' : ''}`} />
          <span className="tree-name">{m.def.name}</span>
          <span className="muted">:{m.def.port}</span>
          <span className="tree-actions" onClick={(e) => e.stopPropagation()}>
            <button className="btn-icon tree-hover" aria-label={`Actions for ${m.def.name}`} title="View more actions" onClick={(e) => showMenu(e, menuFor(m))}>
              <MoreHorizontal size={14} />
            </button>
          </span>
        </div>
      ))}
    </div>
  )
}

// ---------------- History ----------------

function HistoryList({ history, actions, filter }: ListProps) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const shown = filter ? history.filter((h) => matches(`${h.item.request.method} ${rawUrl(h.item.request.url)}`, filter)) : history
  return (
    <div className="sb-history">
      <div className="sb-history-title">Request history</div>
      <div className="tree" role="tree" aria-label="History">
        {shown.length === 0 && <div className="tree-empty">{filter ? 'No requests match.' : 'Requests you send will appear here.'}</div>}
        {groupBy(shown, (h) => dayLabel(h.ts)).map(([day, entries]) => {
          const isOpen = !collapsed.has(day)
          return (
            <div key={day} role="group">
              <button
                className="history-day"
                aria-expanded={isOpen}
                onClick={() =>
                  setCollapsed((prev) => {
                    const next = new Set(prev)
                    if (!next.delete(day)) next.add(day)
                    return next
                  })
                }
              >
                {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                {day}
              </button>
              {isOpen &&
                entries.map((h) => (
                  <div key={h.id} className="tree-row history-row" data-testid="history-row" role="treeitem" tabIndex={0} onClick={() => actions.openHistory(h)} onKeyDown={(e) => {
                    if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); actions.openHistory(h) }
                  }} title={rawUrl(h.item.request.url)}>
                    <span className={`tree-method ${methodClass(h.item.request.method)}`}>{methodLabel(h.item.request.method)}</span>
                    <span className="tree-name">{rawUrl(h.item.request.url) || h.name}</span>
                    <span className="tree-actions" onClick={(e) => e.stopPropagation()}>
                      <button className="btn-icon tree-hover" aria-label="Delete history entry" title="Delete" onClick={() => actions.deleteHistory(h.id)}>
                        <X size={13} />
                      </button>
                    </span>
                  </div>
                ))}
            </div>
          )
        })}
      </div>
    </div>
  )
}
