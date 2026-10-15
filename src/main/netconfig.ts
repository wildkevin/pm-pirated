// Corporate network support: system proxy (PAC/WPAD via Chromium) and extra trusted CAs.
import { readFile } from 'node:fs/promises'
import { getCACertificates } from 'node:tls'
import type { EngineOptions, ProxyJson } from '../shared/engine'
import type { AppSettingsData } from '../shared/settings'
import { writeFileAtomic } from './workspace/fsAtomic'

/**
 * Turns Chromium's proxy answer ("PROXY host:port; DIRECT", "DIRECT", "SOCKS5 …") into a proxy for
 * the engine. ponytail: only HTTP proxies; SOCKS/HTTPS-proxy entries fall through to the next entry.
 */
export function parseProxyResult(result: string): { host: string; port: number } | null {
  for (const entry of result.split(';').map((s) => s.trim())) {
    if (/^DIRECT$/i.test(entry)) return null
    const m = /^PROXY\s+\[?([^\]\s]+?)\]?:(\d+)$/i.exec(entry)
    if (m) return { host: m[1], port: Number(m[2]) }
  }
  return null
}

export async function systemProxyFor(
  resolveProxy: (url: string) => Promise<string>,
  url: string,
  settings: AppSettingsData,
): Promise<ProxyJson | null> {
  const p = parseProxyResult(await resolveProxy(url))
  if (!p) return null
  const { auth } = settings.proxy
  return {
    ...p,
    tunnel: false,
    ...(auth.enabled && auth.username ? { authenticate: true, username: auth.username, password: auth.password } : {}),
  }
}

/**
 * Writes the extra trusted CAs (OS store + user CA file) to one PEM file for the engine.
 * Returns undefined when there is nothing extra to trust.
 */
export async function writeCaBundle(file: string, settings: AppSettingsData): Promise<string | undefined> {
  const pems: string[] = []
  if (settings.certificates.useSystemStore) {
    try {
      pems.push(...getCACertificates('system'))
    } catch {
      // Older runtimes without system store access: fall back to Node's bundled roots only.
    }
  }
  const { ca } = settings.certificates
  if (ca.enabled && ca.file) pems.push(await readFile(ca.file, 'utf8'))
  if (pems.length === 0) return undefined
  await writeFileAtomic(file, pems.join('\n'))
  return file
}

export function engineOptions(settings: AppSettingsData, extraCaFile: string | undefined): EngineOptions {
  const { general, proxy, certificates } = settings
  const c = proxy.custom
  const protocols = [...(c.http ? ['http' as const] : []), ...(c.https ? ['https' as const] : [])]
  return {
    timeoutMs: general.timeoutMs,
    maxResponseSizeMb: general.maxResponseSizeMb,
    strictSSL: general.sslVerification,
    followRedirects: general.followRedirects,
    sendPostmanToken: general.sendPostmanToken,
    allowFilesOutsideWorkingDir: general.allowFilesOutsideWorkingDir,
    allowedFiles: [
      ...certificates.client.flatMap((c) => [c.cert, c.key, c.pfx]),
      ...(certificates.ca.enabled ? [certificates.ca.file] : []),
    ].filter((f): f is string => !!f),
    useSystemProxy: proxy.useSystemProxy,
    respectProxyEnv: proxy.respectEnvVars,
    ...(c.enabled && c.host && protocols.length
      ? {
          customProxy: {
            host: c.host,
            port: c.port,
            protocols,
            bypass: c.bypass.split(',').map((s) => s.trim()).filter(Boolean),
            ...(c.auth.enabled ? { username: c.auth.username, password: c.auth.password } : {}),
          },
        }
      : {}),
    ...(extraCaFile ? { extraCaFile } : {}),
    clientCerts: certificates.client.filter((cc) => cc.host && (cc.cert || cc.pfx)),
  }
}
