import type { EditorView } from '@codemirror/view'
import { useRef } from 'react'
import type { PmEvent } from '../../../shared/format/types'
import { PM_COMPLETIONS, snippetsFor } from '../../lib/snippets'
import { CodeEditor } from '../common/CodeEditor'

export function scriptOf(events: PmEvent[] | undefined, listen: PmEvent['listen']): string {
  return events?.find((e) => e.listen === listen)?.script.exec.join('\n') ?? ''
}

/** Replaces (or removes, when empty) the script for one event, keeping the others. */
export function withScript(events: PmEvent[] | undefined, listen: PmEvent['listen'], code: string): PmEvent[] | undefined {
  const others = (events ?? []).filter((e) => e.listen !== listen)
  const existing = events?.find((e) => e.listen === listen)
  const next = code.trim() ? [...others, { ...existing, listen, script: { ...existing?.script, type: 'text/javascript', exec: code.split('\n') } }] : others
  return next.length ? next : undefined
}

interface Props {
  events: PmEvent[] | undefined
  listen: PmEvent['listen']
  onChange(events: PmEvent[] | undefined): void
}

export function ScriptEditor({ events, listen, onChange }: Props) {
  const editor = useRef<EditorView | null>(null)
  const code = scriptOf(events, listen)
  const insert = (snippet: string) => {
    const v = editor.current
    if (!v) return onChange(withScript(events, listen, code ? `${code}\n${snippet}` : snippet))
    const end = v.state.doc.length
    const prefix = end > 0 && !v.state.doc.toString().endsWith('\n') ? '\n' : ''
    v.dispatch({ changes: { from: end, insert: prefix + snippet + '\n' } })
    v.focus()
  }
  return (
    <div className="script-editor">
      <div className="script-code">
        <CodeEditor
          ariaLabel={listen === 'prerequest' ? 'Pre-request script' : 'Tests script'}
          language="javascript"
          value={code}
          completions={PM_COMPLETIONS}
          editorRef={editor}
          placeholder={listen === 'prerequest' ? 'Use JavaScript to configure this request dynamically.' : 'Use JavaScript to write tests, visualize response and more.'}
          onChange={(text) => onChange(withScript(events, listen, text))}
        />
      </div>
      <div className="snippets">
        <div className="snippets-title">Snippets</div>
        {snippetsFor(listen).map((s) => (
          <button key={s.label} className="snippet" onClick={() => insert(s.code)}>
            {s.label}
          </button>
        ))}
      </div>
    </div>
  )
}
