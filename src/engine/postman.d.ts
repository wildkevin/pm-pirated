declare module 'postman-runtime' {
  interface Run {
    start(callbacks: Record<string, (...args: any[]) => void>): void
    abort(): void
  }
  const runtime: {
    Runner: new () => {
      run(collection: unknown, options: Record<string, unknown>, cb: (err: Error | null, run: Run) => void): void
    }
  }
  export default runtime
}

declare module 'postman-collection' {
  export class Collection {
    constructor(definition: unknown)
  }
  export class VariableScope {
    constructor(definition: unknown)
    values: { toJSON(): { key: string; value: unknown; type?: string; disabled?: boolean }[] }
  }
  export class ProxyConfig {
    constructor(definition: unknown)
  }
  export class ProxyConfigList {
    constructor(parent: unknown, list: unknown[])
  }
  export class CertificateList {
    constructor(parent: unknown, list: unknown[])
  }
  export class Request {
    constructor(definition: unknown)
  }
  export class Url {
    constructor(definition: unknown)
    toString(): string
    static parse(raw: string): Record<string, unknown>
  }
}

declare module 'postman-code-generators' {
  const codegen: {
    getLanguageList(): { key: string; label: string; syntax_mode: string; variants: { key: string }[] }[]
    convert(language: string, variant: string, request: unknown, options: Record<string, unknown>, cb: (err: Error | null, snippet: string) => void): void
  }
  export default codegen
}

declare module 'curl-to-postmanv2' {
  const converter: { convert(input: unknown, cb: (err: Error | null, result: any) => void): void }
  export default converter
}

declare module '@postman/tough-cookie' {
  export class CookieJar {
    constructor(store?: unknown, options?: unknown)
    static deserializeSync(serialized: unknown): CookieJar
    serializeSync(): { cookies: Record<string, any>[] }
    setCookieSync(cookie: string, url: string, options?: unknown): unknown
    getCookiesSync(url: string): Record<string, any>[]
    store: { removeCookie(domain: string, path: string, key: string, cb: (err: unknown) => void): void }
  }
}
