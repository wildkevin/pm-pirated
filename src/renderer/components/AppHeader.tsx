import { useShortcutLabel } from '../settings'
import { ArrowLeft, ArrowRight, ChevronDown, Folder, FolderOpen, LayoutGrid, Search, Settings as SettingsIcon } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { TreeNode, WorkspaceInfo } from '../../shared/format/types'
import type { WorkspaceListItem } from '../../shared/ipc'
import { methodClass, methodLabel } from '../lib/methods'
import logo from '../../../build/icon.png'

export interface SearchHit {
  kind: 'request' | 'collection' | 'folder' | 'environment'
  id: string
  name: string
  /** Where it lives ("Shop / Admin"). */
  path: string
  method?: string
}

interface Props {
  workspace: WorkspaceInfo | null
  /** Shown instead of the workspace name on the Workspaces / Create pages. */
  title?: string
  workspaces: WorkspaceListItem[]
  onSwitcherOpen(): void
  onCreateWorkspace(): void
  onViewAllWorkspaces(): void
  canBack: boolean
  canForward: boolean
  onBack(): void
  onForward(): void
  onOpenRecent(dir: string): void
  onSettings(): void
  onPick(hit: SearchHit): void
  searchOpen: boolean
  setSearchOpen(open: boolean): void
}


/** Postman 12's top bar: navigation, workspace switcher, search (Ctrl+K), settings. */
export function AppHeader(p: Props) {
  const shortcut = useShortcutLabel()
  const [menu, setMenu] = useState<DOMRect | null>(null)
  return (
    <header className="header">
      <img src={logo} alt="PM Local" title="PM Local" className="brand-logo" />
      <button className="btn-icon header-nav" aria-label="Go back" title={`Go back (${shortcut('back')})`} disabled={!p.canBack} onClick={p.onBack}>
        <ArrowLeft size={14} />
      </button>
      <button className="btn-icon header-nav" aria-label="Go forward" title={`Go forward (${shortcut('forward')})`} disabled={!p.canForward} onClick={p.onForward}>
        <ArrowRight size={14} />
      </button>
      <button
        className="workspace-switcher"
        aria-label="Workspaces"
        aria-expanded={!!menu}
        title={p.workspace?.root}
        onClick={(e) => {
          p.onSwitcherOpen()
          setMenu(e.currentTarget.getBoundingClientRect())
        }}
      >
        {p.title ? <LayoutGrid size={13} /> : <FolderOpen size={13} />}
        <span className="workspace-name">{p.title ?? p.workspace?.name ?? 'Workspaces'}</span>
        <ChevronDown size={14} />
      </button>
      {menu && (
        <WorkspaceSwitcher
          at={menu}
          current={p.workspace?.root ?? null}
          workspaces={p.workspaces}
          onClose={() => setMenu(null)}
          onOpen={(dir) => dir !== p.workspace?.root && p.onOpenRecent(dir)}
          onCreate={p.onCreateWorkspace}
          onViewAll={p.onViewAllWorkspaces}
        />
      )}
      <span className="header-spacer" />
      <button className="search-bar" aria-label="Search" disabled={!p.workspace} onClick={() => p.setSearchOpen(true)}>
        <Search size={12} />
        <span>Search</span>
        <span className="search-kbd">({shortcut('search')})</span>
      </button>
      <span className="header-spacer" />
      <button className="btn-icon header-nav" aria-label="Settings" title="Settings" onClick={p.onSettings}>
        <SettingsIcon size={14} />
      </button>
      {p.searchOpen && p.workspace && <SearchPalette workspace={p.workspace} onPick={p.onPick} onClose={() => p.setSearchOpen(false)} />}
    </header>
  )
}

export function searchIndex(ws: WorkspaceInfo): SearchHit[] {
  const hits: SearchHit[] = []
  const walk = (nodes: TreeNode[], path: string[]) => {
    for (const n of nodes) {
      hits.push({ kind: n.kind, id: n.id, name: n.name, path: path.join(' / '), method: n.method })
      if (n.children) walk(n.children, [...path, n.name])
    }
  }
  walk(ws.collections, [])
  for (const e of ws.environments) hits.push({ kind: 'environment', id: e.id, name: e.name, path: 'Environment' })
  return hits
}

/** Name matches first, then path matches; requests before containers. */
export function searchHits(index: SearchHit[], query: string, limit = 50): SearchHit[] {
  const q = query.trim().toLowerCase()
  if (!q) return index.filter((h) => h.kind === 'request').slice(0, limit)
  const rank = (h: SearchHit) => (h.name.toLowerCase().startsWith(q) ? 0 : h.name.toLowerCase().includes(q) ? 1 : `${h.path} ${h.method ?? ''}`.toLowerCase().includes(q) ? 2 : -1)
  return index
    .map((h) => [rank(h), h] as const)
    .filter(([r]) => r >= 0)
    .sort((a, b) => a[0] - b[0])
    .map(([, h]) => h)
    .slice(0, limit)
}

