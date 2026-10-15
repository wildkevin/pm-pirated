import { X } from 'lucide-react'
import { methodClass, methodLabel } from '../lib/methods'
import { isDirty, type Tab } from '../state'

interface Props {
  tabs: Tab[]
  activeId: string | null
  onActivate(id: string): void
  onClose(tab: Tab): void
}

export function TabsBar({ tabs, activeId, onActivate, onClose }: Props) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map((tab) => (
        <div
          key={tab.id}
          role="tab"
          aria-selected={tab.id === activeId}
          className={`tab${tab.id === activeId ? ' active' : ''}`}
          title={tab.item.name}
          onClick={() => onActivate(tab.id)}
          onAuxClick={(e) => e.button === 1 && onClose(tab)}
        >
          <span className={methodClass(tab.item.request.method)}>{methodLabel(tab.item.request.method)}</span>
          <span className="tab-name">{tab.item.name}</span>
          {isDirty(tab) && <span className="tab-dirty" aria-label="Unsaved changes" />}
          <button
            className="btn-icon tab-close"
            aria-label={`Close ${tab.item.name}`}
            onClick={(e) => {
              e.stopPropagation()
              onClose(tab)
            }}
          >
            <X size={12} />
          </button>
        </div>
      ))}
    </div>
  )
}
