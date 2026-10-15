import { useSettings } from '../../settings'
import { useState } from 'react'
import { cleanError } from '../../lib/body'
import type { BodyMode, PmBody, PmFormParam, PmKeyValue, RawLanguage } from '../../../shared/format/types'
import { CodeEditor, type EditorLanguage } from '../common/CodeEditor'
import { KeyValueTable } from '../common/ui'

const MODES: { mode: BodyMode | 'none'; label: string }[] = [
  { mode: 'none', label: 'none' },
  { mode: 'formdata', label: 'form-data' },
  { mode: 'urlencoded', label: 'x-www-form-urlencoded' },
  { mode: 'raw', label: 'raw' },
  { mode: 'file', label: 'binary' },
  { mode: 'graphql', label: 'GraphQL' },
]

const LANGUAGES: { value: RawLanguage; label: string }[] = [
  { value: 'text', label: 'Text' },
  { value: 'javascript', label: 'JavaScript' },
  { value: 'json', label: 'JSON' },
  { value: 'html', label: 'HTML' },
  { value: 'xml', label: 'XML' },
]

/** Keeps each mode's content when switching, like Postman (bodies hold all modes at once). */
type BodyStore = Partial<{
  mode: BodyMode
  raw: string
  options: { raw?: { language?: RawLanguage } }
  urlencoded: PmKeyValue[]
  formdata: PmFormParam[]
  file: { src?: string | null }
  graphql: { query: string; variables?: string }
  disabled: boolean
}>

function switchMode(body: PmBody | undefined, mode: BodyMode): PmBody {
  const b = (body ?? {}) as unknown as BodyStore
  switch (mode) {
    case 'raw':
      return { ...b, mode, raw: b.raw ?? '', options: b.options ?? { raw: { language: 'json' } } } as PmBody
    case 'urlencoded':
      return { ...b, mode, urlencoded: b.urlencoded ?? [] } as PmBody
    case 'formdata':
      return { ...b, mode, formdata: b.formdata ?? [] } as PmBody
    case 'file':
      return { ...b, mode, file: b.file ?? {} } as PmBody
    case 'graphql':
      return { ...b, mode, graphql: b.graphql ?? { query: '', variables: '' } } as PmBody
  }
}

