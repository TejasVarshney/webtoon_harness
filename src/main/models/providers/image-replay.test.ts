import fs from 'node:fs'
import { afterEach, describe, expect, it } from 'vitest'
import type { ChatMessage } from '@shared/types'
import { createIdentityImageOps, loadImageForTextModel } from '../../domain/image-ops'
import { tempProject, type TempProject } from '../../test/temp-project'
import { encodeSolidPng } from './png'
import { toAnthropicMessages } from './anthropic'
import { toOpenAIMessages } from './openai-chat'
import type { ImageLoader } from './types'

// These tests go through the real `loadImageForTextModel` on a real project folder: the stub loaders of the
// adapter tests never fail, so they cannot show what a deleted or broken image does to a replayed history.

let tp: TempProject | undefined
afterEach(async () => {
  await tp?.cleanup()
  tp = undefined
})

const PNG = encodeSolidPng(2, 2, [9, 9, 9])
const at = '2026-01-01T00:00:00.000Z'
let n = 0
const id = (): string => `msg_${String(++n).padStart(10, '0')}`

const user = (text: string, imagePaths: string[] = []): ChatMessage => ({ id: id(), role: 'user', text, imagePaths, stateSnapshot: null, createdAt: at })
const assistantCall = (callId: string): ChatMessage => ({
  id: id(),
  role: 'assistant',
  text: '',
  toolCalls: [{ id: callId, name: 'view_panel', input: {} }],
  stopReason: 'tool_use',
  model: { endpointId: 'end_0000000001', modelId: 'm' },
  raw: null,
  createdAt: at
})
const toolResult = (callId: string, images: string[]): ChatMessage => ({
  id: id(),
  role: 'tool',
  results: [{ toolCallId: callId, name: 'view_panel', ok: true, content: 'here it is', images }],
  createdAt: at
})

async function project(files: Record<string, Buffer>): Promise<ImageLoader> {
  tp = await tempProject()
  const ctx = tp.ctx
  for (const [rel, data] of Object.entries(files)) {
    await fs.promises.mkdir(ctx.paths.resolveAsset(rel.split('/').slice(0, -1).join('/')), { recursive: true })
    await fs.promises.writeFile(ctx.paths.resolveAsset(rel), data)
  }
  const ops = createIdentityImageOps()
  return (rel) => loadImageForTextModel(ctx, ops, rel)
}

describe('replaying images that are gone (C1)', () => {
  it('anthropic: a deleted attachment or tool image becomes a text note instead of failing the turn', async () => {
    const loadImage = await project({ 'uploads/kept.png': PNG })
    const history = [
      user('look', ['uploads/deleted.png', 'uploads/kept.png']),
      assistantCall('toolu_1'),
      toolResult('toolu_1', ['panels/pnl_0000000001/gone.png']),
      user('and now?')
    ]
    const out = await toAnthropicMessages(history, loadImage)
    expect(out[0].content).toEqual([
      { type: 'text', text: 'look' },
      { type: 'text', text: '[image no longer available: uploads/deleted.png]' },
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data: PNG.toString('base64') } }
    ])
    expect(out[2].content).toEqual([
      {
        type: 'tool_result',
        tool_use_id: 'toolu_1',
        is_error: false,
        content: [
          { type: 'text', text: 'here it is' },
          { type: 'text', text: '[image no longer available: panels/pnl_0000000001/gone.png]' }
        ]
      }
    ])
  })

  it('openai: a deleted attachment or tool image becomes a text note instead of failing the turn', async () => {
    const loadImage = await project({ 'uploads/kept.png': PNG })
    const history = [
      user('look', ['uploads/deleted.png', 'uploads/kept.png']),
      assistantCall('call_1'),
      toolResult('call_1', ['panels/pnl_0000000001/gone.png', 'uploads/kept.png']),
      user('and now?')
    ]
    const out = await toOpenAIMessages('sys', history, loadImage, true)
    expect(out[1]).toEqual({
      role: 'user',
      content: [
        { type: 'text', text: 'look' },
        { type: 'text', text: '[image no longer available: uploads/deleted.png]' },
        { type: 'image_url', image_url: { url: `data:image/png;base64,${PNG.toString('base64')}` } }
      ]
    })
    expect(out[3]).toEqual({ role: 'tool', tool_call_id: 'call_1', content: 'here it is\n[image no longer available: panels/pnl_0000000001/gone.png]' })
    expect(out[4]).toEqual({ role: 'user', content: [{ type: 'image_url', image_url: { url: `data:image/png;base64,${PNG.toString('base64')}` } }] })
  })

  it('an empty file, a folder or a path outside the project is replayed as a note too', async () => {
    const loadImage = await project({ 'uploads/empty.png': Buffer.alloc(0) })
    const out = await toAnthropicMessages([user('x', ['uploads/empty.png', 'uploads', '../outside.png'])], loadImage)
    expect(out[0].content).toEqual([
      { type: 'text', text: 'x' },
      { type: 'text', text: '[image no longer available: uploads/empty.png]' },
      { type: 'text', text: '[image no longer available: uploads]' },
      { type: 'text', text: '[image no longer available: ../outside.png]' }
    ])
  })

  it('other loader failures still fail the turn', async () => {
    const failing: ImageLoader = () => Promise.reject(new Error('EBUSY: locked by antivirus'))
    await expect(toAnthropicMessages([user('x', ['uploads/a.png'])], failing)).rejects.toThrow('EBUSY')
    await expect(toOpenAIMessages('sys', [user('x', ['uploads/a.png'])], failing, true)).rejects.toThrow('EBUSY')
  })
})
