/** Encrypts small secrets at rest. Production uses Electron safeStorage (Windows DPAPI); tests use a fake. */
export interface Crypt {
  encrypt(plain: string): string
  decrypt(cipher: string): string
}

/** For tests only: reversible, NOT secure. */
export const fakeCrypt: Crypt = {
  encrypt: (s) => `fake:${Buffer.from(s).toString('base64')}`,
  decrypt: (s) => Buffer.from(s.replace(/^fake:/, ''), 'base64').toString(),
}

export function safeStorageCrypt(safeStorage: {
  isEncryptionAvailable(): boolean
  encryptString(s: string): Buffer
  decryptString(b: Buffer): string
}): Crypt {
  return {
    encrypt(plain) {
      if (!safeStorage.isEncryptionAvailable()) throw new Error('OS encryption is not available; cannot store secrets')
      return safeStorage.encryptString(plain).toString('base64')
    },
    decrypt: (cipher) => safeStorage.decryptString(Buffer.from(cipher, 'base64')),
  }
}
