import { Save, Trash2 } from 'lucide-react'
import { useState } from 'react'
import type { PmBody, PmHeader, PmRequest } from '../../shared/format/types'
import { METHODS, methodClass } from '../lib/methods'
import type { Tab } from '../state'

interface Props {
  tab: Tab
  onChange(patch: Partial<PmRequest>): void
  onSend(): void
  onCancel(): void
  onSave(): void
}

type Section = 'headers' | 'body'

export function RequestEditor({ tab, onChange, onSend, onCancel, onSave }: Props) {
  const [section, setSection] = useState<Section>('headers')
  const { item } = tab
  const req = item.request
  const setRequest = onChange
  const activeHeaders = req.header.filter((h) => !h.disabled && h.key).length
  const sending = !!tab.sendId

  return (
    <div className="editor">
      <div className="editor-title">
        <span className="editor-name">{item.name}</span>
        <button className="btn btn-secondary" onClick={onSave} title="Save (Ctrl+S)">
          <Save size={14} /> Save
        </button>
      </div>

      <div className="url-row">
        <div className="url-group">
          <select
            aria-label="HTTP method"
            className={`method-select ${methodClass(req.method)}`}
            value={req.method}
            onChange={(e) => setRequest({ method: e.target.value })}
          >
            {METHODS.map((m) => (
              <option key={m}>{m}</option>
            ))}
          </select>
          <input
            className="url-input"
            placeholder="Enter URL or paste text"
            spellCheck={false}
            value={req.url}
            onChange={(e) => setRequest({ url: e.target.value })}
            onKeyDown={(e) => e.key === 'Enter' && !sending && req.url.trim() && onSend()}
          />
        </div>
        {sending ? (
          <button className="btn btn-send" onClick={onCancel}>
            Cancel
          </button>
        ) : (
          <button className="btn btn-send" onClick={onSend} disabled={!req.url.trim()} title="Send (Ctrl+Enter)">
            Send
          </button>
        )}
      </div>

      <div className="subtabs" role="tablist">
        <button role="tab" aria-selected={section === 'headers'} onClick={() => setSection('headers')}>
          Headers{activeHeaders > 0 && <span className="count">({activeHeaders})</span>}
        </button>
        <button role="tab" aria-selected={section === 'body'} onClick={() => setSection('body')}>
          Body{req.body && <span className="dot-indicator" />}
        </button>
      </div>

      <div className="subtab-panel">
        {section === 'headers' ? (
          <KeyValueTable rows={req.header} onChange={(header) => setRequest({ header })} />
        ) : (
          <BodyEditor body={req.body} onChange={(body) => setRequest({ body })} />
        )}
      </div>
    </div>
  )
}

function KeyValueTable({ rows, onChange }: { rows: PmHeader[]; onChange(rows: PmHeader[]): void }) {
  const update = (i: number, patch: Partial<PmHeader>) => {
    // Typing in the trailing blank row appends a new header, as in Postman.
    const next = i === rows.length ? [...rows, { key: '', value: '', ...patch }] : rows.map((r, j) => (j === i ? { ...r, ...patch } : r))
    onChange(next)
  }
  const display = [...rows, { key: '', value: '' }]
  return (
    <table className="kv">
      <thead>
        <tr>
          <th className="kv-check" />
          <th>Key</th>
          <th>Value</th>
          <th className="kv-actions" />
        </tr>
      </thead>
      <tbody>
        {display.map((row, i) => {
          const blank = i === rows.length
          return (
            <tr key={i} className={row.disabled ? 'disabled' : undefined}>
              <td className="kv-check">
                {!blank && (
                  <input
                    type="checkbox"
                    aria-label={`Enable ${row.key || 'header'}`}
                    checked={!row.disabled}
                    onChange={(e) => update(i, { disabled: e.target.checked ? undefined : true })}
                  />
                )}
              </td>
              <td>
                <input aria-label="Key" placeholder="Key" value={row.key} spellCheck={false} onChange={(e) => update(i, { key: e.target.value })} />
              </td>
              <td>
                <input aria-label="Value" placeholder="Value" value={row.value} spellCheck={false} onChange={(e) => update(i, { value: e.target.value })} />
              </td>
              <td className="kv-actions">
                {!blank && (
                  <button className="btn-icon" aria-label={`Delete ${row.key || 'header'}`} onClick={() => onChange(rows.filter((_, j) => j !== i))}>
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

function BodyEditor({ body, onChange }: { body?: PmBody; onChange(body: PmBody | undefined): void }) {
  const language = body?.options?.raw?.language ?? 'text'
  return (
    <div className="body-editor">
      <div className="body-modes">
        <label>
          <input type="radio" name="body-mode" checked={!body} onChange={() => onChange(undefined)} /> none
        </label>
        <label>
          <input
            type="radio"
            name="body-mode"
            checked={!!body}
            onChange={() => onChange({ mode: 'raw', raw: '', options: { raw: { language: 'json' } } })}
          />{' '}
          raw
        </label>
        {body && (
          <select
            aria-label="Body language"
            value={language}
            onChange={(e) => onChange({ ...body, options: { raw: { language: e.target.value as 'json' | 'text' } } })}
          >
            <option value="json">JSON</option>
            <option value="text">Text</option>
          </select>
        )}
      </div>
      {body ? (
        <textarea
          aria-label="Request body"
          className="code-area"
          spellCheck={false}
          value={body.raw}
          onChange={(e) => onChange({ ...body, raw: e.target.value })}
        />
      ) : (
        <div className="muted-note">This request does not have a body</div>
      )}
    </div>
  )
}
