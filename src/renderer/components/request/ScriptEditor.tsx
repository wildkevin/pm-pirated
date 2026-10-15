import type { EditorView } from '@codemirror/view'
import { Code2 } from 'lucide-react'
import { useRef, useState } from 'react'
import type { PmEvent } from '../../../shared/format/types'
import { PM_COMPLETIONS, snippetsFor } from '../../lib/snippets'
import { CodeEditor } from '../common/CodeEditor'
import { Menu } from '../common/ui'

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
  placeholder?: string
}

export function ScriptEditor({ events, listen, onChange, placeholder }: Props) {
  const editor = useRef<EditorView | null>(null)
  const [menu, setMenu] = useState<DOMRect | null>(null)
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
      <CodeEditor
        ariaLabel={listen === 'prerequest' ? 'Pre-request script' : 'Tests script'}
        language="javascript"
        value={code}
        completions={PM_COMPLETIONS}
        editorRef={editor}
        placeholder={placeholder ?? (listen === 'prerequest' ? 'Use JavaScript to configure this request dynamically.' : 'Use JavaScript to write tests, visualize response, and more.')}
        onChange={(text) => onChange(withScript(events, listen, text))}
      />
      <div className="script-tools">
        <button className="btn btn-ghost btn-small" onClick={(e) => setMenu(e.currentTarget.getBoundingClientRect())}>
          <Code2 size={14} /> Snippets
        </button>
      </div>
      {menu && (
        <Menu
          label="Snippets"
          searchable
          style={{ left: menu.right - 280, top: menu.top - 8 - Math.min(snippetsFor(listen).length * 28 + 44, 400) }}
          onClose={() => setMenu(null)}
          items={snippetsFor(listen).map((sn) => ({ label: sn.label, onClick: () => insert(sn.code) }))}
        />
      )}
    </div>
  )
}

/** Postman 12's Scripts tab: "Before request" / "After response" on the left, the editor on the right. */
export function ScriptsPanel({ events, onChange, scope }: { events: PmEvent[] | undefined; onChange(events: PmEvent[] | undefined): void; scope: 'request' | 'collection' | 'folder' }) {
  const hasPre = !!scriptOf(events, 'prerequest').trim()
  const hasTest = !!scriptOf(events, 'test').trim()
  const [listen, setListen] = useState<PmEvent['listen']>(hasTest && !hasPre ? 'test' : 'prerequest')
  const where = scope === 'request' ? '' : ` in this ${scope}`
  const placeholder =
    scope === 'request' ? undefined : listen === 'prerequest' ? `Write scripts to be run before each HTTP request${where} is sent` : `Write scripts to be run after each HTTP request${where} receives a response`
  return (
    <div className="scripts-panel">
      <div className="scripts-nav" role="tablist" aria-label="Script">
        {(
          [
            ['prerequest', 'Before request', hasPre],
            ['test', 'After response', hasTest],
          ] as const
        ).map(([id, label, has]) => (
          <button key={id} role="tab" aria-selected={listen === id} className={listen === id ? 'active' : ''} onClick={() => setListen(id)}>
            {label}
            {has && <span className="dot-indicator" />}
          </button>
        ))}
      </div>
      <ScriptEditor key={listen} events={events} listen={listen} onChange={onChange} placeholder={placeholder} />
    </div>
  )
}
