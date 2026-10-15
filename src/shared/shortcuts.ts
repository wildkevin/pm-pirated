/** Portable bindings: Mod is Command on macOS and Control on Windows/Linux. */
export const SHORTCUTS = [
  ['closeTab', 'Close Tab', 'Tabs', 'Mod+KeyW'],
  ['forceCloseTab', 'Force Close Tab', 'Tabs', 'Mod+Alt+KeyW'],
  ['nextTab', 'Switch To Next Tab', 'Tabs', 'Mod+Shift+BracketRight'],
  ['previousTab', 'Switch To Previous Tab', 'Tabs', 'Mod+Shift+BracketLeft'],
  ...Array.from({ length: 8 }, (_, i) => [`tab${i + 1}`, `Switch To Tab ${i + 1}`, 'Tabs', `Mod+Digit${i + 1}`] as const),
  ['lastTab', 'Switch To Last Tab', 'Tabs', 'Mod+Digit9'],
  ['reopenTab', 'Reopen Last Closed Tab', 'Tabs', 'Mod+Shift+KeyT'],
  ['runner', 'New Runner Tab', 'Tabs', 'Mod+Shift+KeyR'],
  ['searchTabs', 'Search Tabs', 'Tabs', 'Mod+Shift+KeyA'],
  ['searchSidebar', 'Search Sidebar', 'Sidebar', 'Mod+KeyF'],
  ['sidebarNext', 'Next Item', 'Sidebar', 'ArrowDown'],
  ['sidebarPrevious', 'Previous Item', 'Sidebar', 'ArrowUp'],
  ['sidebarExpand', 'Expand Item', 'Sidebar', 'ArrowRight'],
  ['sidebarExpandAll', 'Expand All', 'Sidebar', 'Alt+ArrowRight'],
  ['sidebarCollapse', 'Collapse Item', 'Sidebar', 'ArrowLeft'],
  ['sidebarCollapseAll', 'Collapse All', 'Sidebar', 'Alt+ArrowLeft'],
  ['sidebarSelect', 'Select Item', 'Sidebar', 'Enter'],
  ['sidebarRename', 'Rename Item', 'Sidebar', 'Mod+KeyE'],
  ['sidebarDuplicate', 'Duplicate Item', 'Sidebar', 'Mod+KeyD'],
  ['sidebarDelete', 'Delete Item', 'Sidebar', 'Backspace'],
  ['requestUrl', 'Request URL', 'Request', 'Mod+KeyL'],
  ['save', 'Save Request', 'Request', 'Mod+KeyS'],
  ['saveAs', 'Save Request As', 'Request', 'Mod+Shift+KeyS'],
  ['send', 'Send Request', 'Request', 'Mod+Enter'],
  ['sendDownload', 'Send And Download Request', 'Request', 'Mod+Alt+Enter'],
  ['zoomIn', 'Zoom In', 'Interface', 'Mod+Equal'],
  ['zoomOut', 'Zoom Out', 'Interface', 'Mod+Minus'],
  ['zoomReset', 'Reset Zoom', 'Interface', 'Mod+Digit0'],
  ['twoPane', 'Toggle Two-Pane View', 'Interface', 'Mod+Alt+KeyV'],
  ['leftSidebar', 'Toggle Left Sidebar', 'Interface', 'Mod+Backslash'],
  ['rightSidebar', 'Toggle Right Sidebar', 'Interface', 'Mod+Alt+Backslash'],
  ['workbench', 'Toggle Workbench', 'Interface', 'Mod+Alt+KeyM'],
  ['swapSidebars', 'Swap Sidebars', 'Interface', 'Mod+Alt+KeyS'],
  ['resetLayout', 'Reset Layout', 'Interface', 'Mod+Alt+KeyR'],
  ['environment', 'Environment Selector', 'Interface', 'Alt+KeyE'],
  ['newRequest', 'New Request Tab', 'Window and modals', 'Mod+KeyT'],
  ['import', 'Import', 'Window and modals', 'Mod+KeyO'],
  ['settings', 'Settings', 'Window and modals', 'Mod+Comma'],
  ['shortcutHelp', 'Open Shortcut Help', 'Window and modals', 'Mod+Slash'],
  ['search', 'Search', 'Window and modals', 'Mod+KeyK'],
  ['back', 'Go Back', 'Window and modals', 'Mod+BracketLeft'],
  ['forward', 'Go Forward', 'Window and modals', 'Mod+BracketRight'],
  ['clearConsole', 'Clear Console', 'Console', 'Mod+Shift+KeyK'],
  ['console', 'Show/Hide Console', 'Console', 'Ctrl+Backquote'],
] as const
export type ShortcutId = typeof SHORTCUTS[number][0]
export type ShortcutBindings = Record<ShortcutId, string>
export const DEFAULT_SHORTCUTS = Object.fromEntries(SHORTCUTS.map(([id, , , binding]) => [id, binding])) as ShortcutBindings
export const sidebarShortcut = (id: string) => id.startsWith('sidebar')

