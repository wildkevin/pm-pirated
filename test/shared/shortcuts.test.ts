import { describe, expect, it } from 'vitest'
import { ARGS } from '../../src/main/ipcSchemas'
import { DEFAULT_SETTINGS } from '../../src/shared/settings'
import { bindingError, bindingFromEvent, DEFAULT_SHORTCUTS, findShortcut, matchesBinding, SHORTCUTS } from '../../src/shared/shortcuts'

const key = (code: string, modifiers: Partial<{ metaKey: boolean; ctrlKey: boolean; altKey: boolean; shiftKey: boolean }> = {}) => ({ code, key: code, metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, ...modifiers })
describe('shortcut dispatch', () => {
  it('has valid nonconflicting defaults and rejects invalid IPC bindings', () => {
    for (const [id] of SHORTCUTS) expect(bindingError(id, DEFAULT_SHORTCUTS[id], DEFAULT_SHORTCUTS), id).toBeNull()
    expect(ARGS.saveSettings.safeParse([DEFAULT_SETTINGS]).success).toBe(true)
    expect(ARGS.saveSettings.safeParse([{ ...DEFAULT_SETTINGS, shortcutBindings: { ...DEFAULT_SHORTCUTS, save: 'Mod+KeyW' } }]).success).toBe(false)
  })
  it('distinguishes all modifier combinations instead of falling through to save/send', () => {
    expect(findShortcut(DEFAULT_SHORTCUTS, key('KeyS', { metaKey: true }), true)).toBe('save')
    expect(findShortcut(DEFAULT_SHORTCUTS, key('KeyS', { metaKey: true, shiftKey: true }), true)).toBe('saveAs')
    expect(findShortcut(DEFAULT_SHORTCUTS, key('KeyS', { metaKey: true, altKey: true }), true)).toBe('swapSidebars')
    expect(findShortcut(DEFAULT_SHORTCUTS, key('KeyS', { metaKey: true, altKey: true, shiftKey: true }), true)).toBeUndefined()
    expect(findShortcut(DEFAULT_SHORTCUTS, key('Enter', { ctrlKey: true, altKey: true }), false)).toBe('sendDownload')
  })
  it('uses physical keys for Option characters, portable Mod and explicit macOS Control', () => {
    expect(bindingFromEvent({ ...key('KeyS', { metaKey: true, altKey: true }), key: 'ß' }, true)).toBe('Mod+Alt+KeyS')
    expect(findShortcut(DEFAULT_SHORTCUTS, key('Backquote', { ctrlKey: true }), true)).toBe('console')
    expect(findShortcut(DEFAULT_SHORTCUTS, key('Backquote', { ctrlKey: true }), false)).toBe('console')
    expect(bindingFromEvent(key('ShiftLeft', { shiftKey: true }), true)).toBeNull()
  })
  it('unassigns old keys, isolates sidebar commands and blocks text/system conflicts', () => {
    const bindings = { ...DEFAULT_SHORTCUTS, closeTab: 'Mod+Alt+Shift+KeyW', save: '' }
    expect(findShortcut(bindings, key('KeyW', { ctrlKey: true }), false)).toBeUndefined()
    expect(findShortcut(bindings, key('KeyW', { ctrlKey: true, altKey: true, shiftKey: true }), false)).toBe('closeTab')
    expect(findShortcut(bindings, key('KeyS', { ctrlKey: true }), false)).toBeUndefined()
    expect(findShortcut(bindings, key('ArrowDown'), false)).toBeUndefined()
    expect(findShortcut(bindings, key('ArrowDown'), false, true)).toBe('sidebarNext')
    expect(bindingError('save', 'Mod+KeyC', bindings)).toContain('reserved')
    expect(bindingError('save', 'KeyS', bindings)).toContain('Command/Ctrl')
    expect(matchesBinding('Mod+Equal', key('Equal', { ctrlKey: true, shiftKey: true }), false)).toBe(true)
  })
})
