// Writes models.json for a sandbox user-data folder so the app draws with the ChatGPT bridge (E:\claude\chatgpt-bridge):
//   agent -> the offline mock, image + imageEdit -> chatgpt-image, vision (consistency check) -> chatgpt.
//   node tools/local-models/seed-bridge-models.mjs --user-data <dir> [--force]
// The bridge is OpenAI-compatible and needs no API key, so no secret is stored. BRIDGE_URL overrides the base URL.
// Never run this while the app is open on the same folder (the app rewrites models.json on every change).
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const arg = (name) => {
  const i = process.argv.indexOf(name)
  return i === -1 ? undefined : process.argv[i + 1]
}
const userData = arg('--user-data')
if (!userData) {
  console.error('usage: node tools/local-models/seed-bridge-models.mjs --user-data <dir> [--force]')
  process.exit(2)
}
const force = process.argv.includes('--force')
const bridge = (process.env.BRIDGE_URL ?? 'http://127.0.0.1:7870/v1').replace(/\/$/, '')

const file = join(resolve(userData), 'models.json')
if (existsSync(file) && !force) {
  console.log(`${file} exists; keeping it (pass --force to overwrite)`)
  process.exit(0)
}

// Ids follow the app's `<prefix>_<10 hex>` rule; the mock ones match what the app seeds itself.
const models = {
  endpoints: [
    { id: 'end_0000000000', name: 'Mock (offline)', kind: 'mock', baseUrl: 'mock://local', options: {} },
    // One image takes 1-3 minutes and the bridge runs one job at a time, so the limit is well above the app's 180 s default.
    { id: 'end_00000000b1', name: 'ChatGPT bridge', kind: 'openai', baseUrl: bridge, options: { timeoutSeconds: 600 } }
  ],
  models: [
    { id: 'mdl_000000000a', endpointId: 'end_0000000000', modelId: 'mock-text', label: 'Mock text', capabilities: ['text', 'vision'], params: {}, maxReferenceImages: 4 },
    { id: 'mdl_000000000b', endpointId: 'end_0000000000', modelId: 'mock-image', label: 'Mock image', capabilities: ['image-gen', 'image-edit'], params: {}, maxReferenceImages: 4 },
    { id: 'mdl_00000000b1', endpointId: 'end_00000000b1', modelId: 'chatgpt-image', label: 'ChatGPT image (bridge)', capabilities: ['image-gen', 'image-edit'], params: {}, maxReferenceImages: 4 },
    { id: 'mdl_00000000b2', endpointId: 'end_00000000b1', modelId: 'chatgpt', label: 'ChatGPT (bridge)', capabilities: ['text', 'vision'], params: {}, maxReferenceImages: 4 }
  ],
  roles: { agent: 'mdl_000000000a', image: 'mdl_00000000b1', imageEdit: 'mdl_00000000b1', vision: 'mdl_00000000b2' }
}

mkdirSync(resolve(userData), { recursive: true })
writeFileSync(file, JSON.stringify(models, null, 2) + '\n')
console.log(`wrote ${file}: agent -> mock-text, image + imageEdit -> chatgpt-image, vision -> chatgpt (${bridge})`)
