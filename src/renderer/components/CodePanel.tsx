import { Copy, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { PmItem } from '../../shared/format/types'
import type { CodeLanguage } from '../../shared/ipc'
import { cleanError } from '../lib/body'
import { CodeEditor, type EditorLanguage } from './common/CodeEditor'

const PREF_KEY = 'pm-local.codeLanguage'

function editorLanguage(syntax: string): EditorLanguage {
  if (syntax === 'javascript') return 'javascript'
  return 'text'
}

/** Postman's right-side "Code snippet" panel. */
export function CodePanel({ requestId, item, environmentId, onClose }: { requestId: string | null; item: PmItem; environmentId: string | null; onClose(): void }) {
  const [languages, setLanguages] = useState<CodeLanguage[]>([])
  const [choice, setChoice] = useState(() => localStorage.getItem(PREF_KEY) ?? 'curl|cURL')
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [lang, variant] = choice.split('|')

  useEffect(() => void window.api.codeLanguages().then(setLanguages), [])
  useEffect(() => {
    const t = setTimeout(() => {
      window.api
        .generateCode(requestId, item, environmentId, lang, variant)
        .then((c) => (setCode(c), setError(null)))
        .catch((e) => setError(cleanError(e)))
    }, 250)
    return () => clearTimeout(t)
  }, [requestId, item, environmentId, lang, variant])

  const syntax = languages.find((l) => l.key === lang)?.syntax ?? 'text'
  return (
    <aside className="code-panel" aria-label="Code snippet">
      <div className="code-panel-head">
        <span className="section-title">Code snippet</span>
        <span className="spacer" />
        <button className="btn-icon" aria-label="Copy snippet" title="Copy" onClick={() => void navigator.clipboard.writeText(code)}>
          <Copy size={14} />
        </button>
        <button className="btn-icon" aria-label="Close code snippet" onClick={onClose}>
          <X size={14} />
        </button>
      </div>
      <select
        aria-label="Snippet language"
        className="select wide"
        value={choice}
        onChange={(e) => {
          setChoice(e.target.value)
          localStorage.setItem(PREF_KEY, e.target.value)
        }}
      >
        {languages.flatMap((l) =>
          l.variants.map((v) => (
            <option key={`${l.key}|${v}`} value={`${l.key}|${v}`}>
              {l.variants.length > 1 || l.label !== v ? `${l.label} - ${v}` : l.label}
            </option>
          )),
        )}
      </select>
      {error ? (
        <div className="form-error">{error}</div>
      ) : (
        <div className="code-panel-body" data-testid="code-snippet">
          <CodeEditor readOnly ariaLabel="Generated code" language={editorLanguage(syntax)} value={code} />
        </div>
      )}
    </aside>
  )
}