function beautify(text: string, language: RawLanguage, indent: string): string {
  if (language === 'json') return JSON.stringify(JSON.parse(text), null, indent)
  if (language === 'xml' || language === 'html') {
    if (language === 'xml' && new DOMParser().parseFromString(text, 'application/xml').querySelector('parsererror')) throw new Error('Invalid XML. Correct the markup before formatting.')
    let depth = 0
    return text.replace(/>\s*</g, '>\n<').split('\n').map(line => {
      const value = line.trim()
      if (/^<\//.test(value)) depth = Math.max(0, depth - 1)
      const formatted = indent.repeat(depth) + value
      if (/^<[^!?/][^>]*>/.test(value) && !/\/>$/.test(value) && !/<\//.test(value) && !/^<(?:area|base|br|col|embed|hr|img|input|link|meta|param|source|track|wbr)\b/i.test(value)) depth++
      return formatted
    }).join('\n')
  }
  return text
}

interface Props {
  allowFilesOutsideWorkingDir?: boolean
  body: PmBody | undefined
  onChange(body: PmBody | undefined): void
  pickFile(): Promise<string | null>
}

export function BodyEditor({ body, onChange, pickFile, allowFilesOutsideWorkingDir = false }: Props) {
  const settings = useSettings()
  const indent = settings.editor.indentType === 'tab' ? '\t' : ' '.repeat(settings.editor.indentCount)
  const [error, setError] = useState('')
  let graphqlError = ''
  if (body?.mode === 'graphql' && body.graphql.variables?.trim() && !body.graphql.variables.includes('{{')) {
    try { const value = JSON.parse(body.graphql.variables); if (!value || Array.isArray(value) || typeof value !== 'object') graphqlError = 'GraphQL variables must be a JSON object.' } catch { graphqlError = 'Invalid JSON in GraphQL variables. Correct it before sending.' }
  }
  // Postman keeps the body object (with content of other modes) when "none" is chosen: `disabled` marks it.
  const disabled = !!(body as { disabled?: boolean } | undefined)?.disabled
  const mode: BodyMode | 'none' = !body || disabled ? 'none' : body.mode
  const language = (body?.mode === 'raw' ? body.options?.raw?.language : undefined) ?? 'text'

  return (
    <div className="body-editor">
      <div className="body-modes">
        {/* Postman 12: a mode dropdown instead of radio buttons. */}
        <select
          aria-label="Body type"
          className="pill-select"
          value={mode}
          onChange={(e) => {
            const next = e.target.value as BodyMode | 'none'
            if (next === 'none') onChange(body ? ({ ...body, disabled: true } as unknown as PmBody) : undefined)
            else {
              const { disabled: _d, ...rest } = (body ?? {}) as PmBody & { disabled?: boolean }
              onChange(switchMode(body ? (rest as PmBody) : undefined, next))
            }
          }}
        >
          {MODES.map((m) => (
            <option key={m.mode} value={m.mode}>
              {m.label}
            </option>
          ))}
        </select>
        {body && !disabled && body.mode === 'raw' && (
          <>
            <select
              aria-label="Body language"
              className="lang-select"
              value={language}
              onChange={(e) => onChange({ ...body, options: { raw: { language: e.target.value as RawLanguage } } })}
            >
              {LANGUAGES.map((l) => (
                <option key={l.value} value={l.value}>
                  {l.label}
                </option>
              ))}
            </select>
            <span className="spacer" />
            <button className="link-btn" onClick={() => { try { onChange({ ...body, raw: beautify(body.raw, language, indent) }); setError('') } catch (e) { setError(`Could not format body: ${cleanError(e)}`) } }}>
              Beautify
            </button>
          </>
        )}
      </div>

      {(error || graphqlError) && <div role="alert" className="notice">{error || graphqlError}</div>}
      {!allowFilesOutsideWorkingDir && (mode === 'file' || mode === 'formdata') && <div className="notice">Files must be inside the working directory configured in Settings. A blocked or missing file stops the request. To use other files, enable Settings &gt; General &gt; Allow reading files outside working directory.</div>}
      {mode === 'none' && <div className="muted-note">This request does not have a body</div>}
      {body && !disabled && body.mode === 'raw' && (
        <CodeEditor ariaLabel="Request body" language={language as EditorLanguage} value={body.raw} onChange={(raw) => onChange({ ...body, raw })} />
      )}
      {body && !disabled && body.mode === 'urlencoded' && (
        <KeyValueTable rows={body.urlencoded} onChange={(urlencoded) => onChange({ ...body, urlencoded })} />
      )}
      {body && !disabled && body.mode === 'formdata' && (
        <KeyValueTable fileColumn rows={body.formdata} onPickFile={pickFile} onChange={(formdata) => onChange({ ...body, formdata })} />
      )}
      {body && !disabled && body.mode === 'file' && (
        <div className="binary-body">
          <button
            className="btn btn-secondary"
            onClick={async () => {
              const src = await pickFile()
              if (src) onChange({ ...body, file: { src } })
            }}
          >
            Select File
          </button>
          <span className="muted">{body.file?.src || 'No file selected'}</span>
        </div>
      )}
      {body && !disabled && body.mode === 'graphql' && (
        <div className="graphql-body">
          <div className="graphql-pane">
            <div className="pane-label">QUERY</div>
            <CodeEditor
              ariaLabel="GraphQL query"
              language="graphql"
              value={body.graphql.query}
              onChange={(query) => onChange({ ...body, graphql: { ...body.graphql, query } })}
            />
          </div>
          <div className="graphql-pane">
            <div className="pane-label">GRAPHQL VARIABLES</div>
            <CodeEditor
              ariaLabel="GraphQL variables"
              language="json"
              value={body.graphql.variables ?? ''}
              onChange={(variables) => onChange({ ...body, graphql: { ...body.graphql, variables } })}
            />
          </div>
        </div>
      )}
    </div>
  )
}