function SearchPalette({ workspace, onPick, onClose }: { workspace: WorkspaceInfo; onPick(hit: SearchHit): void; onClose(): void }) {
  const [query, setQuery] = useState('')
  const [sel, setSel] = useState(0)
  const index = useMemo(() => searchIndex(workspace), [workspace])
  const hits = searchHits(index, query)
  const list = useRef<HTMLDivElement>(null)
  useEffect(() => setSel(0), [query])
  useEffect(() => {
    list.current?.querySelector('.selected')?.scrollIntoView({ block: 'nearest' })
  }, [sel])
  const pick = (h: SearchHit | undefined) => {
    if (!h) return
    onClose()
    onPick(h)
  }
  return (
    <div className="palette-backdrop" onMouseDown={onClose}>
      <div className="palette" role="dialog" aria-label="Search workspace" onMouseDown={(e) => e.stopPropagation()}>
        <div className="palette-input">
          <Search size={14} />
          <input
            autoFocus
            aria-label="Search workspace"
            placeholder="Search collections, requests and environments"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') onClose()
              else if (e.key === 'ArrowDown') setSel((s) => Math.min(s + 1, hits.length - 1))
              else if (e.key === 'ArrowUp') setSel((s) => Math.max(s - 1, 0))
              else if (e.key === 'Enter') pick(hits[sel])
              else return
              e.preventDefault()
            }}
          />
        </div>
        <div className="palette-list" role="listbox" ref={list}>
          {!query && hits.length > 0 && <div className="palette-group">Requests</div>}
          {hits.map((h, i) => (
            <div
              key={`${h.kind}:${h.id}`}
              role="option"
              aria-selected={i === sel}
              className={`palette-item${i === sel ? ' selected' : ''}`}
              onMouseEnter={() => setSel(i)}
              onClick={() => pick(h)}
            >
              {h.kind === 'request' ? <span className={`tree-method ${methodClass(h.method ?? 'GET')}`}>{methodLabel(h.method ?? 'GET')}</span> : <span className="palette-kind">{h.kind}</span>}
              <span className="palette-name">{h.name}</span>
              <span className="palette-path">{h.path}</span>
            </div>
          ))}
          {hits.length === 0 && <div className="palette-empty">No results for "{query}"</div>}
        </div>
      </div>
    </div>
  )
}

/** Postman's workspace switcher: search, Create, the workspace list and "View all workspaces". */
function WorkspaceSwitcher(p: { at: DOMRect; current: string | null; workspaces: WorkspaceListItem[]; onClose(): void; onOpen(dir: string): void; onCreate(): void; onViewAll(): void }) {
  const [query, setQuery] = useState('')
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const down = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && p.onClose()
    const key = (e: KeyboardEvent) => e.key === 'Escape' && p.onClose()
    document.addEventListener('mousedown', down)
    document.addEventListener('keydown', key)
    return () => {
      document.removeEventListener('mousedown', down)
      document.removeEventListener('keydown', key)
    }
  }, [p])
  const q = query.trim().toLowerCase()
  const shown = p.workspaces.filter((w) => !q || `${w.name ?? ''} ${w.root}`.toLowerCase().includes(q))
  const go = (fn: () => void) => () => {
    p.onClose()
    fn()
  }
  return (
    <div ref={ref} className="ws-switcher" role="dialog" aria-label="Switch workspace" style={{ left: p.at.left, top: p.at.bottom + 4 }}>
      <div className="ws-switcher-top">
        <input className="input" autoFocus aria-label="Search workspaces" placeholder="Search workspaces..." value={query} onChange={(e) => setQuery(e.target.value)} />
        <button className="btn btn-secondary btn-small" onClick={go(p.onCreate)}>
          Create
        </button>
      </div>
      <div className="ws-switcher-list" role="listbox" aria-label="Workspaces">
        {shown.map((w) => (
          <button key={w.root} role="option" disabled={!w.name} aria-selected={w.root === p.current} className={`ws-switcher-item${w.root === p.current ? ' current' : ''}`} title={w.root} onClick={go(() => p.onOpen(w.root))}>
            <span className="ws-icon">
              <Folder size={13} />
            </span>
            {w.name ?? w.root.split(/[\\/]/).filter(Boolean).pop()}
            {!w.name && <span className="muted"> — Folder not found</span>}
          </button>
        ))}
        {shown.length === 0 && <div className="ws-switcher-empty">{q ? 'No workspaces match.' : 'No workspaces yet.'}</div>}
      </div>
      <button className="ws-switcher-all" onClick={go(p.onViewAll)}>
        <LayoutGrid size={14} /> View all workspaces
      </button>
    </div>
  )
}
