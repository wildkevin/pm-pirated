// Small shared UI pieces: modal, toggle, key/value table, dropdown menu.
import { Trash2, X } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
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

/** Dropdown menu anchored to a button; closes on outside click or Escape. */
export function Menu({ items, onClose, style }: { items: { label: string; onClick(): void; danger?: boolean }[]; onClose(): void; style: React.CSSProperties }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const onDown = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && onClose()
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [onClose])
  return (
    <div ref={ref} className="menu" role="menu" style={style}>
      {items.map((it) => (
        <button
          key={it.label}
          role="menuitem"
          className={`menu-item${it.danger ? ' danger' : ''}`}
          onClick={() => {
            onClose()
            it.onClick()
          }}
        >
          {it.label}
        </button>
      ))}
    </div>
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
}

/** Postman's key/value editor: trailing blank row appends, checkbox disables, Bulk Edit as text. */
export function KeyValueTable<T extends PmKeyValue>({ rows, onChange, fileColumn, onPickFile, keyLabel = 'Key', readOnlyKeys, noBulk, noToggle }: KvProps<T>) {
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
            <td colSpan={fileColumn ? 5 : 4} className="kv-bulk-cell">
              <textarea
                aria-label="Bulk edit"
                className="bulk-area"
                spellCheck={false}
                value={bulk}
                placeholder={'Rows are separated by new lines\nKeys and values are separated by :\nPrepend // to any row you want to add but keep disabled'}
                onChange={(e) => {
                  setBulk(e.target.value)
                  onChange(fromBulk(e.target.value) as T[])
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
                <td className="kv-actions">
                  {!blank && !readOnlyKeys && (
                    <button className="btn-icon" aria-label={`Delete ${row.key || 'row'}`} onClick={() => onChange(rows.filter((_, j) => j !== i))}>
                      <Trash2 size={13} />
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
