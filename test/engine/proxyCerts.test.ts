import { X509Certificate, createPublicKey } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { LeafFactory, caExpired, createCa } from '../../src/proxy/certs'

describe('proxy certificates', () => {
  const ca = createCa()

  it('creates a CA that is valid for ~500 days', () => {
    const c = new X509Certificate(ca.cert)
    expect(c.ca).toBe(true)
    expect(c.subject).toContain('CN=PM Local Proxy CA')
    const days = (new Date(c.validTo).getTime() - Date.now()) / 86_400_000
    expect(days).toBeGreaterThan(495)
    expect(caExpired(ca.cert)).toBe(false)
    expect(caExpired(ca.cert, Date.now() + 499 * 86_400_000)).toBe(true)
  })

  it('mints host certificates signed by the CA, with the right SAN, cached per host', () => {
    const f = new LeafFactory(ca)
    const leaf = f.forHost('api.example.test')
    const c = new X509Certificate(leaf.cert)
    expect(c.verify(createPublicKey(ca.cert))).toBe(true)
    expect(c.checkHost('api.example.test')).toBe('api.example.test')
    expect(c.checkHost('other.test')).toBeUndefined()
    expect(f.forHost('api.example.test')).toBe(leaf)
    expect(new X509Certificate(f.forHost('127.0.0.1').cert).checkIP('127.0.0.1')).toBe('127.0.0.1')
  })

  it('is fast enough to mint on the fly', () => {
    const f = new LeafFactory(ca)
    const t0 = Date.now()
    for (let i = 0; i < 20; i++) f.forHost(`h${i}.test`)
    expect(Date.now() - t0).toBeLessThan(2000)
  })
})
