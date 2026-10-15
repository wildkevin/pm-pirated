import type { PmKeyValue } from '../../shared/format/types'

/** Postman's Bulk Edit format: `key:value` per line, `//` prefix = disabled row. */
export function toBulk(rows: PmKeyValue[]): string {
  return rows.map((r) => `${r.disabled ? '//' : ''}${r.key}:${r.value}`).join('\n')
}

export function fromBulk(text: string): PmKeyValue[] {
  return text
    .split('\n')
    .filter((l) => l.trim())
    .map((line) => {
      const disabled = line.startsWith('//')
      const body = disabled ? line.slice(2) : line
      const i = body.indexOf(':')
      const row = i === -1 ? { key: body.trim(), value: '' } : { key: body.slice(0, i).trim(), value: body.slice(i + 1).trim() }
      return disabled ? { ...row, disabled: true } : row
    })
}

/** "Today", "Yesterday" or e.g. "October 13" (with year if not this year), for history groups. */
export function dayLabel(ts: number, now = Date.now()): string {
  const d = new Date(ts)
  const today = new Date(now)
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
  const days = Math.round((startOf(today) - startOf(d)) / 86_400_000)
  if (days === 0) return 'Today'
  if (days === 1) return 'Yesterday'
  return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', ...(d.getFullYear() !== today.getFullYear() ? { year: 'numeric' } : {}) })
}

export function groupBy<T>(items: T[], key: (t: T) => string): [string, T[]][] {
  const groups = new Map<string, T[]>()
  for (const it of items) {
    const k = key(it)
    groups.set(k, [...(groups.get(k) ?? []), it])
  }
  return [...groups]
}

/** Splits text into plain parts and `{{var}}` parts, for variable highlighting. */
export function splitVariables(text: string): { text: string; variable?: string }[] {
  const out: { text: string; variable?: string }[] = []
  let last = 0
  for (const m of text.matchAll(/\{\{([^{}]+)\}\}/g)) {
    if (m.index! > last) out.push({ text: text.slice(last, m.index) })
    out.push({ text: m[0], variable: m[1].trim() })
    last = m.index! + m[0].length
  }
  if (last < text.length) out.push({ text: text.slice(last) })
  return out
}

/** Dynamic variables are always defined (resolved at send time). */
export const isDynamicVariable = (name: string) => name.startsWith('$')

/** Modifier shown in shortcut hints: ⌘ on macOS, Ctrl+ elsewhere (like Postman). */
export const mod = typeof navigator !== 'undefined' && /Mac/.test(navigator.platform) ? '⌘' : 'Ctrl+'
