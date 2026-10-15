import { DEFAULT_SHORTCUTS, type ShortcutBindings } from './shortcuts'
import type { ClientCert } from './engine'

export const THEMES = ['Light', 'High Contrast Light', 'Ayu Light', 'Night Owl Light', 'Solarized Light', 'Dark', 'High Contrast Dark', 'Ayu Dark', 'Dracula', 'Monokai', 'Night Owl Dark', 'Solarized Dark'] as const
export type ThemeName = typeof THEMES[number]

/** Local app preferences, stored separately from workspace data. */
export interface AppSettingsData {
  shortcutBindings: ShortcutBindings
  recentWorkspaces: string[]
  /** Electron zoom level (0 = 100%, each step ≈ ×1.2), like View > Zoom in Postman. */
  zoomLevel: number
  general: {
    httpVersion: 'auto' | 'http1' | 'http2'
    disableCookies: boolean
    sendNoCache: boolean
    tlsKeyLog: boolean
    workingDirectory: string
    responseFormat: 'auto' | 'json'
    /** 0 = never time out. */
    timeoutMs: number
    /** 0 = no limit. */
    maxResponseSizeMb: number
    sslVerification: boolean
    followRedirects: boolean
    sendPostmanToken: boolean
    /** Off by default: a shared collection must not be able to upload e.g. ~/.ssh/id_rsa. */
    allowFilesOutsideWorkingDir: boolean
  }
  appearance: { mode: 'system' | 'manual'; day: ThemeName; night: ThemeName; manual: ThemeName }
  editor: { fontFamily: string; fontSize: number; indentCount: number; indentType: 'space' | 'tab'; closeBrackets: boolean; closeQuotes: boolean }
  ui: { alwaysNewTab: boolean; confirmClose: boolean; tabIcons: boolean; twoPane: boolean; middleWorkbench: boolean; swapSidebars: boolean; variableAutocomplete: boolean; autosave: boolean; shortcuts: boolean }
  proxy: {
    useSystemProxy: boolean
    respectEnvVars: boolean
    /** Credentials for the system proxy ("This proxy requires authentication"). */
    auth: { enabled: boolean; username: string; password: string }
    custom: {
      enabled: boolean
      http: boolean
      https: boolean
      host: string
      port: number
      auth: { enabled: boolean; username: string; password: string }
      /** Comma separated hosts. */
      bypass: string
    }
  }
  certificates: {
    /** Trust the operating system's root certificates (Windows certificate store). */
    useSystemStore: boolean
    ca: { enabled: boolean; file: string }
    client: ClientCert[]
  }
}

export const DEFAULT_SETTINGS: AppSettingsData = {
  shortcutBindings: { ...DEFAULT_SHORTCUTS },
  recentWorkspaces: [],
  zoomLevel: 0,
  general: { httpVersion: 'auto', disableCookies: false, sendNoCache: true, tlsKeyLog: false, workingDirectory: '', responseFormat: 'auto', timeoutMs: 0, maxResponseSizeMb: 50, sslVerification: true, followRedirects: true, sendPostmanToken: true, allowFilesOutsideWorkingDir: false },
  appearance: { mode: 'system', day: 'Light', night: 'Dark', manual: 'Light' },
  editor: { fontFamily: "'IBM Plex Mono', Monaco, 'Courier New', monospace", fontSize: 12, indentCount: 4, indentType: 'space', closeBrackets: true, closeQuotes: true },
  ui: { alwaysNewTab: false, confirmClose: true, tabIcons: true, twoPane: false, middleWorkbench: true, swapSidebars: false, variableAutocomplete: true, autosave: false, shortcuts: true },
  proxy: {
    useSystemProxy: true,
    respectEnvVars: false,
    auth: { enabled: false, username: '', password: '' },
    custom: {
      enabled: false,
      http: true,
      https: true,
      host: '',
      port: 8080,
      auth: { enabled: false, username: '', password: '' },
      bypass: '',
    },
  },
  certificates: { useSystemStore: true, ca: { enabled: false, file: '' }, client: [] },
}

/** Accept pasted HTTPS origins while rejecting paths, credentials and invalid ports. */
export function normalizeCertificateHost(input: string): string | null {
  const host = input.trim().replace(/^https?:\/\//i, '').replace(/\/$/, '')
  if (!host || /[\s/?#@]/.test(host)) return null
  try {
    const url = new URL(`https://${host}`)
    if (!url.hostname || (url.port && Number(url.port) < 1)) return null
    return url.hostname + (/:443$/.test(host) ? ':443' : url.port ? `:${url.port}` : '')
  } catch { return null }
}
