export const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'] as const

/** Short labels used in the sidebar, as in Postman. */
export function methodLabel(method: string): string {
  const m = method.toUpperCase()
  return m === 'DELETE' ? 'DEL' : m === 'OPTIONS' ? 'OPT' : m
}

export function methodClass(method: string): string {
  const m = method.toLowerCase()
  return (METHODS as readonly string[]).includes(m.toUpperCase()) ? `method method-${m}` : 'method method-other'
}
