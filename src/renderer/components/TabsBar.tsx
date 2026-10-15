import { useSettings } from '../settings'
import { Blocks, ChevronDown, Folder, Gauge, Globe, Layers, PlayCircle, Plus, Radio, Server, SquareFunction, X } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'
import type { EnvironmentInfo } from '../../shared/format/types'
import { methodClass, methodLabel } from '../lib/methods'
import { isDirty, tabTitle, type Tab } from '../state'
import { Menu } from './common/ui'

interface Props {
  tabs: Tab[]
  activeKey: string | null
  onActivate(key: string): void
  /** Keep a preview tab (double-click). */
  onPin(key: string): void
  onClose(tab: Tab): void
  onCloseMany(tabs: Tab[]): void
  onNew(): void
  environments: EnvironmentInfo[]
  activeEnvironment: string | null
  onEnvironment(id: string | null): void
  /** Opens the right panel's Variables view. */
  onShowVariables(): void
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
  const settings = useSettings()
  const row = useRef<HTMLDivElement>(null)
  const environmentId = useId()
  const [rowWidth, setRowWidth] = useState(0)
  const [preferredEnvironmentWidth, setPreferredEnvironmentWidth] = useState(() => {
    const saved = Number(localStorage.getItem('pm-local.environment-width'))
    return Number.isFinite(saved) && saved >= 64 ? Math.min(520, saved) : 210
  })
  const maxEnvironmentWidth = Math.max(64, Math.min(520, rowWidth - 300))
  const environmentWidth = Math.min(preferredEnvironmentWidth, maxEnvironmentWidth)
  const environmentName = p.environments.find((e) => e.id === p.activeEnvironment)?.name ?? 'No Environment'
  const drag = useRef<{ x: number; startWidth: number; width: number } | null>(null)
  useEffect(() => {
    const update = () => setRowWidth(row.current?.clientWidth ?? 0)
    update()
    const observer = new ResizeObserver(update)
    if (row.current) observer.observe(row.current)
    return () => observer.disconnect()
  }, [])
  const resizeEnvironment = (width: number, persist = false) => {
    const next = Math.max(64, Math.min(maxEnvironmentWidth, width))
    setPreferredEnvironmentWidth(next)
    if (persist) localStorage.setItem('pm-local.environment-width', String(next))
    return next
  }
  const [menu, setMenu] = useState<{ x: number; y: number; key: string } | null>(null)
  const [list, setList] = useState<DOMRect | null>(null)
  const strip = useRef<HTMLDivElement>(null)
  // Braces matter: scrollIntoView returns a Promise in current Chromium, and React would call it as a cleanup.
  useEffect(() => {
    const reveal = () => {
      const tabs = strip.current
      const active = tabs?.querySelector<HTMLElement>('.tab.active')
      if (!tabs || !active) return
      const left = active.offsetLeft - tabs.offsetLeft
      if (left < tabs.scrollLeft) tabs.scrollLeft = left
      else if (left + active.offsetWidth > tabs.scrollLeft + tabs.clientWidth) tabs.scrollLeft = left + active.offsetWidth - tabs.clientWidth
    }
    reveal()
    const observer = new ResizeObserver(reveal)
    if (strip.current) observer.observe(strip.current)
    return () => observer.disconnect()
  }, [p.activeKey, p.tabs.length])
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
    <div className="tabs-row" ref={row}>
      <div className="tabs" role="tablist" ref={strip}>
        {p.tabs.map((tab) => {
          const title = tabTitle(tab)
          return (
            <div
              key={tab.key}
              role="tab"
              aria-selected={tab.key === p.activeKey}
              className={`tab${tab.key === p.activeKey ? ' active' : ''}${tab.preview ? ' preview' : ''}`}
              title={tab.preview ? `${title} (preview — double-click to keep open)` : title}
              onClick={() => p.onActivate(tab.key)}
              onDoubleClick={() => tab.preview && p.onPin(tab.key)}
              onAuxClick={(e) => e.button === 1 && p.onClose(tab)}
              onContextMenu={(e) => {
                e.preventDefault()
                setMenu({ x: e.clientX, y: e.clientY, key: tab.key })
              }}
            >
              {settings.ui.tabIcons && <TabIcon tab={tab} />}
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
      </div>
      <button className="btn-icon tab-new" aria-label="New request tab" title="New request" onClick={p.onNew}>
        <Plus size={16} />
      </button>
      {menu && <Menu style={{ left: menu.x, top: menu.y }} onClose={() => setMenu(null)} items={menuItems(menu.key)} />}
      <button className="btn-icon tabs-list-btn" aria-label="Open tabs" title="Open tabs" disabled={!p.tabs.length} onClick={(e) => setList(e.currentTarget.getBoundingClientRect())}>
        <ChevronDown size={14} />
      </button>
      {list && (
        <Menu
          label="Open tabs"
          searchable
          style={{ left: list.right - 260, top: list.bottom + 4 }}
          onClose={() => setList(null)}
          items={p.tabs.map((t) => ({ label: tabTitle(t), shortcut: t.key === p.activeKey ? '✓' : undefined, onClick: () => p.onActivate(t.key) }))}
        />
      )}
      <div className="env-selector" style={{ width: environmentWidth }}>
        <div className="env-resize" role="separator" tabIndex={0} aria-label="Resize environment selector" aria-orientation="vertical"
          aria-controls={environmentId} aria-valuemin={64} aria-valuemax={maxEnvironmentWidth} aria-valuenow={Math.round(environmentWidth)}
          title="Drag left to widen the environment selector"
          onPointerDown={(e) => {
            if (e.button !== 0) return
            e.preventDefault()
            drag.current = { x: e.clientX, startWidth: environmentWidth, width: environmentWidth }
            e.currentTarget.setPointerCapture(e.pointerId)
          }}
          onPointerMove={(e) => {
            if (drag.current) drag.current.width = resizeEnvironment(drag.current.startWidth + drag.current.x - e.clientX)
          }}
          onPointerUp={(e) => {
            if (!drag.current) return
            localStorage.setItem('pm-local.environment-width', String(drag.current.width))
            drag.current = null
            e.currentTarget.releasePointerCapture(e.pointerId)
          }}
          onLostPointerCapture={() => { drag.current = null }}
          onDoubleClick={() => resizeEnvironment(210, true)}
          onKeyDown={(e) => {
            const next = e.key === 'ArrowLeft' ? environmentWidth + 16 : e.key === 'ArrowRight' ? environmentWidth - 16 : e.key === 'Home' ? 64 : e.key === 'End' ? maxEnvironmentWidth : null
            if (next !== null) { e.preventDefault(); resizeEnvironment(next, true) }
          }} />
        <div className={`env-picker${environmentWidth < 100 ? ' compact' : ''}`}><select id={environmentId} aria-label="Environment" title={environmentName} className="select env-select" value={p.activeEnvironment ?? ''} onChange={(e) => p.onEnvironment(e.target.value || null)}>
          <option value="">No Environment</option>
          {p.environments.map((e) => (
            <option key={e.id} value={e.id}>
              {e.name}
            </option>
          ))}
        </select>
        <span className="env-display" aria-hidden="true">{environmentWidth < 100 ? <Blocks size={16} /> : <><span className="env-name">{environmentName}</span>{environmentWidth >= 160 && <ChevronDown size={14} />}</>}</span>
        </div>
        <button className="btn-icon" aria-label="Variables" title="Variables" onClick={p.onShowVariables}>
          <SquareFunction size={16} />
        </button>
      </div>
    </div>
  )
}
