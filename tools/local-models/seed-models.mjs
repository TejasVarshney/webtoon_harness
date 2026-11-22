// Writes models.json for a sandbox user-data folder so the app starts wired to the local stack:
//   agent (+ panelChat) -> gemma4 on Ollama, image (+ imageEdit) -> the SDXL bridge, plus the offline mock.
//   node tools/local-models/seed-models.mjs --user-data <dir> [--vision] [--force]
// --vision marks gemma4 as vision-capable and assigns the vision role (consistency check). Off by default:
// gemma4's vision encoder returns a black image under Ollama 0.32 on this GPU; re-check after updating Ollama.
// Never run this while the app is open on the same folder (the app rewrites models.json on every change).
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const arg = (name) => {
  const i = process.argv.indexOf(name)
  return i === -1 ? undefined : process.argv[i + 1]
}
const userData = arg('--user-data')
if (!userData) {
  console.error('usage: node tools/local-models/seed-models.mjs --user-data <dir> [--vision] [--force]')
  process.exit(2)
}
const vision = process.argv.includes('--vision')
const force = process.argv.includes('--force')
const ollama = (process.env.OLLAMA_URL ?? 'http://localhost:11434').replace(/\/$/, '')
const images = (process.env.IMAGE_URL ?? 'http://127.0.0.1:7861').replace(/\/$/, '')
const textModel = process.env.TEXT_MODEL ?? 'gemma4-webtoon'

const file = join(resolve(userData), 'models.json')
if (existsSync(file) && !force) {
  console.log(`${file} exists; keeping it (pass --force to overwrite)`)
  process.exit(0)
}

// Ids follow the app's `<prefix>_<10 hex>` rule; the mock ones match what the app seeds itself.
const models = {
  endpoints: [
    { id: 'end_0000000000', name: 'Mock (offline)', kind: 'mock', baseUrl: 'mock://local', options: {} },
    { id: 'end_00000000a1', name: 'Ollama (local)', kind: 'openai', baseUrl: `${ollama}/v1`, options: {} },
    { id: 'end_00000000a2', name: 'SDXL webtoon (local)', kind: 'openai', baseUrl: `${images}/v1`, options: {} }
  ],
  models: [
    { id: 'mdl_000000000a', endpointId: 'end_0000000000', modelId: 'mock-text', label: 'Mock text', capabilities: ['text', 'vision'], params: {}, maxReferenceImages: 4 },
    { id: 'mdl_000000000b', endpointId: 'end_0000000000', modelId: 'mock-image', label: 'Mock image', capabilities: ['image-gen', 'image-edit'], params: {}, maxReferenceImages: 4 },
    {
      id: 'mdl_00000000a1',
      endpointId: 'end_00000000a1',
      modelId: textModel,
      label: `${textModel} (Ollama)`,
      capabilities: vision ? ['text', 'vision'] : ['text'],
      params: {},
      maxReferenceImages: 4
    },
    {
      id: 'mdl_00000000a2',
      endpointId: 'end_00000000a2',
      modelId: 'sdxl-webtoon',
      label: 'SDXL + webtoon LoRA (local)',
      capabilities: ['image-gen', 'image-edit'],
      params: {},
      // IP-Adapter blends every reference into one embedding; more than a couple dilutes each character.
      maxReferenceImages: 2
    }
  ],
  roles: { agent: 'mdl_00000000a1', image: 'mdl_00000000a2', ...(vision ? { vision: 'mdl_00000000a1' } : {}) }
}

mkdirSync(resolve(userData), { recursive: true })
writeFileSync(file, JSON.stringify(models, null, 2) + '\n')
console.log(`wrote ${file}: agent -> ${textModel}${vision ? ' (+ vision)' : ''}, image -> sdxl-webtoon`)
