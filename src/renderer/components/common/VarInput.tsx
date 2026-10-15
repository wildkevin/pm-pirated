import { Compartment, EditorState } from '@codemirror/state'
import {
  Decoration,
  EditorView,
  hoverTooltip,
  keymap,
  placeholder as placeholderExt,
  ViewPlugin,
  type DecorationSet,
  type ViewUpdate,
} from '@codemirror/view'
import { useEffect, useRef } from 'react'
import type { ResolvedVariable } from '../../../shared/ipc'
import { isDynamicVariable } from '../../lib/misc'

export type Resolve = (name: string) => ResolvedVariable | undefined

const VAR = /\{\{([^{}]+)\}\}/g

function decorations(view: EditorView, resolve: Resolve): DecorationSet {
  const marks = []
  const text = view.state.doc.toString()
  for (const m of text.matchAll(VAR)) {
    const name = m[1].trim()
    const ok = isDynamicVariable(name) || !!resolve(name)
    marks.push(Decoration.mark({ class: ok ? 'cm-var cm-var-ok' : 'cm-var cm-var-missing' }).range(m.index!, m.index! + m[0].length))
  }
  return Decoration.set(marks)
}

function highlighter(resolve: Resolve) {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet
      constructor(view: EditorView) {
        this.decorations = decorations(view, resolve)
      }
      update(u: ViewUpdate) {
        if (u.docChanged) this.decorations = decorations(u.view, resolve)
      }
    },
    { decorations: (p) => p.decorations },
  )
}

function tooltip(resolve: Resolve) {
  return hoverTooltip((view, pos) => {
    const text = view.state.doc.toString()
    for (const m of text.matchAll(VAR)) {
      const from = m.index!
      const to = from + m[0].length
      if (pos < from || pos > to) continue
      const name = m[1].trim()
      const v = resolve(name)
      return {
        pos: from,
        end: to,
        above: true,
        create() {
          const dom = document.createElement('div')
          dom.className = 'var-tooltip'
          const scope = isDynamicVariable(name) ? 'Dynamic' : v ? v.scope[0].toUpperCase() + v.scope.slice(1) : 'Unresolved'
          const value = isDynamicVariable(name) ? 'Generated when the request is sent' : v ? (v.secret ? '••••••' : v.value || '(empty)') : 'Not defined in the active environment, collection or globals'
          const head = document.createElement('div')
          head.className = `var-tooltip-scope ${v || isDynamicVariable(name) ? '' : 'missing'}`
          head.textContent = `${scope} · ${name}`
          const body = document.createElement('div')
          body.className = 'var-tooltip-value'
          body.textContent = value
          dom.append(head, body)
          return { dom }
        },
      }
    }
    return null
  })
}

const theme = EditorView.theme({
  '&': { fontSize: '13px', height: '100%', flex: '1', minWidth: '0' },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': { fontFamily: 'var(--font-ui)', overflow: 'hidden', alignItems: 'center' },
  '.cm-content': { padding: '0', whiteSpace: 'pre' },
  '.cm-line': { padding: '0 10px' },
})

interface Props {
  value: string
  onChange(value: string): void
  onEnter?(): void
  /** Called instead of inserting when a cURL command is pasted. */
  onPasteCurl?(text: string): void
  resolve: Resolve
  placeholder?: string
  ariaLabel: string
}

/** Single-line input with Postman-style {{variable}} highlighting and hover values. */
export function VarInput({ value, onChange, onEnter, onPasteCurl, resolve, placeholder, ariaLabel }: Props) {
  const host = useRef<HTMLDivElement>(null)
  const view = useRef<EditorView | null>(null)
  const vars = useRef(new Compartment())
  const cb = useRef({ onChange, onEnter, onPasteCurl })
  cb.current = { onChange, onEnter, onPasteCurl }

  useEffect(() => {
    const v = new EditorView({
      parent: host.current!,
      state: EditorState.create({
        doc: value,
        extensions: [
          theme,
          vars.current.of([highlighter(resolve), tooltip(resolve)]),
          placeholderExt(placeholder ?? ''),
          // Single line: newlines from typing or pasting become nothing.
          EditorState.transactionFilter.of((tr) => (tr.newDoc.lines > 1 ? [] : tr)),
          keymap.of([{ key: 'Enter', run: () => (cb.current.onEnter?.(), true) }]),
          EditorView.domEventHandlers({
            paste(e) {
              const text = e.clipboardData?.getData('text/plain') ?? ''
              if (cb.current.onPasteCurl && /^\s*curl(\.exe)?\s/i.test(text)) {
                e.preventDefault()
                cb.current.onPasteCurl(text)
                return true
              }
              if (text.includes('\n')) {
                e.preventDefault()
                const sel = v.state.selection.main
                v.dispatch({ changes: { from: sel.from, to: sel.to, insert: text.replace(/\r?\n/g, '') } })
                return true
              }
              return false
            },
          }),
          EditorView.contentAttributes.of({ 'aria-label': ariaLabel, role: 'textbox' }),
          EditorView.updateListener.of((u) => {
            if (u.docChanged) cb.current.onChange(u.state.doc.toString())
          }),
        ],
      }),
    })
    view.current = v
    return () => v.destroy()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const v = view.current
    if (v && v.state.doc.toString() !== value) v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: value } })
  }, [value])

  useEffect(() => {
    view.current?.dispatch({ effects: vars.current.reconfigure([highlighter(resolve), tooltip(resolve)]) })
  }, [resolve])

  return <div className="var-input" ref={host} />
}
