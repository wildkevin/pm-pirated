import { ArrowLeft, ArrowRight, ChevronDown, FolderOpen, Search, Settings as SettingsIcon } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { TreeNode, WorkspaceInfo } from '../../shared/format/types'
import { methodClass, methodLabel } from '../lib/methods'
import { mod } from '../lib/misc'
import { Menu } from './common/ui'
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
  recent: string[]
  canBack: boolean
  canForward: boolean
  onBack(): void
  onForward(): void
  onOpenWorkspace(): void
  onOpenRecent(dir: string): void
  onSettings(): void
  onPick(hit: SearchHit): void
  searchOpen: boolean
  setSearchOpen(open: boolean): void
}

const baseName = (dir: string) => dir.split(/[\\/]/).filter(Boolean).pop() ?? dir

/** Postman 12's top bar: navigation, workspace switcher, search (Ctrl+K), settings. */
export function AppHeader(p: Props) {
  const [menu, setMenu] = useState<DOMRect | null>(null)
  return (
    <header className="header">
      <img src={logo} alt="PM Local" title="PM Local" className="brand-logo" />
      <button className="btn-icon header-nav" aria-label="Go back" title={`Go back (${mod}[)`} disabled={!p.canBack} onClick={p.onBack}>
        <ArrowLeft size={14} />
      </button>
      <button className="btn-icon header-nav" aria-label="Go forward" title={`Go forward (${mod}])`} disabled={!p.canForward} onClick={p.onForward}>
        <ArrowRight size={14} />
      </button>
      <button className="workspace-switcher" aria-label="Workspaces" title={p.workspace?.root} onClick={(e) => setMenu(e.currentTarget.getBoundingClientRect())}>
        <FolderOpen size={13} />
        <span className="workspace-name">{p.workspace?.name ?? 'No workspace'}</span>
        <ChevronDown size={14} />
      </button>
      {menu && (
        <Menu
          label="Workspaces"
          style={{ left: menu.left, top: menu.bottom + 4 }}
          onClose={() => setMenu(null)}
          items={[
            ...p.recent.map((dir) => ({ label: baseName(dir), shortcut: dir === p.workspace?.root ? '✓' : undefined, onClick: () => dir !== p.workspace?.root && p.onOpenRecent(dir) })),
            ...(p.recent.length ? (['separator'] as const) : []),
            { label: 'Open workspace…', onClick: p.onOpenWorkspace },
          ]}
        />
      )}
      <span className="header-spacer" />
      <button className="search-bar" aria-label="Search" disabled={!p.workspace} onClick={() => p.setSearchOpen(true)}>
        <Search size={12} />
        <span>Search</span>
        <span className="search-kbd">({mod}K)</span>
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
