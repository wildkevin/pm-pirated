/** Largest body rendered as text; beyond this the view is truncated to keep the UI responsive. */
export const MAX_RENDER_BYTES = 2 * 1024 * 1024

export type Language = 'json' | 'xml' | 'html' | 'text'

export type BodyView =
  | { kind: 'empty' }
  | { kind: 'binary'; size: number }
  | { kind: 'text'; text: string; pretty: string; language: Language; truncated: boolean }

function detectLanguage(text: string, contentType: string): Language {
  if (/json/i.test(contentType)) return 'json'
  if (/html/i.test(contentType)) return 'html'
  if (/xml/i.test(contentType)) return 'xml'
  if (/^\s*[[{]/.test(text)) {
    try {
      JSON.parse(text)
      return 'json'
    } catch {
      return 'text'
    }
  }
  return 'text'
}

function prettyJson(text: string): string {
  try {
    return JSON.stringify(JSON.parse(text), null, 2)
  } catch {
    return text
  }
}

export function viewBody(bytes: Uint8Array, contentType = ''): BodyView {
  if (bytes.length === 0) return { kind: 'empty' }
  const truncated = bytes.length > MAX_RENDER_BYTES
  const slice = truncated ? bytes.subarray(0, MAX_RENDER_BYTES) : bytes
  let text: string
  try {
    // stream:true tolerates a multi-byte character cut in half by truncation.
    text = new TextDecoder(/charset\s*=\s*["']?([^;\s"']+)/i.exec(contentType)?.[1] ?? 'utf-8', { fatal: true }).decode(slice, { stream: truncated })
  } catch {
    return { kind: 'binary', size: bytes.length }
  }
  if (text.includes('\u0000')) return { kind: 'binary', size: bytes.length }
  const language = detectLanguage(text, contentType)
  return { kind: 'text', text, pretty: language === 'json' && !truncated ? prettyJson(text) : text, language, truncated }
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(2)} KB`
  return `${(n / 1024 / 1024).toFixed(2)} MB`
}

/** Strips Electron's "Error invoking remote method 'x': Error:" prefix from IPC errors. */
export function cleanError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e)
  const cleaned = msg.replace(/^Error invoking remote method '[^']+': (\w*Error: )?/, '').replace(/; if the root CA is installed locally, try running Node.js with --use-system-ca/i, '')
  if (/INCORRECT_PASSWORD/.test(cleaned)) return 'The client certificate passphrase is incorrect. Check it in Settings > Certificates.'
  if (/ERR_UNSAFE_PORT/.test(cleaned)) return 'This port is blocked for token requests. Use a standard HTTP(S) port or change the token endpoint port.'
  return cleaned
}
