import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { CorruptFileError } from '../domain/errors'
import { FakeEncryptor } from '../test/fake-encryptor'
import { SecretsUnavailableError, SecretStore } from './secrets'

let dir: string
let file: string
let enc: FakeEncryptor

beforeEach(async () => {
  dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'webtoon test secrets '))
  file = path.join(dir, 'secrets.json')
  enc = new FakeEncryptor()
})
afterEach(async () => {
  await fs.promises.rm(dir, { recursive: true, force: true, maxRetries: 5 })
})

describe('SecretStore', () => {
  it('loads an empty store when the file is missing', async () => {
    const s = new SecretStore(file, enc)
    await s.load()
    expect(s.get('end_0000000001')).toBeNull()
  })

  it('stores base64 ciphertext, never plaintext, and round-trips across instances', async () => {
    const s = new SecretStore(file, enc)
    await s.load()
    await s.set('end_0000000001', 'sk-SECRET')
    const raw = await fs.promises.readFile(file, 'utf8')
    expect(raw).not.toContain('SECRET')
    expect(JSON.parse(raw)).toEqual({ end_0000000001: Buffer.from(enc.encrypt('sk-SECRET')).toString('base64') })
    const again = new SecretStore(file, enc)
    await again.load()
    expect(again.get('end_0000000001')).toBe('sk-SECRET')
  })

  it('removes a key with null', async () => {
    const s = new SecretStore(file, enc)
    await s.load()
    await s.set('end_0000000001', 'k')
    await s.set('end_0000000001', null)
    expect(s.get('end_0000000001')).toBeNull()
    expect(JSON.parse(await fs.promises.readFile(file, 'utf8'))).toEqual({})
  })

  it('refuses to store a key when encryption is unavailable, but still allows removal', async () => {
    const s = new SecretStore(file, enc)
    await s.load()
    await s.set('end_0000000001', 'k')
    enc.available = false
    await expect(s.set('end_0000000002', 'k2')).rejects.toBeInstanceOf(SecretsUnavailableError)
    await s.set('end_0000000001', null)
    expect(s.get('end_0000000001')).toBeNull()
  })

  it('drops entries that cannot be decrypted instead of failing the load', async () => {
    await fs.promises.writeFile(file, JSON.stringify({ end_0000000001: 'AAAA' }))
    const throwing = Object.assign(new FakeEncryptor(), {
      decrypt: () => {
        throw new Error('wrong machine')
      }
    })
    const s = new SecretStore(file, throwing)
    await s.load()
    expect(s.get('end_0000000001')).toBeNull()
  })

  it('reports a corrupt file rather than overwriting it', async () => {
    await fs.promises.writeFile(file, '{not json')
    const s = new SecretStore(file, enc)
    await expect(s.load()).rejects.toBeInstanceOf(CorruptFileError)
    expect(await fs.promises.readFile(file, 'utf8')).toBe('{not json')
  })
})
