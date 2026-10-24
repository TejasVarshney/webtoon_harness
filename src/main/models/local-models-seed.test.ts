import { execFileSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { EventBus } from '../events/bus'
import { FakeEncryptor } from '../test/fake-encryptor'
import { ModelRegistry } from './registry'
import { SecretStore } from './secrets'

const SEED = path.resolve(__dirname, '../../../tools/local-models/seed-models.mjs')
const dirs: string[] = []

async function seededRegistry(...flags: string[]): Promise<ModelRegistry> {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'local seed '))
  dirs.push(dir)
  execFileSync(process.execPath, [SEED, '--user-data', dir, ...flags])
  const secrets = new SecretStore(path.join(dir, 'secrets.json'), new FakeEncryptor())
  await secrets.load()
  const registry = new ModelRegistry({ file: path.join(dir, 'models.json'), secrets, bus: new EventBus() })
  await registry.load()
  return registry
}

afterEach(async () => {
  for (const dir of dirs.splice(0)) await fs.promises.rm(dir, { recursive: true, force: true })
})

describe('tools/local-models/seed-models.mjs', () => {
  it('writes a models.json the app accepts, wired to gemma4 and the SDXL bridge', async () => {
    const registry = await seededRegistry()
    const view = registry.view()
    expect(view.effectiveRoles).toEqual({ agent: 'mdl_00000000a1', panelChat: 'mdl_00000000a1', vision: null, image: 'mdl_00000000a2', imageEdit: 'mdl_00000000a2' })
    expect(registry.resolve('agent')).toMatchObject({ endpoint: { kind: 'openai', baseUrl: 'http://localhost:11434/v1' }, model: { modelId: 'gemma4-webtoon', capabilities: ['text'] } })
    expect(registry.resolve('image')).toMatchObject({ endpoint: { baseUrl: 'http://127.0.0.1:7861/v1' }, model: { modelId: 'sdxl-webtoon' } })
    expect(view.endpoints.map((e) => e.kind)).toContain('mock')
  })

  it('--vision makes gemma4 the consistency checker too', async () => {
    const registry = await seededRegistry('--vision')
    expect(registry.view().effectiveRoles.vision).toBe('mdl_00000000a1')
    expect(registry.resolve('vision').model.capabilities).toEqual(['text', 'vision'])
  })
})
