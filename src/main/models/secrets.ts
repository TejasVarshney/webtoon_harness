import { z } from 'zod'
import { readJson, writeJsonAtomic } from '../storage/atomic'
import { KeyedMutex } from '../storage/mutex'

/** Symmetric encryption backed by the OS keychain (Electron `safeStorage`); a test double elsewhere. */
export interface Encryptor {
  isAvailable(): boolean
  encrypt(plain: string): Buffer
  decrypt(cipher: Buffer): string
}

/** The OS cannot encrypt secrets here, so an API key is refused rather than stored in the clear. */
export class SecretsUnavailableError extends Error {
  constructor() {
    super('Secure storage is unavailable on this system, so API keys cannot be saved.')
    this.name = 'SecretsUnavailableError'
  }
}

const SecretsFileSchema = z.record(z.string(), z.string())

/**
 * API keys per endpoint id, held as base64 ciphertext in `secrets.json`. Plaintext lives only in
 * this process's memory and never crosses IPC. Keys that no longer decrypt (the file was copied to
 * another machine or user) are dropped from memory, not treated as an error; the user re-enters them.
 */
export class SecretStore {
  private readonly mutex = new KeyedMutex()
  private readonly plain = new Map<string, string>()
  private cipher: Record<string, string> = {}

  constructor(
    private readonly file: string,
    private readonly enc: Encryptor
  ) {}

  /** A missing file is an empty store. A corrupt file throws `CorruptFileError` and is left untouched. */
  async load(): Promise<void> {
    await this.mutex.run(this.file, async () => {
      let stored: Record<string, string>
      try {
        stored = await readJson(this.file, SecretsFileSchema)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
        stored = {}
      }
      this.cipher = stored
      this.plain.clear()
      for (const [id, b64] of Object.entries(stored)) {
        try {
          this.plain.set(id, this.enc.decrypt(Buffer.from(b64, 'base64')))
        } catch {
          // Undecryptable here: unusable, but kept on disk until the user replaces or removes it.
        }
      }
    })
  }

  get(endpointId: string): string | null {
    return this.plain.get(endpointId) ?? null
  }

  /** Stores (or with `null` removes) a key. Storing needs working encryption; removing never does. */
  async set(endpointId: string, key: string | null): Promise<void> {
    await this.mutex.run(this.file, async () => {
      const next = { ...this.cipher }
      if (key === null) {
        delete next[endpointId]
      } else {
        if (!this.enc.isAvailable()) throw new SecretsUnavailableError()
        next[endpointId] = this.enc.encrypt(key).toString('base64')
      }
      await writeJsonAtomic(this.file, next)
      this.cipher = next
      if (key === null) this.plain.delete(endpointId)
      else this.plain.set(endpointId, key)
    })
  }
}
