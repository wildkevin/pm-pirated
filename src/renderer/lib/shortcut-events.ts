import { Prec } from '@codemirror/state'
import { EditorView } from '@codemirror/view'

export const appShortcutEvents = new WeakSet<KeyboardEvent>()

// CodeMirror flushes DOM input before running these handlers. Consume reserved app
// keys here, before its own keymaps, then let the window's bubble listener act.
export const appShortcutHandler = Prec.highest(EditorView.domEventHandlers({
  keydown: event => appShortcutEvents.has(event),
}))
