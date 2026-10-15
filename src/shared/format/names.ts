const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i
const MAX_LENGTH = 100

/** Turns a display name into a file/folder name that is valid on Windows. */
export function sanitizeName(name: string): string {
  let s = name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').trim()
  if (RESERVED.test(s.split('.')[0])) s = `_${s}`
  s = s.slice(0, MAX_LENGTH).replace(/[. ]+$/, '')
  return s || 'Untitled'
}

/** Returns `base + ext`, or `base (n) + ext` if that name is taken (case-insensitive). */
export function uniqueName(base: string, taken: Iterable<string>, ext = ''): string {
  const lower = new Set([...taken].map((t) => t.toLowerCase()))
  let candidate = base + ext
  for (let n = 2; lower.has(candidate.toLowerCase()); n++) candidate = `${base} (${n})${ext}`
  return candidate
}
