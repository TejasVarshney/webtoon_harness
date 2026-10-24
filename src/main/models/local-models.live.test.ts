/**
 * Opt-in live test against the local stack (gemma4 on Ollama + the SDXL bridge), through the app's own adapters.
 * Skipped unless WEBTOON_LIVE_LOCAL=1. Start Ollama and `tools/local-models/image_server.py` first, then:
 *   $env:WEBTOON_LIVE_LOCAL=1; npx vitest run src/main/models/local-models.live.test.ts
 */
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import type { ChatMessage } from '@shared/types'
import { createImageProvider, createTextProvider } from './providers/factory'
import type { ResolvedModel } from './registry'

const live = process.env.WEBTOON_LIVE_LOCAL === '1'
const OLLAMA = (process.env.OLLAMA_URL ?? 'http://localhost:11434').replace(/\/$/, '')
const IMAGES = (process.env.IMAGE_URL ?? 'http://127.0.0.1:7861').replace(/\/$/, '')

function resolved(baseUrl: string, modelId: string, capabilities: ResolvedModel['model']['capabilities']): ResolvedModel {
  return {
    endpoint: { id: 'end_00000000a1', name: 'local', kind: 'openai', baseUrl, options: {} },
    model: { id: 'mdl_00000000a1', endpointId: 'end_00000000a1', modelId, label: modelId, capabilities, params: {}, maxReferenceImages: 2 },
    apiKey: null
  }
}

const userMessage = (text: string): ChatMessage => ({ id: 'msg_0000000001', role: 'user', text, imagePaths: [], stateSnapshot: null, createdAt: new Date().toISOString() })

describe.skipIf(!live)('local models (live)', () => {
  it('gemma4 answers a tool call through OpenAIChatProvider', { timeout: 300_000 }, async () => {
    const provider = createTextProvider(resolved(`${OLLAMA}/v1`, process.env.TEXT_MODEL ?? 'gemma4-webtoon', ['text']))
    const result = await provider.runTurn({
      system: 'You are a webtoon assistant. Use the tools when the user asks for something they can do.',
      messages: [userMessage('Create a character named Mina: protagonist, teenage girl, silver bob haircut, amber eyes.')],
      tools: [
        {
          name: 'create_character',
          description: 'Create a character with a locked appearance description.',
          inputSchema: z.toJSONSchema(z.object({ name: z.string(), role: z.enum(['protagonist', 'antagonist', 'supporting', 'minor']), appearanceLock: z.string() }))
        }
      ],
      loadImage: async () => {
        throw new Error('no images in this test')
      },
      signal: AbortSignal.timeout(280_000)
    })
    expect(result.stopReason).toBe('tool_use')
    expect(result.toolCalls[0]).toMatchObject({ name: 'create_character', input: { name: expect.stringMatching(/mina/i) } })
  })

  it('the SDXL bridge draws a 2:3 PNG through OpenAIImageProvider', { timeout: 600_000 }, async () => {
    const provider = createImageProvider(resolved(`${IMAGES}/v1`, 'sdxl-webtoon', ['image-gen', 'image-edit']))
    const image = await provider.generate({
      prompt: 'Character reference sheet. Full body, front view, plain light-gray background, no text. Teenage girl, silver bob haircut, amber eyes.',
      references: [],
      aspect: '2:3',
      signal: AbortSignal.timeout(590_000)
    })
    expect(image.mime).toBe('image/png')
    expect(image.data.subarray(1, 4).toString()).toBe('PNG')
    expect(image.data.readUInt32BE(20)).toBeGreaterThan(image.data.readUInt32BE(16)) // taller than wide
  })
})
