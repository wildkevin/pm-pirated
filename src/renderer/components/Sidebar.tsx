import { ChevronDown, ChevronRight, Folder, Layers, MoreHorizontal, Plus } from 'lucide-react'
import { useEffect, useRef, useState, type ReactElement } from 'react'
import type { TreeNode, WorkspaceInfo } from '../../shared/format/types'
import { methodClass, methodLabel } from '../lib/methods'

export interface SidebarActions {
  open(id: string): void
  createCollection(): void
  createFolder(parentId: string): void
  createRequest(parentId: string): void
  rename(id: string, name: string): void
  startRename(id: string | null): void
  remove(id: string, name: string): void
}

interface Props {
  workspace: WorkspaceInfo
  activeId: string | null
  renamingId: string | null
  actions: SidebarActions
}

export function Sidebar({ workspace, activeId, renamingId, actions }: Props) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [menu, setMenu] = useState<{ node: TreeNode; x: number; y: number } | null>(null)

  // Reveal newly created or renamed nodes by expanding their ancestors.
  useEffect(() => {
    const target = renamingId ?? activeId
    if (!target) return
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
          onClick={() => (node.kind === 'request' ? actions.open(node.id) : toggle(node.id))}
          onMenu={(x, y) => setMenu({ node, x, y })}
          onRename={(name) => (name && name !== node.name ? actions.rename(node.id, name) : actions.startRename(null))}
          onStartRename={() => actions.startRename(node.id)}
        />,
      )
      if (node.children && expanded.has(node.id)) walk(node.children, depth + 1)
    }
  }
  walk(workspace.collections, 0)

  return (
    <aside className="sidebar">
      <div className="sidebar-rail">
        <button className="rail-item active" aria-current="page">
          <Layers size={18} />
          <span>Collections</span>
        </button>
      </div>
      <div className="sidebar-panel">
        <div className="sidebar-head">
          <span className="sidebar-title">{workspace.name}</span>
          <button className="btn-icon" aria-label="New collection" title="New collection" onClick={actions.createCollection}>
            <Plus size={16} />
          </button>
        </div>
        <div className="tree" role="tree">
          {rows.length ? rows : <div className="tree-empty">No collections yet. Click + to create one.</div>}
        </div>
      </div>
      {menu && <RowMenu menu={menu} actions={actions} onClose={() => setMenu(null)} />}
    </aside>
  )
}

interface RowProps {
  node: TreeNode
  depth: number
  open: boolean
  active: boolean
  renaming: boolean
  onClick(): void
  onMenu(x: number, y: number): void
  onRename(name: string): void
  onStartRename(): void
}

function TreeRow({ node, depth, open, active, renaming, onClick, onMenu, onRename, onStartRename }: RowProps) {
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
          <Chevron size={14} className="tree-chevron" />
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

function RenameInput({ initial, onDone }: { initial: string; onDone(name: string): void }) {
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

function RowMenu({
  menu,
  actions,
  onClose,
}: {
  menu: { node: TreeNode; x: number; y: number }
  actions: SidebarActions
  onClose(): void
}) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose()
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  const { node } = menu
  const item = (label: string, fn: () => void) => (
    <button
      role="menuitem"
      className="menu-item"
      onClick={() => {
        onClose()
        fn()
      }}
    >
      {label}
    </button>
  )
  return (
    <div ref={ref} className="menu" role="menu" style={{ left: menu.x, top: menu.y }}>
      {node.kind !== 'request' && item('Add request', () => actions.createRequest(node.id))}
      {node.kind !== 'request' && item('Add folder', () => actions.createFolder(node.id))}
      {item('Rename', () => actions.startRename(node.id))}
      {item('Delete', () => actions.remove(node.id, node.name))}
    </div>
  )
}
