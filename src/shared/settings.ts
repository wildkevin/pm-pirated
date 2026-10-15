import type { ClientCert } from './engine'

/** App settings (Postman's Settings dialog: General, Proxy, Certificates). */
export interface AppSettingsData {
  recentWorkspaces: string[]
  /** Electron zoom level (0 = 100%, each step ≈ ×1.2), like View > Zoom in Postman. */
  zoomLevel: number
  general: {
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
  recentWorkspaces: [],
  zoomLevel: 0,
  general: { timeoutMs: 0, maxResponseSizeMb: 50, sslVerification: true, followRedirects: true, sendPostmanToken: true, allowFilesOutsideWorkingDir: false },
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
