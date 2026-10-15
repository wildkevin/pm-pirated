function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((k) => [k, sortKeys((value as Record<string, unknown>)[k])]),
    )
  }
  return value
}

/** JSON with sorted keys, 2-space indent and a trailing newline, so files diff cleanly. */
export function stableStringify(value: unknown): string {
  return JSON.stringify(sortKeys(value), null, 2) + '\n'
}
