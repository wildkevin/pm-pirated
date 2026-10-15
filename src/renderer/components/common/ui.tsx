// Small shared UI pieces: modal, toggle, key/value table, dropdown menu.
import { ChevronRight, X } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import type { PmFormParam, PmKeyValue } from '../../../shared/format/types'
import { fromBulk, toBulk } from '../../lib/misc'

export function Modal({ title, onClose, children, footer, wide }: { title: string; onClose(): void; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal${wide ? ' modal-wide' : ''}`} role="dialog" aria-label={title}>
        <div className="modal-head">
          <span className="modal-title">{title}</span>
          <button className="btn-icon" aria-label="Close" onClick={onClose}>
            <X size={16} />
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  )
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
  | { label: string; onClick?(): void; danger?: boolean; shortcut?: string; icon?: ReactNode; children?: MenuItem[]; disabled?: boolean }
  | 'separator'

/**
 * Postman-style menu at a fixed position: separators, shortcut hints, icons, `›` submenus and an optional
 * search box. Closes on outside click or Escape; keeps itself inside the window.
 */
export function Menu({ items, onClose, style, searchable, label }: { items: MenuItem[]; onClose(): void; style: React.CSSProperties; searchable?: boolean; label?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const [query, setQuery] = useState('')
  const [sub, setSub] = useState<{ index: number; top: number; left: number } | null>(null)
  const [pos, setPos] = useState(style)
  useEffect(() => {
    const onDown = (e: MouseEvent) => !(e.target as Element).closest?.('.menu') && onClose()
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [onClose])
  // Flip/shift into the window when it would overflow.
  useLayoutEffect(() => {
    const r = ref.current?.getBoundingClientRect()
    if (!r) return
    const top = typeof style.top === 'number' && r.bottom > innerHeight - 4 ? Math.max(4, innerHeight - r.height - 4) : style.top
    const left = typeof style.left === 'number' && r.right > innerWidth - 4 ? Math.max(4, innerWidth - r.width - 4) : style.left
    if (top !== style.top || left !== style.left) setPos({ ...style, top, left })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const q = query.trim().toLowerCase()
  const shown = q ? items.filter((it) => it !== 'separator' && it.label.toLowerCase().includes(q)) : items
  const open = sub !== null ? shown[sub.index] : undefined
  return (
    <>
      <div ref={ref} className="menu" role="menu" aria-label={label} style={pos}>
        {searchable && (
          <input className="menu-search" placeholder="Search..." aria-label="Search menu" autoFocus value={query} onChange={(e) => setQuery(e.target.value)} />
        )}
        {shown.map((it, i) =>
          it === 'separator' ? (
            <div key={`sep-${i}`} className="menu-sep" role="separator" />
          ) : (
            <button
              key={it.label}
              role="menuitem"
              aria-haspopup={it.children ? 'menu' : undefined}
              disabled={it.disabled}
              className={`menu-item${it.danger ? ' danger' : ''}${sub?.index === i ? ' open' : ''}`}
              onMouseEnter={(e) => {
                const r = e.currentTarget.getBoundingClientRect()
                setSub(it.children ? { index: i, top: r.top - 5, left: r.right + 2 } : null)
              }}
              onClick={() => {
                if (it.children) return
                onClose()
                it.onClick?.()
              }}
            >
              {it.icon && <span className="menu-icon">{it.icon}</span>}
              <span className="menu-label">{it.label}</span>
              {it.shortcut && <span className="menu-shortcut">{it.shortcut}</span>}
              {it.children && <ChevronRight size={14} className="menu-shortcut" />}
            </button>
          ),
        )}
        {searchable && shown.length === 0 && <div className="menu-empty">No results</div>}
      </div>
      {open && open !== 'separator' && open.children && sub && <Menu items={open.children} onClose={onClose} style={{ top: sub.top, left: sub.left }} />}
    </>
  )
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
                  onChange(fromBulk(e.target.value).map((r) => ({ ...rows.find((o) => o.key === r.key), ...r, disabled: r.disabled })) as T[])
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
