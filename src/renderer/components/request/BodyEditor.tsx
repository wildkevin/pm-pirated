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

function beautify(text: string, language: RawLanguage): string {
  if (language === 'json') {
    try {
      return JSON.stringify(JSON.parse(text), null, 4)
    } catch {
      return text
    }
  }
  return text
}

interface Props {
  body: PmBody | undefined
  onChange(body: PmBody | undefined): void
  pickFile(): Promise<string | null>
}

export function BodyEditor({ body, onChange, pickFile }: Props) {
  // Postman keeps the body object (with content of other modes) when "none" is chosen: `disabled` marks it.
  const disabled = !!(body as { disabled?: boolean } | undefined)?.disabled
  const mode: BodyMode | 'none' = !body || disabled ? 'none' : body.mode
  const language = (body?.mode === 'raw' ? body.options?.raw?.language : undefined) ?? 'text'

  return (
    <div className="body-editor">
      <div className="body-modes" role="radiogroup" aria-label="Body type">
        {MODES.map((m) => (
          <label key={m.mode} className="radio">
            <input
              type="radio"
              name="body-mode"
              aria-label={m.label}
              checked={mode === m.mode}
              onChange={() => {
                if (m.mode === 'none') onChange(body ? ({ ...body, disabled: true } as unknown as PmBody) : undefined)
                else {
                  const { disabled: _d, ...rest } = (body ?? {}) as PmBody & { disabled?: boolean }
                  onChange(switchMode(body ? (rest as PmBody) : undefined, m.mode))
                }
              }}
            />
            {m.label}
          </label>
        ))}
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
            <button className="link-btn" onClick={() => onChange({ ...body, raw: beautify(body.raw, language) })}>
              Beautify
            </button>
          </>
        )}
      </div>

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
