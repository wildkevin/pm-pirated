import { useEffect, useRef, useState } from 'react'
import { SHORTCUTS, DEFAULT_SHORTCUTS, bindingFromEvent, bindingError, displayBinding, type ShortcutId, type ShortcutBindings } from '../../shared/shortcuts'
import { Toggle } from './common/ui'

const mac = /Mac/.test(navigator.platform)
export function ShortcutSettings({ bindings, enabled, onChange }: { bindings: ShortcutBindings; enabled: boolean; onChange(bindings: ShortcutBindings, enabled: boolean): void }) {
  const [editing, setEditing] = useState<ShortcutId | null>(null)
  const [draft, setDraft] = useState('')
  const [error, setError] = useState<string | null>(null)
  const cancelled = useRef(false)
  const finish = () => {
    if (!editing || cancelled.current) return
    const error = bindingError(editing, draft, bindings)
    if (error) { setError(error); return }
    cancelled.current = true
    if (draft !== bindings[editing]) onChange({ ...bindings, [editing]: draft }, enabled)
    setEditing(null)
    setError(null)
  }
  useEffect(() => { if (editing === null) void window.api.setShortcutRecording(false) }, [editing])
  useEffect(() => () => { void window.api.setShortcutRecording(false) }, [])
  const groups = [...new Set(SHORTCUTS.map(([, , group]) => group))]
  return <div className="shortcut-settings">
    <div className="setting-row"><span>Keyboard Shortcuts</span><div className="shortcut-controls"><Toggle label="Keyboard Shortcuts" checked={enabled} onChange={value => onChange(bindings, value)} /><button className="btn btn-secondary" onMouseDown={() => { cancelled.current = true }} onClick={() => { setEditing(null); setError(null); onChange({ ...DEFAULT_SHORTCUTS }, enabled) }}>Restore Defaults</button></div></div>
    <p className="muted">Click a shortcut and press your new key combination. Enter or click outside to save; Esc cancels. Backspace clears a binding. Sidebar shortcuts apply while a collection item is focused.</p>
    {!enabled && <p className="notice">Keyboard shortcuts are off. You can still edit their bindings here.</p>}
    {groups.map(group => <section key={group}><h3 className="section-title">{group}</h3>
      {SHORTCUTS.filter(([, , g]) => g === group).map(([id, label]) => <div className={`shortcut-row${editing === id ? ' recording' : ''}`} key={id}>
        <button className="shortcut-name" onClick={() => { cancelled.current = false; setDraft(bindings[id]); setEditing(id); setError(null) }}>{label}</button>
        {editing === id ? <div className="shortcut-recording"><input autoFocus readOnly data-shortcut-recorder aria-label={`Shortcut for ${label}`} aria-describedby={error ? 'shortcut-error' : undefined} aria-invalid={!!error} className="input shortcut-input" value={displayBinding(draft, mac)} onFocus={() => void window.api.setShortcutRecording(true)} onBlur={() => { void window.api.setShortcutRecording(false); finish() }} onKeyDown={e => {
          e.stopPropagation(); e.preventDefault()
          if (e.key === 'Escape') { cancelled.current = true; setEditing(null); setError(null); return }
          if ((e.key === 'Enter' || e.key === 'Tab') && !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey) { finish(); return }
          if ((e.key === 'Backspace' || e.key === 'Delete') && !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey) { setDraft(''); setError(null); return }
          const binding = bindingFromEvent(e, mac)
          if (binding) { setDraft(binding); setError(bindingError(id, binding, bindings)) }
        }} />{error && <span className="form-error" id="shortcut-error" role="alert">{error}</span>}</div> : <button className="shortcut-binding" aria-label={`Edit shortcut for ${label}`} onClick={() => { cancelled.current = false; setDraft(bindings[id]); setEditing(id); setError(null) }}><kbd>{displayBinding(bindings[id], mac)}</kbd></button>}
        <button className="btn-icon shortcut-reset" aria-label={`Reset shortcut for ${label}`} disabled={bindings[id] === DEFAULT_SHORTCUTS[id]} onMouseDown={() => { cancelled.current = true }} onClick={() => {
          const error = bindingError(id, DEFAULT_SHORTCUTS[id], bindings)
          if (error) { cancelled.current = false; setEditing(id); setDraft(DEFAULT_SHORTCUTS[id]); setError(error); return }
          setEditing(null); setError(null); onChange({ ...bindings, [id]: DEFAULT_SHORTCUTS[id] }, enabled)
        }}>↺</button>
      </div>)}
    </section>)}
  </div>
}
