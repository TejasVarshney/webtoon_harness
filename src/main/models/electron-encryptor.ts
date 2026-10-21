import { safeStorage } from 'electron'
import type { Encryptor } from './secrets'

/** The production `Encryptor`: Electron `safeStorage` (DPAPI / Keychain / libsecret). */
export const electronEncryptor: Encryptor = {
  isAvailable: () => safeStorage.isEncryptionAvailable(),
  encrypt: (plain) => safeStorage.encryptString(plain),
  decrypt: (cipher) => safeStorage.decryptString(cipher)
}
