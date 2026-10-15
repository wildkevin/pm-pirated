import { displayBinding, type ShortcutId } from '../shared/shortcuts'
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { DEFAULT_SETTINGS, type AppSettingsData, type ThemeName } from '../shared/settings'

const SettingsContext = createContext(DEFAULT_SETTINGS)
export const VariableNamesContext = createContext<string[]>([])
export const useSettings = () => useContext(SettingsContext)
export function useShortcutLabel() {
  const settings = useSettings()
  return (id: ShortcutId) => settings.ui.shortcuts && settings.shortcutBindings[id] ? displayBinding(settings.shortcutBindings[id], /Mac/.test(navigator.platform)) : ''
}

// Palette values remain CSS tokens so every surface, including popovers, follows the theme.
export const palettes: Record<ThemeName, [string, string, string, string, string, string]> = {
  Light: ['#ffffff', '#f9f9f9', '#f2f2f2', '#ededed', '#212121', '#6b6b6b'],
  'High Contrast Light': ['#ffffff', '#ffffff', '#eeeeee', '#777777', '#000000', '#333333'],
  'Ayu Light': ['#fafafa', '#f3f4f5', '#e7e8e9', '#d5d8da', '#575f66', '#6b737b'],
  'Night Owl Light': ['#fbfbfb', '#f0f0f0', '#e5e9ef', '#d3d9df', '#403f53', '#64647b'],
  'Solarized Light': ['#fdf6e3', '#eee8d5', '#e5dfcd', '#d6cfbb', '#586e75', '#657b83'],
  Dark: ['#212121', '#262626', '#303030', '#3b3b3b', '#f2f2f2', '#a6a6a6'],
  'High Contrast Dark': ['#000000', '#0a0a0a', '#202020', '#aaaaaa', '#ffffff', '#dddddd'],
  'Ayu Dark': ['#0b0e14', '#10151d', '#1b2431', '#303c4c', '#bfbdb6', '#929aaa'],
  Dracula: ['#282a36', '#21222c', '#343746', '#44475a', '#f8f8f2', '#b5b8ce'],
  Monokai: ['#272822', '#20211c', '#38392f', '#494a40', '#f8f8f2', '#b6b6a9'],
  'Night Owl Dark': ['#011627', '#061e30', '#0b2942', '#23445c', '#d6deeb', '#92a9bf'],
  'Solarized Dark': ['#002b36', '#073642', '#124450', '#285561', '#b3c3c3', '#93a1a1'],
}
export const isDarkTheme = (name: ThemeName) => !name.includes('Light')
export function SettingsProvider({ settings, children }: { settings: AppSettingsData | null; children: ReactNode }) {
  const s = settings ?? DEFAULT_SETTINGS
  const [systemDark, setSystemDark] = useState(() => matchMedia('(prefers-color-scheme: dark)').matches)
  useEffect(() => {
    const query = matchMedia('(prefers-color-scheme: dark)')
    const change = () => setSystemDark(query.matches)
    query.addEventListener('change', change)
    return () => query.removeEventListener('change', change)
  }, [])
  const name = s.appearance.mode === 'system' ? (systemDark ? s.appearance.night : s.appearance.day) : s.appearance.manual
  useEffect(() => {
    const root = document.documentElement
    const palette = palettes[name] ?? palettes.Light
    const dark = isDarkTheme(name)
    root.dataset.theme = name
    root.dataset.dark = String(dark)
    root.style.colorScheme = dark ? 'dark' : 'light'
    for (const [i, token] of ['--grey-00', '--grey-05', '--grey-10', '--grey-20', '--grey-90', '--grey-50'].entries()) root.style.setProperty(token, palette[i])
    root.style.setProperty('--grey-30', palette[3])
    root.style.setProperty('--grey-40', dark ? '#858585' : '#808080')
    root.style.setProperty('--font-code', s.editor.fontFamily || DEFAULT_SETTINGS.editor.fontFamily)
  }, [name, s.editor.fontFamily])
  return <SettingsContext.Provider value={s}>{children}</SettingsContext.Provider>
}
