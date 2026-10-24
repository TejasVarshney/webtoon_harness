import type { Encryptor } from '../models/secrets'

/** A reversible, deliberately not-secret `Encryptor` double: ciphertext is the reversed string. */
export class FakeEncryptor implements Encryptor {
  available = true

  isAvailable(): boolean {
    return this.available
  }

  encrypt(plain: string): Buffer {
    return Buffer.from([...plain].reverse().join(''), 'utf8')
  }

  decrypt(cipher: Buffer): string {
    return [...cipher.toString('utf8')].reverse().join('')
  }
}