interface KeyInput { code: string; key: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean; isComposing?: boolean }
export function bindingFromEvent(e: KeyInput, mac: boolean): string | null {
  if (e.isComposing || /^(Control|Shift|Alt|Meta|OS|CapsLock|Fn)/.test(e.code)) return null
  let code = e.code
  if (!code) code = e.key.length === 1 && /[a-z]/i.test(e.key) ? `Key${e.key.toUpperCase()}` : e.key
  if (code === 'NumpadAdd') code = 'Equal'
  if (code === 'NumpadSubtract') code = 'Minus'
  if (code === 'NumpadEnter') code = 'Enter'
  return [...(mac ? e.metaKey ? ['Mod'] : [] : e.ctrlKey ? ['Mod'] : []), ...(mac && e.ctrlKey ? ['Ctrl'] : []), ...(!mac && e.metaKey ? ['Meta'] : []), ...(e.altKey ? ['Alt'] : []), ...(e.shiftKey ? ['Shift'] : []), code].join('+')
}
export function matchesBinding(binding: string, e: KeyInput, mac: boolean): boolean {
  if (!binding) return false
  const actual = bindingFromEvent(e, mac)
  // Both '=' and '+' are customary zoom-in keys; this alias belongs only to the default binding.
  return actual === (mac ? binding : binding.replace(/^Ctrl\+/, 'Mod+')) || (binding === 'Mod+Equal' && actual === 'Mod+Shift+Equal')
}
export function findShortcut(bindings: ShortcutBindings, e: KeyInput, mac: boolean, sidebar = false): ShortcutId | undefined {
  return SHORTCUTS.find(([id]) => sidebarShortcut(id) === sidebar && matchesBinding(bindings[id], e, mac))?.[0]
}
const names: Record<string, string> = { BracketLeft: '[', BracketRight: ']', Backslash: '\\', Slash: '/', Comma: ',', Period: '.', Equal: '+', Minus: '−', Backquote: '`', Enter: 'Enter', ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', Backspace: 'Backspace', Space: 'Space', Quote: "'", Semicolon: ';' }
export function displayBinding(binding: string, mac: boolean): string {
  return binding ? binding.split('+').map(p => p === 'Mod' ? mac ? '⌘' : 'Ctrl' : p === 'Alt' ? mac ? '⌥' : 'Alt' : p === 'Shift' ? mac ? '⇧' : 'Shift' : p === 'Ctrl' ? mac ? '⌃' : 'Ctrl' : names[p] ?? p.replace(/^(Key|Digit)/, '')).join(' ') : 'Unassigned'
}
export function bindingError(id: ShortcutId, binding: string, bindings: ShortcutBindings): string | null {
  if (!binding) return null
  if (!/^(?:Mod\+)?(?:Ctrl\+)?(?:Meta\+)?(?:Alt\+)?(?:Shift\+)?(?:Key[A-Z]|Digit[0-9]|F(?:[1-9]|1[0-9]|2[0-4])|Arrow(?:Up|Down|Left|Right)|Enter|Backspace|Delete|Home|End|PageUp|PageDown|Space|BracketLeft|BracketRight|Backslash|Slash|Comma|Period|Equal|Minus|Backquote|Quote|Semicolon)$/.test(binding)) return 'This key combination is not supported.'
  if (!sidebarShortcut(id) && !/(?:Mod|Ctrl|Alt)\+/.test(binding) && !/^F\d+$/.test(binding)) return 'Use Command/Ctrl or Alt with a key, or a function key.'
  if (['Mod+KeyQ', 'Mod+KeyH', 'Mod+KeyM', 'Mod+KeyC', 'Mod+KeyV', 'Mod+KeyX', 'Mod+KeyA', 'Mod+KeyZ', 'Mod+Shift+KeyZ', 'Mod+KeyY', 'Alt+F4', 'Mod+Space', 'Mod+Tab', 'Mod+Ctrl+KeyF'].includes(binding) || binding.includes('Meta+')) return 'This combination is reserved for system or text-editing commands.'
  const portable = (b: string) => b.replace(/^Ctrl\+/, 'Mod+')
  const conflict = SHORTCUTS.find(([other]) => other !== id && (portable(bindings[other]) === portable(binding) || [bindings[other], binding].every(b => b === 'Mod+Equal' || b === 'Mod+Shift+Equal')))
  return conflict ? `Already assigned to ${conflict[1]}. Clear or change that shortcut first.` : null
}
