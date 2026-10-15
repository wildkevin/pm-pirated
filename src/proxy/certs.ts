// Certificates for HTTPS capture: one app root CA, and per-host leaf certificates signed by it.
// Keys come from Node's native crypto (fast); node-forge only builds and signs the certificates.
import forge from 'node-forge'
import { generateKeyPairSync, randomBytes } from 'node:crypto'
import { isIP } from 'node:net'

export interface Pem {
  cert: string
  key: string
}

function newKeyPair(): { privateKey: forge.pki.rsa.PrivateKey; publicKey: forge.pki.rsa.PublicKey; pem: string } {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
  const pem = privateKey.export({ type: 'pkcs1', format: 'pem' }).toString()
  const priv = forge.pki.privateKeyFromPem(pem) as forge.pki.rsa.PrivateKey
  return { privateKey: priv, publicKey: forge.pki.setRsaPublicKey(priv.n, priv.e), pem }
}

const serial = () => `01${randomBytes(15).toString('hex')}`

/** The root CA users trust once (valid 500 days, like Postman's proxy CA). */
export function createCa(commonName = 'PM Local Proxy CA'): Pem {
  const keys = newKeyPair()
  const cert = forge.pki.createCertificate()
  cert.publicKey = keys.publicKey
  cert.serialNumber = serial()
  cert.validity.notBefore = new Date(Date.now() - 24 * 3600 * 1000)
  cert.validity.notAfter = new Date(Date.now() + 500 * 24 * 3600 * 1000)
  const attrs = [
    { name: 'commonName', value: commonName },
    { name: 'organizationName', value: 'PM Local' },
  ]
  cert.setSubject(attrs)
  cert.setIssuer(attrs)
  cert.setExtensions([
    { name: 'basicConstraints', cA: true, critical: true },
    { name: 'keyUsage', keyCertSign: true, cRLSign: true, digitalSignature: true, critical: true },
    { name: 'subjectKeyIdentifier' },
  ])
  cert.sign(keys.privateKey, forge.md.sha256.create())
  return { cert: forge.pki.certificateToPem(cert), key: keys.pem }
}

export function caExpired(certPem: string, now = Date.now()): boolean {
  const c = forge.pki.certificateFromPem(certPem)
  return c.validity.notAfter.getTime() - now < 7 * 24 * 3600 * 1000
}

/** Mints leaf certificates for hosts; one shared leaf key, certificates cached per host. */
export class LeafFactory {
  private ca: forge.pki.Certificate
  private caKey: forge.pki.rsa.PrivateKey
  private leaf = newKeyPair()
  private cache = new Map<string, Pem>()

  constructor(ca: Pem) {
    this.ca = forge.pki.certificateFromPem(ca.cert)
    this.caKey = forge.pki.privateKeyFromPem(ca.key) as forge.pki.rsa.PrivateKey
  }

  forHost(host: string): Pem {
    const hit = this.cache.get(host)
    if (hit) return hit
    const cert = forge.pki.createCertificate()
    cert.publicKey = this.leaf.publicKey
    cert.serialNumber = serial()
    cert.validity.notBefore = new Date(Date.now() - 24 * 3600 * 1000)
    cert.validity.notAfter = new Date(Date.now() + 365 * 24 * 3600 * 1000)
    cert.setSubject([{ name: 'commonName', value: host.slice(0, 64) }])
    cert.setIssuer(this.ca.subject.attributes)
    cert.setExtensions([
      { name: 'basicConstraints', cA: false },
      { name: 'keyUsage', digitalSignature: true, keyEncipherment: true, critical: true },
      { name: 'extKeyUsage', serverAuth: true },
      { name: 'subjectAltName', altNames: [isIP(host) ? { type: 7, ip: host } : { type: 2, value: host }] },
    ])
    cert.sign(this.caKey, forge.md.sha256.create())
    const pem = { cert: forge.pki.certificateToPem(cert), key: this.leaf.pem }
    this.cache.set(host, pem)
    return pem
  }
}
