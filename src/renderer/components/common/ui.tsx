// Small shared UI pieces: modal, toggle, key/value table, dropdown menu.
import { ChevronRight, X } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState, type InputHTMLAttributes, type ReactNode } from 'react'
import type { PmFormParam, PmKeyValue } from '../../../shared/format/types'
import { mergeBulkRows, toBulk } from '../../lib/misc'
import './ui.css'

const focusable = 'button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), a[href], [tabindex]:not([tabindex="-1"])'
const visibleControls = (root: HTMLElement) => [...root.querySelectorAll<HTMLElement>(focusable)].filter((el) => el.getClientRects().length > 0)

export function Modal({ title, onClose, children, footer, wide, className = '' }: { title: string; onClose(): void; children: ReactNode; footer?: ReactNode; wide?: boolean; className?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const [opener] = useState(() => document.activeElement as HTMLElement | null)
  const close = useRef(onClose)
  close.current = onClose
  useLayoutEffect(() => {
    const root = ref.current!
    if (!root.contains(document.activeElement)) (visibleControls(root)[0] ?? root).focus()
    const onKey = (e: KeyboardEvent) => {
      if (document.querySelector('.menu') || e.defaultPrevented) return
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close.current(); return }
      if (e.key !== 'Tab') return
      const controls = visibleControls(root)
      const first = controls[0] ?? root, last = controls.at(-1) ?? root
      if (!root.contains(document.activeElement) || (!e.shiftKey && document.activeElement === last) || (e.shiftKey && document.activeElement === first)) {
        e.preventDefault()
        ;(e.shiftKey ? last : first).focus()
      }
    }
    const onFocus = (e: FocusEvent) => {
      if (!root.contains(e.target as Node) && !(e.target as Element).closest?.('.menu')) (visibleControls(root)[0] ?? root).focus()
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('focusin', onFocus)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('focusin', onFocus)
      if (opener?.isConnected) opener.focus()
    }
  }, [opener])
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} tabIndex={-1} className={`modal${wide ? ' modal-wide' : ''} ${className}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-head">
          <span className="modal-title">{title}</span>
          <button className="btn-icon" aria-label="Close" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  )
}

/** Keep an editable text draft; only valid integers reach application settings. */
export function NumericInput({ value, onChange, min = 0, max = Number.MAX_SAFE_INTEGER, onBlur, ...props }: Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'min' | 'max'> & { value: number; onChange(value: number): void; min?: number; max?: number }) {
  const input = useRef<HTMLInputElement>(null)
  const [draft, setDraft] = useState(String(value))
  useEffect(() => setDraft(String(value)), [value])
  const valid = /^\d+$/.test(draft) && Number.isSafeInteger(Number(draft)) && Number(draft) >= min && Number(draft) <= max
  useEffect(() => input.current?.setCustomValidity(valid ? '' : `Enter a whole number from ${min} to ${max}.`), [valid, min, max])
  return <input {...props} ref={input} type="text" inputMode="numeric" pattern="[0-9]+" value={draft} aria-invalid={!valid} title={!valid ? `Enter a whole number from ${min} to ${max}.` : props.title}
    onChange={(e) => {
      const next = e.target.value
      setDraft(next)
      if (/^\d+$/.test(next) && Number.isSafeInteger(Number(next)) && Number(next) >= min && Number(next) <= max) onChange(Number(next))
    }}
    onBlur={(e) => { if (!valid) setDraft(String(value)); else setDraft(String(Number(draft))); onBlur?.(e) }} />
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange(v: boolean): void; label: string }) {
  return (
    <button role="switch" aria-checked={checked} aria-label={label} className={`toggle${checked ? ' on' : ''}`} onClick={() => onChange(!checked)}>
      <span className="toggle-track">
        <span className="toggle-knob" />
      </span>
      <span className="toggle-text">{checked ? 'ON' : 'OFF'}</span>
    </button>
  )
}

export type MenuItem =
  | { id?: string; label: string; onClick?(): void; danger?: boolean; shortcut?: string; icon?: ReactNode; children?: MenuItem[]; disabled?: boolean }
  | 'separator'

/** Keyboard accessible menu; original indices keep duplicate labels distinct while searching. */
export function Menu({ items, onClose, style, searchable, label, onBack }: { items: MenuItem[]; onClose(): void; style: React.CSSProperties; searchable?: boolean; label?: string; onBack?(): void }) {
  const ref = useRef<HTMLDivElement>(null)
  const [opener] = useState(() => document.activeElement as HTMLElement | null)
  const [query, setQuery] = useState('')
  const [sub, setSub] = useState<{ index: number; top: number; left: number; keyboard?: boolean } | null>(null)
  const [pos, setPos] = useState(style)
  const close = useRef(onClose)
  close.current = onClose
  useEffect(() => {
    const onDown = (e: MouseEvent) => !(e.target as Element).closest?.('.menu') && close.current()
    document.addEventListener('mousedown', onDown)
    return () => {
      document.removeEventListener('mousedown', onDown)
      if (opener?.isConnected && (!document.activeElement || document.activeElement === document.body || ref.current?.contains(document.activeElement))) opener.focus()
    }
  }, [opener])
  useLayoutEffect(() => {
    const root = ref.current!
    // A pointer-opened submenu must not steal focus from its parent.
    if (!onBack || style.zIndex === 52) (root.querySelector<HTMLElement>('input, [role="menuitem"]:not(:disabled)') ?? root).focus()
    const r = root.getBoundingClientRect()
    const top = typeof style.top === 'number' ? Math.max(4, Math.min(style.top, innerHeight - r.height - 4)) : style.top
    const left = typeof style.left === 'number' ? Math.max(4, Math.min(style.left, innerWidth - r.width - 4)) : style.left
    setPos({ ...style, top, left })
  }, [])
  const q = query.trim().toLowerCase()
  const shown = items.map((item, index) => ({ item, index })).filter(({ item }) => !q || (item !== 'separator' && item.label.toLowerCase().includes(q)))
  const open = sub !== null ? items[sub.index] : undefined
  const openSub = (el: HTMLElement, index: number, keyboard = false) => {
    const r = el.getBoundingClientRect()
    setSub({ index, top: r.top - 5, left: r.right + 2, keyboard })
  }
  return <>
    <div ref={ref} tabIndex={-1} className="menu" role="menu" aria-label={label} style={pos} onKeyDown={(e) => {
      const controls = [...ref.current!.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')]
      const current = controls.indexOf(document.activeElement as HTMLButtonElement)
      if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) {
        e.preventDefault(); e.stopPropagation(); setSub(null)
        const index = e.key === 'Home' ? 0 : e.key === 'End' ? controls.length - 1 : e.key === 'ArrowDown' ? (current + 1) % controls.length : (current < 0 ? controls.length - 1 : (current - 1 + controls.length) % controls.length)
        controls[index]?.focus()
      } else if (e.key === 'Escape' || (e.key === 'ArrowLeft' && onBack)) {
        e.preventDefault(); e.stopPropagation(); (onBack ?? onClose)(); opener?.focus()
      } else if (e.key === 'Tab') { e.preventDefault(); onClose(); opener?.focus() }
      else if (e.key === 'ArrowRight' && current >= 0 && controls[current].getAttribute('aria-haspopup') === 'menu') { e.preventDefault(); controls[current].click() }
      else if (e.key === 'Enter' && (e.target as HTMLElement).matches('input')) { e.preventDefault(); controls[0]?.click() }
    }}>
      {searchable && <input className="menu-search" placeholder="Search..." aria-label="Search menu" value={query} onChange={(e) => { setQuery(e.target.value); setSub(null) }} />}
      {shown.map(({ item: it, index }) => it === 'separator' ? <div key={`sep-${index}`} className="menu-sep" role="separator" /> :
        <button key={it.id ?? `item-${index}`} role="menuitem" tabIndex={-1} aria-haspopup={it.children ? 'menu' : undefined} aria-expanded={it.children ? sub?.index === index : undefined} disabled={it.disabled}
          className={`menu-item${it.danger ? ' danger' : ''}${sub?.index === index ? ' open' : ''}`}
          onMouseEnter={(e) => it.children ? openSub(e.currentTarget, index) : setSub(null)}
          onClick={(e) => { if (it.children) { openSub(e.currentTarget, index, true); return }; onClose(); opener?.focus(); it.onClick?.() }}>
          {it.icon && <span className="menu-icon" aria-hidden="true">{it.icon}</span>}<span className="menu-label">{it.label}</span>
          {it.shortcut && <span className="menu-shortcut">{it.shortcut}</span>}{it.children && <ChevronRight size={14} className="menu-shortcut" />}
        </button>)}
      {searchable && shown.length === 0 && <div className="menu-empty">No results</div>}
    </div>
    {open && open !== 'separator' && open.children && sub && <Menu key={`${sub.index}-${sub.keyboard}`} items={open.children} onClose={onClose} onBack={() => setSub(null)} style={{ top: sub.top, left: sub.left, zIndex: sub.keyboard ? 52 : 51 }} />}
  </>
}

interface KvProps<T extends PmKeyValue> {
  rows: T[]
  onChange(rows: T[]): void
  /** Show the Text/File column (form-data). */
  fileColumn?: boolean
  onPickFile?(): Promise<string | null>
  keyLabel?: string
  readOnlyKeys?: boolean
  noBulk?: boolean
  noToggle?: boolean
  /** Postman shows a Description column for params, headers and form fields. */
  noDescription?: boolean
}

/** Postman's key/value editor: trailing blank row appends, checkbox disables, Bulk Edit as text. */
export function KeyValueTable<T extends PmKeyValue>({ rows, onChange, fileColumn, onPickFile, keyLabel = 'Key', readOnlyKeys, noBulk, noToggle, noDescription }: KvProps<T>) {
  const [bulk, setBulk] = useState<string | null>(null)
  const update = (i: number, patch: Partial<T>) => {
    const next = i === rows.length ? [...rows, { key: '', value: '', ...patch } as T] : rows.map((r, j) => (j === i ? { ...r, ...patch } : r))
    onChange(next)
  }
  const display: T[] = readOnlyKeys ? rows : [...rows, { key: '', value: '' } as T]

  return (
    <table className="kv">
      <thead>
        <tr>
          {!noToggle && <th className="kv-check" />}
          <th>{keyLabel}</th>
          {fileColumn && <th className="kv-type" />}
          <th>Value</th>
          {!noDescription && <th>Description</th>}
          {!noBulk ? (
            <th className="kv-actions kv-bulk">
              <button className="link-btn" onClick={() => setBulk(bulk === null ? toBulk(rows) : null)}>
                {bulk === null ? 'Bulk Edit' : 'Key-Value Edit'}
              </button>
            </th>
          ) : (
            <th className="kv-actions" />
          )}
        </tr>
      </thead>
      <tbody>
        {bulk !== null ? (
          <tr>
            <td colSpan={4 + (fileColumn ? 1 : 0) + (noDescription ? 0 : 1)} className="kv-bulk-cell">
              <textarea
                aria-label="Bulk edit"
                className="bulk-area"
                spellCheck={false}
                value={bulk}
                placeholder={'Rows are separated by new lines\nKeys and values are separated by :\nPrepend // to any row you want to add but keep disabled'}
                onChange={(e) => {
                  setBulk(e.target.value)
                  // Bulk text only carries key:value — keep each row's description / file settings.
                  onChange(mergeBulkRows(e.target.value, rows))
                }}
              />
            </td>
          </tr>
        ) : (
          display.map((row, i) => {
            const blank = !readOnlyKeys && i === rows.length
            const file = fileColumn && (row as unknown as PmFormParam).type === 'file'
            const src = (row as unknown as PmFormParam).src
            return (
              <tr key={i} className={row.disabled ? 'disabled' : undefined}>
                {!noToggle && (
                  <td className="kv-check">
                    {!blank && (
                      <input
                        type="checkbox"
                        aria-label={`Enable ${row.key || 'row'}`}
                        checked={!row.disabled}
                        onChange={(e) => update(i, { disabled: e.target.checked ? undefined : true } as Partial<T>)}
                      />
                    )}
                  </td>
                )}
                <td>
                  <input aria-label={keyLabel} placeholder={keyLabel} value={row.key} readOnly={readOnlyKeys} spellCheck={false} onChange={(e) => update(i, { key: e.target.value } as Partial<T>)} />
                </td>
                {fileColumn && (
                  <td className="kv-type">
                    <select
                      aria-label="Type"
                      value={file ? 'file' : 'text'}
                      onChange={(e) => update(i, { type: e.target.value, ...(e.target.value === 'file' ? { value: '' } : { src: undefined }) } as unknown as Partial<T>)}
                    >
                      <option value="text">Text</option>
                      <option value="file">File</option>
                    </select>
                  </td>
                )}
                <td>
                  {file ? (
                    <button
                      className="file-pick"
                      onClick={async () => {
                        const picked = await onPickFile?.()
                        if (picked) update(i, { src: picked } as unknown as Partial<T>)
                      }}
                    >
                      {typeof src === 'string' && src ? src : 'Select files'}
                    </button>
                  ) : (
                    <input aria-label="Value" placeholder="Value" value={row.value} spellCheck={false} onChange={(e) => update(i, { value: e.target.value } as Partial<T>)} />
                  )}
                </td>
                {!noDescription && (
                  <td>
                    <input aria-label="Description" placeholder="Description" value={row.description ?? ''} spellCheck={false} onChange={(e) => update(i, { description: e.target.value || undefined } as Partial<T>)} />
                  </td>
                )}
                <td className="kv-actions">
                  {!blank && !readOnlyKeys && (
                    <button className="btn-icon kv-delete" aria-label={`Delete ${row.key || 'row'}`} onClick={() => onChange(rows.filter((_, j) => j !== i))}>
                      <X size={13} />
                    </button>
                  )}
                </td>
              </tr>
            )
          })
        )}
      </tbody>
    </table>
  )
}
