import { tags } from '@lezer/highlight'
import { useSettings } from '../../settings'
import { HighlightStyle, syntaxHighlighting, indentUnit } from '@codemirror/language'
import { autocompletion, type CompletionContext } from '@codemirror/autocomplete'
import { html } from '@codemirror/lang-html'
import { javascript } from '@codemirror/lang-javascript'
import { json } from '@codemirror/lang-json'
import { xml } from '@codemirror/lang-xml'
import { Compartment, EditorState, type Extension } from '@codemirror/state'
import { EditorView, placeholder as placeholderExt } from '@codemirror/view'
import { basicSetup } from 'codemirror'
import { useEffect, useRef } from 'react'

export type EditorLanguage = 'json' | 'javascript' | 'xml' | 'html' | 'text' | 'graphql'

function languageExt(lang: EditorLanguage): Extension {
  switch (lang) {
    case 'json':
      return json()
    case 'javascript':
      return javascript()
    case 'xml':
      return xml()
    case 'html':
      return html()
    default:
      return []
  }
}

const theme = EditorView.theme({
  '&': { height: '100%', fontSize: 'var(--editor-font-size, 12px)', backgroundColor: 'var(--bg-primary)' },
  '.cm-scroller': { fontFamily: 'var(--font-code)', lineHeight: '1.5' },
  '.cm-gutters': { backgroundColor: 'var(--bg-primary)', color: 'var(--content-tertiary)', border: 'none' },
  '&.cm-focused': { outline: 'none' },
  '.cm-activeLine, .cm-activeLineGutter': { backgroundColor: 'transparent' },
})

interface Props {
  value: string
  onChange?(value: string): void
  language: EditorLanguage
  readOnly?: boolean
  placeholder?: string
  /** Extra autocomplete words (e.g. pm.* API). */
  completions?: string[]
  ariaLabel?: string
  /** Lets a parent insert text at the cursor (snippets). */
  editorRef?: React.MutableRefObject<EditorView | null>
}

export function CodeEditor({ value, onChange, language, readOnly, placeholder, completions, ariaLabel, editorRef }: Props) {
  const settings = useSettings()
  const preferences = useRef(new Compartment())
  const host = useRef<HTMLDivElement>(null)
  const view = useRef<EditorView | null>(null)
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  const lang = useRef(new Compartment())

  useEffect(() => {
    const words = completions ?? []
    const complete = (ctx: CompletionContext) => {
      const word = ctx.matchBefore(/[\w.$]+/)
      if (!word || (word.from === word.to && !ctx.explicit)) return null
      return { from: word.from, options: words.map((label) => ({ label, type: 'function' })) }
    }
    const v = new EditorView({
      parent: host.current!,
      state: EditorState.create({
        doc: value,
        extensions: [
          basicSetup,
          preferences.current.of([]),
          theme,
          syntaxHighlighting(HighlightStyle.define([
            { tag: [tags.keyword, tags.operator], color: 'var(--syntax-keyword)' },
            { tag: [tags.string, tags.regexp], color: 'var(--syntax-string)' },
            { tag: [tags.number, tags.bool, tags.null], color: 'var(--syntax-number)' },
            { tag: tags.comment, color: 'var(--content-secondary)' },
            { tag: [tags.propertyName, tags.variableName], color: 'var(--content-primary)' },
            { tag: [tags.typeName, tags.tagName, tags.attributeName], color: 'var(--link)' },
          ])),
          lang.current.of(languageExt(language)),
          EditorView.lineWrapping,
          EditorState.readOnly.of(!!readOnly),
          EditorView.editable.of(!readOnly),
          ...(placeholder ? [placeholderExt(placeholder)] : []),
          ...(words.length ? [autocompletion({ override: [complete] })] : []),
          EditorView.contentAttributes.of({ 'aria-label': ariaLabel ?? 'Editor' }),
          EditorView.updateListener.of((u) => {
            if (u.docChanged) onChangeRef.current?.(u.state.doc.toString())
          }),
        ],
      }),
    })
    view.current = v
    if (editorRef) editorRef.current = v
    return () => {
      v.destroy()
      view.current = null
      if (editorRef) editorRef.current = null
    }
    // The editor is created once per mount; value/language updates are applied below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [readOnly])

  useEffect(() => {
    const v = view.current
    if (v && v.state.doc.toString() !== value) v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: value } })
  }, [value])

  useEffect(() => {
    view.current?.dispatch({ effects: lang.current.reconfigure(languageExt(language)) })
  }, [language])

  useEffect(() => {
    const p = settings.editor
    view.current?.dispatch({ effects: preferences.current.reconfigure([
      EditorView.theme({ '&': { fontSize: `${p.fontSize}px` }, '.cm-scroller': { fontFamily: p.fontFamily || 'monospace' } }),
      EditorState.tabSize.of(p.indentCount),
      indentUnit.of(p.indentType === 'tab' ? '\t' : ' '.repeat(p.indentCount)),
      EditorState.languageData.of(() => [{ closeBrackets: { brackets: [...(p.closeBrackets ? ['(', '[', '{'] : []), ...(p.closeQuotes ? ["'", '"', '`'] : [])] } }]),
    ]) })
  }, [settings.editor, readOnly])

  return <div className="code-editor" ref={host} />
}
