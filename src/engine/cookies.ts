// One cookie jar per workspace, owned by the engine process and persisted to .pmlocal/cookies.json.
import { CookieJar } from '@postman/tough-cookie'
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type { CookieInfo } from '../shared/engine'

const jars = new Map<string, CookieJar>()

export function jarFor(file: string): CookieJar {
  let jar = jars.get(file)
  if (!jar) {
    try {
      jar = CookieJar.deserializeSync(JSON.parse(readFileSync(file, 'utf8')))
    } catch {
      jar = new CookieJar()
    }
    jars.set(file, jar)
  }
  return jar
}

export function saveJar(file: string): void {
  const jar = jars.get(file)
  if (!jar) return
  mkdirSync(dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.tmp`
  writeFileSync(tmp, JSON.stringify(jar.serializeSync()))
  renameSync(tmp, file)
}

function toInfo(c: Record<string, any>): CookieInfo {
  const age = Number(c.maxAge)
  const created = new Date(c.creation ?? Date.now()).getTime()
  const expiry = c.maxAge !== undefined && c.maxAge !== null && Number.isFinite(age) ? new Date(created + age * 1000).toISOString() : c.expires
  return {
    domain: c.domain ?? '',
    path: c.path ?? '/',
    key: c.key ?? '',
    value: c.value ?? '',
    expires: expiry && expiry !== 'Infinity' ? String(expiry) : undefined,
    httpOnly: !!c.httpOnly,
    secure: !!c.secure,
  }
}

export function listCookies(file: string): CookieInfo[] {
  return jarFor(file).serializeSync().cookies.map(toInfo)
}

export function cookiesForUrl(file: string, url: string): CookieInfo[] {
  try {
    return jarFor(file).getCookiesSync(url).map((c) => toInfo(c))
  } catch {
    return []
  }
}

/** Deletes one cookie, all cookies of a path, or a whole domain. */
export function deleteCookies(file: string, domain: string, path?: string, key?: string): void {
  const jar = jarFor(file)
  for (const c of listCookies(file)) {
    if (c.domain !== domain || (path !== undefined && c.path !== path) || (key !== undefined && c.key !== key)) continue
    jar.store.removeCookie(c.domain, c.path, c.key, () => undefined)
  }
  saveJar(file)
}

export function setCookie(file: string, url: string, cookie: string): void {
  jarFor(file).setCookieSync(cookie, url)
  saveJar(file)
}

/** Forget in-memory jars (tests). */
export function resetJars(): void {
  jars.clear()
}
