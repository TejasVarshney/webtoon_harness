// Smoke test for the local model stack, using the same OpenAI SDK the app uses.
//   node tools/local-models/smoke.mjs            text checks (gemma4 tools + vision) and bridge health
//   node tools/local-models/smoke.mjs --images   also one generation and one edit through the bridge (~4 min)
// Env: OLLAMA_URL (http://localhost:11434), IMAGE_URL (http://127.0.0.1:7861), TEXT_MODEL (gemma4-webtoon)
import OpenAI, { toFile } from 'openai'
import { deflateSync, crc32 } from 'node:zlib'
import { writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const OLLAMA = (process.env.OLLAMA_URL ?? 'http://localhost:11434').replace(/\/$/, '')
const IMAGES = (process.env.IMAGE_URL ?? 'http://127.0.0.1:7861').replace(/\/$/, '')
const TEXT_MODEL = process.env.TEXT_MODEL ?? 'gemma4-webtoon'
const withImages = process.argv.includes('--images')
const outDir = join(tmpdir(), 'webtoon-local-smoke')
mkdirSync(outDir, { recursive: true })

const text = new OpenAI({ apiKey: 'not-needed', baseURL: `${OLLAMA}/v1`, timeout: 300_000 })
const images = new OpenAI({ apiKey: 'not-needed', baseURL: `${IMAGES}/v1`, timeout: 600_000 })
let failed = 0

/** `optional` checks print WARN and do not fail the run (features the sandbox leaves off by default). */
async function check(name, fn, { optional = false } = {}) {
  const t0 = Date.now()
  try {
    const detail = await fn()
    console.log(`PASS ${name} (${((Date.now() - t0) / 1000).toFixed(1)}s)${detail ? ` — ${detail}` : ''}`)
    return true
  } catch (e) {
    if (!optional) failed++
    console.log(`${optional ? 'WARN' : 'FAIL'} ${name} (${((Date.now() - t0) / 1000).toFixed(1)}s) — ${e instanceof Error ? e.message : e}`)
    return false
  }
}

const createCharacter = {
  type: 'function',
  function: {
    name: 'create_character',
    description: 'Create a character with a locked appearance description.',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        role: { type: 'string', enum: ['protagonist', 'antagonist', 'supporting', 'minor'] },
        appearanceLock: { type: 'string' }
      },
      required: ['name', 'role', 'appearanceLock']
    }
  }
}

/** A solid-color PNG (vision encoders need more than a single pixel to see a color). */
function solidPng(size, [r, g, b]) {
  const chunk = (type, data) => {
    const len = Buffer.alloc(4)
    len.writeUInt32BE(data.length)
    const body = Buffer.concat([Buffer.from(type), data])
    const crc = Buffer.alloc(4)
    crc.writeUInt32BE(crc32(body))
    return Buffer.concat([len, body, crc])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr.set([8, 2, 0, 0, 0], 8)
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(size * 3).map((_, i) => [r, g, b][i % 3])])
  const raw = Buffer.concat(Array.from({ length: size }, () => row))
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
}
const RED_SQUARE = solidPng(64, [220, 20, 20]).toString('base64')

await check(`ollama is up and has ${TEXT_MODEL}`, async () => {
  const res = await fetch(`${OLLAMA}/api/tags`)
  const names = (await res.json()).models.map((m) => m.name)
  if (!names.some((n) => n === TEXT_MODEL || n === `${TEXT_MODEL}:latest`)) {
    throw new Error(`${TEXT_MODEL} not found — run: ollama create gemma4-webtoon -f tools/local-models/gemma4-webtoon.Modelfile`)
  }
  return `${names.length} models`
})

await check(`${TEXT_MODEL} calls a tool`, async () => {
  const r = await text.chat.completions.create({
    model: TEXT_MODEL,
    messages: [
      { role: 'system', content: 'You are a webtoon assistant. Use tools when asked.' },
      { role: 'user', content: 'Create a character named Mina, a protagonist with a silver bob haircut and amber eyes.' }
    ],
    tools: [createCharacter]
  })
  const call = r.choices[0].message.tool_calls?.[0]
  if (!call) throw new Error(`no tool call; finish_reason=${r.choices[0].finish_reason}, text=${r.choices[0].message.content?.slice(0, 120)}`)
  const args = JSON.parse(call.function.arguments)
  if (call.function.name !== 'create_character' || !/mina/i.test(args.name)) throw new Error(`unexpected call ${JSON.stringify(call.function)}`)
  return `${call.function.name}(${call.function.arguments})`
})

await check(`${TEXT_MODEL} sees an image (only needed for start-local.ps1 -Vision)`, async () => {
  const r = await text.chat.completions.create({
    model: TEXT_MODEL,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'What single color fills this image? Answer with one word.' },
          { type: 'image_url', image_url: { url: `data:image/png;base64,${RED_SQUARE}` } }
        ]
      }
    ]
  })
  const answer = r.choices[0].message.content ?? ''
  if (!/red/i.test(answer)) throw new Error(`expected "red", got ${JSON.stringify(answer.slice(0, 80))} — the vision encoder is not working; keep vision off`)
  return answer.trim()
}, { optional: true })

const healthy = await check('image bridge is ready', async () => {
  const res = await fetch(`${IMAGES}/health`)
  const h = await res.json()
  if (h.status !== 'ready') throw new Error(`status ${h.status}${h.error ? `: ${h.error}` : ''}`)
  return `lora ${h.lora}`
})

if (withImages && healthy) {
  let base
  await check('bridge generates (text to image)', async () => {
    const r = await images.images.generate({
      model: 'sdxl-webtoon',
      prompt: 'Character reference sheet. Full body, front view, plain light-gray background, no text. Teenage girl, silver bob haircut, amber eyes, red bomber jacket.',
      size: '1024x1536',
      n: 1
    })
    base = Buffer.from(r.data[0].b64_json, 'base64')
    writeFileSync(join(outDir, 'generate.png'), base)
    return `${base.length} bytes -> ${join(outDir, 'generate.png')}`
  })
  if (base) {
    await check('bridge edits (source + reference)', async () => {
      const r = await images.images.edit({
        model: 'sdxl-webtoon',
        prompt: 'Edit the first image: make her smile. Keep everything else unchanged. No text, no speech bubbles.',
        size: '1024x1536',
        image: [await toFile(base, 'source-0.png', { type: 'image/png' }), await toFile(base, 'reference-0.png', { type: 'image/png' })]
      })
      const out = Buffer.from(r.data[0].b64_json, 'base64')
      writeFileSync(join(outDir, 'edit.png'), out)
      return `${out.length} bytes -> ${join(outDir, 'edit.png')}`
    })
  }
}

console.log(failed === 0 ? '\nAll checks passed.' : `\n${failed} check(s) failed.`)
process.exit(failed === 0 ? 0 : 1)
