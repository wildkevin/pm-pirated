import { Eye, EyeOff, Trash2 } from 'lucide-react'
import { useState } from 'react'
import type { VariableRow } from '../../shared/ipc'

interface Props {
  rows: VariableRow[]
  onChange(rows: VariableRow[]): void
}

/** Postman's environment/globals/collection-variables table: Variable · Type · Initial value · Current value. */
export function VariablesEditor({ rows, onChange }: Props) {
  const [reveal, setReveal] = useState(false)
  const update = (i: number, patch: Partial<VariableRow>) => {
    if (i === rows.length) return onChange([...rows, { key: '', type: 'default', initial: '', current: '', enabled: true, ...patch }])
    onChange(
      rows.map((r, j) => {
        if (j !== i) return r
        const next = { ...r, ...patch }
        // Typing an initial value also sets the current value while they were equal (Postman behaviour).
        if (patch.initial !== undefined && r.current === r.initial) next.current = patch.initial
        return next
      }),
    )
  }
  const display = [...rows, { key: '', type: 'default' as const, initial: '', current: '', enabled: true }]
  return (
    <table className="kv vars-table">
      <thead>
        <tr>
          <th className="kv-check" />
          <th>Variable</th>
          <th className="vars-type">Type</th>
          <th>Initial value</th>
          <th>
            Current value
            <button className="btn-icon" aria-label={reveal ? 'Hide secret values' : 'Show secret values'} title={reveal ? 'Hide secrets' : 'Show secrets'} onClick={() => setReveal(!reveal)}>
              {reveal ? <EyeOff size={13} /> : <Eye size={13} />}
            </button>
          </th>
          <th className="kv-actions" />
        </tr>
      </thead>
      <tbody>
        {display.map((r, i) => {
          const blank = i === rows.length
          const hidden = r.type === 'secret' && !reveal
          return (
            <tr key={i} className={r.enabled ? undefined : 'disabled'}>
              <td className="kv-check">
                {!blank && <input type="checkbox" aria-label={`Enable ${r.key}`} checked={r.enabled} onChange={(e) => update(i, { enabled: e.target.checked })} />}
              </td>
              <td>
                <input aria-label="Variable" placeholder={blank ? 'Add new variable' : 'Variable'} value={r.key} spellCheck={false} onChange={(e) => update(i, { key: e.target.value })} />
              </td>
              <td className="vars-type">
                {!blank && (
                  <select aria-label="Type" value={r.type} onChange={(e) => update(i, { type: e.target.value as VariableRow['type'] })}>
                    <option value="default">default</option>
                    <option value="secret">secret</option>
                  </select>
                )}
              </td>
              <td>
                <input aria-label="Initial value" type={hidden ? 'password' : 'text'} value={r.initial} spellCheck={false} onChange={(e) => update(i, { initial: e.target.value })} />
              </td>
              <td>
                <input aria-label="Current value" type={hidden ? 'password' : 'text'} value={r.current} spellCheck={false} onChange={(e) => update(i, { current: e.target.value })} />
              </td>
              <td className="kv-actions">
                {!blank && (
                  <button className="btn-icon" aria-label={`Delete ${r.key}`} onClick={() => onChange(rows.filter((_, j) => j !== i))}>
                    <Trash2 size={13} />
                  </button>
                )}
              </td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}
