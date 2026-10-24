import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import {
  BeatSchema,
  CharacterInputSchema,
  CharacterPatchSchema,
  CharacterSchema,
  CheckResultSchema,
  ChatMessageSchema,
  DialogueLineSchema,
  EndpointConfigSchema,
  EpisodeSchema,
  ModelConfigSchema,
  ModelsFileSchema,
  OutlineSchema,
  PanelCharacterSchema,
  PanelDraftSchema,
  PanelPatchSchema,
  PanelSchema,
  PanelVersionSchema,
  ProjectMetaSchema,
  RoleAssignmentsSchema,
  VariationInputSchema,
  VariationSchema
} from '@shared/schemas'

const T = '2026-01-01T00:00:00.000Z'

const minimalPanel = {
  id: 'pnl_0000000001',
  episodeId: 'epi_0000000001',
  description: 'Mina opens the door.',
  setting: 'Apartment hallway',
  shot: 'medium',
  aspect: '2:3',
  dialogue: [],
  createdBy: 'user',
  createdAt: T,
  updatedAt: T
}

const minimalCharacter = {
  id: 'chr_0000000001',
  name: 'Mina',
  role: 'protagonist',
  appearanceLock: 'Slim, black bob hair, amber eyes',
  variations: [],
  createdBy: 'user',
  createdAt: T,
  updatedAt: T
}

const minimalVariation = {
  id: 'var_0000000001',
  characterId: 'chr_0000000001',
  name: 'Base',
  kind: 'base',
  status: 'pending',
  createdBy: 'user',
  createdAt: T
}

const minimalVersion = {
  id: 'ver_0000000001',
  source: 'generate',
  status: 'ready',
  error: null,
  imagePath: 'panels/pnl_0000000001/ver_0000000001.png',
  prompt: 'p',
  check: null,
  createdAt: T
}

const model = { endpointId: 'end_0000000001', modelId: 'claude-opus-5-5' }
const userMsg = { id: 'msg_0000000001', role: 'user', text: 'hi', stateSnapshot: null, createdAt: T }
const assistantMsg = {
  id: 'msg_0000000002',
  role: 'assistant',
  text: 'Working on it',
  toolCalls: [{ id: 'toolu_01', name: 'get_story', input: {} }],
  stopReason: 'tool_use',
  model,
  raw: { provider: 'anthropic', content: [{ type: 'thinking', thinking: '', signature: 'abc', extra: { keep: true } }] },
  createdAt: T
}
const toolMsg = {
  id: 'msg_0000000003',
  role: 'tool',
  results: [{ toolCallId: 'toolu_01', name: 'get_story', ok: true, content: '{}', images: [] }],
  createdAt: T
}

describe('Panel', () => {
  it('fills panel defaults', () => {
    const p = PanelSchema.parse(minimalPanel) // only required fields
    expect(p.versions).toEqual([])
    expect(p.currentVersionId).toBeNull()
    expect(p.offPanelMentions).toEqual([])
    expect(p.continuityNotes).toBe('')
    expect(p.characters).toEqual([])
  })

  it('does not share default arrays between parses', () => {
    const a = PanelSchema.parse(minimalPanel)
    a.versions.push(PanelVersionSchema.parse(minimalVersion))
    expect(PanelSchema.parse(minimalPanel).versions).toEqual([])
  })

  it('rejects unknown shot', () => expect(() => PanelSchema.parse({ ...minimalPanel, shot: 'dutch' })).toThrow())
  it('rejects unknown aspect', () => expect(() => PanelSchema.parse({ ...minimalPanel, aspect: '5:4' })).toThrow())
  it('requires an aspect (the service applies the project default)', () => {
    const { aspect: _aspect, ...rest } = minimalPanel
    expect(() => PanelSchema.parse(rest)).toThrow()
  })

  it('accepts every shot type and aspect from the spec', () => {
    for (const shot of ['establishing', 'wide', 'medium', 'close-up', 'extreme-close-up', 'over-the-shoulder', 'birds-eye', 'worms-eye'])
      expect(PanelSchema.parse({ ...minimalPanel, shot }).shot).toBe(shot)
    for (const aspect of ['1:1', '2:3', '3:4', '9:16', '4:3', '16:9'])
      expect(PanelSchema.parse({ ...minimalPanel, aspect }).aspect).toBe(aspect)
  })

  it('defaults panel character fields', () => {
    const pc = PanelCharacterSchema.parse({ characterId: 'chr_0000000001', variationId: 'var_0000000001' })
    expect(pc).toEqual({ characterId: 'chr_0000000001', variationId: 'var_0000000001', action: '', expression: '', position: 'center' })
    expect(() => PanelCharacterSchema.parse({ ...pc, position: 'top' })).toThrow()
  })

  it('validates dialogue lines', () => {
    const line = { id: 'dlg_0000000001', speakerId: null, kind: 'narration', text: 'Night fell.' }
    expect(DialogueLineSchema.parse(line)).toEqual(line)
    expect(() => DialogueLineSchema.parse({ ...line, kind: 'yell' })).toThrow()
    expect(() => DialogueLineSchema.parse({ ...line, speakerId: undefined })).toThrow()
  })
})

describe('PanelVersion and CheckResult', () => {
  it('fills version defaults', () => {
    const v = PanelVersionSchema.parse(minimalVersion)
    expect(v.referenceImagePaths).toEqual([])
    expect(v.instruction).toBeNull()
    expect(v.parentVersionId).toBeNull()
  })

  it('requires the fields the spec gives no default', () => {
    for (const key of ['status', 'error', 'imagePath', 'prompt', 'check', 'source'] as const) {
      const { [key]: _omit, ...rest } = minimalVersion
      expect(() => PanelVersionSchema.parse(rest), key).toThrow()
    }
  })

  it('rejects an unknown source or status', () => {
    expect(() => PanelVersionSchema.parse({ ...minimalVersion, source: 'import' })).toThrow()
    expect(() => PanelVersionSchema.parse({ ...minimalVersion, status: 'done' })).toThrow()
  })

  it('check results default skipped to false', () => {
    expect(CheckResultSchema.parse({ passed: true, issues: [] })).toEqual({ passed: true, issues: [], skipped: false })
    expect(PanelVersionSchema.parse({ ...minimalVersion, check: { passed: false, issues: ['hair differs'] } }).check).toEqual({
      passed: false,
      issues: ['hair differs'],
      skipped: false
    })
  })
})

describe('Character and Variation', () => {
  it('defaults character fields', () => {
    const c = CharacterSchema.parse(minimalCharacter)
    expect(c.archived).toBe(false)
    expect(c.aliases).toEqual([])
    expect(c.appearance.palette).toBe('')
    expect(c.appearance).toEqual({
      age: '',
      gender: '',
      build: '',
      height: '',
      hair: '',
      eyes: '',
      skin: '',
      distinguishingFeatures: '',
      defaultOutfit: '',
      palette: ''
    })
    expect(c.characterization).toEqual({ personality: '', backstory: '', motivation: '', speechStyle: '', relationships: [], notes: '' })
  })

  it('fills the rest of a partially given appearance', () => {
    const c = CharacterSchema.parse({ ...minimalCharacter, appearance: { hair: 'black bob' } })
    expect(c.appearance.hair).toBe('black bob')
    expect(c.appearance.eyes).toBe('')
  })

  it('requires variations, role, appearanceLock and createdBy', () => {
    for (const key of ['variations', 'role', 'appearanceLock', 'createdBy'] as const) {
      const { [key]: _omit, ...rest } = minimalCharacter
      expect(() => CharacterSchema.parse(rest), key).toThrow()
    }
  })

  it('rejects an unknown role', () => expect(() => CharacterSchema.parse({ ...minimalCharacter, role: 'hero' })).toThrow())

  it('defaults variation fields', () => {
    const v = VariationSchema.parse(minimalVariation)
    expect(v).toMatchObject({ delta: '', imagePath: null, error: null, status: 'pending', kind: 'base' })
  })

  it('accepts every variation kind and rejects others', () => {
    for (const kind of ['base', 'outfit', 'expression', 'pose', 'age', 'form', 'other'])
      expect(VariationSchema.parse({ ...minimalVariation, kind }).kind).toBe(kind)
    expect(() => VariationSchema.parse({ ...minimalVariation, kind: 'hairstyle' })).toThrow()
  })

  it('embeds variations in a character', () => {
    const c = CharacterSchema.parse({ ...minimalCharacter, variations: [minimalVariation] })
    expect(c.variations[0].id).toBe('var_0000000001')
  })
})

describe('Episode, Beat, Outline, ProjectMeta', () => {
  it('defaults episode fields', () => {
    const e = EpisodeSchema.parse({ id: 'epi_0000000001', number: 1, title: 'Episode 1', createdAt: T, updatedAt: T })
    expect(e.synopsis).toBe('')
    expect(e.panelIds).toEqual([])
  })

  it('parses beats and outlines', () => {
    const beat = { id: 'bt_0000000001', episodeId: 'epi_0000000001', summary: 'Mina finds the key', status: 'planned', createdAt: T }
    expect(BeatSchema.parse(beat)).toEqual(beat)
    expect(() => BeatSchema.parse({ ...beat, status: 'done' })).toThrow()
    expect(OutlineSchema.parse({ beats: [beat] }).beats).toHaveLength(1)
  })

  it('project meta defaults', () => {
    const m = ProjectMetaSchema.parse({ id: 'prj_0000000001', title: 'T', createdAt: T, updatedAt: T })
    expect(m).toMatchObject({ storyMode: 'user', defaultAspect: '2:3', autopilotPanels: 4, consistencyRetries: 1, logline: '' })
    expect(m.stylePreset).toContain('Korean webtoon style')
    expect(m.stylePreset).toBe('Clean full-color Korean webtoon style, crisp line art, soft cel shading, expressive faces')
  })

  it('rejects an unknown story mode', () => {
    expect(() => ProjectMetaSchema.parse({ id: 'prj_0000000001', title: 'T', storyMode: 'both', createdAt: T, updatedAt: T })).toThrow()
  })
})

describe('chat messages', () => {
  it('parses every chat message role', () => {
    for (const m of [userMsg, assistantMsg, toolMsg]) expect(ChatMessageSchema.parse(m).role).toBe(m.role)
  })

  it('fills user message defaults', () => {
    const m = ChatMessageSchema.parse(userMsg)
    expect(m.role === 'user' && m.imagePaths).toEqual([])
  })

  it('rejects an unknown role', () => expect(() => ChatMessageSchema.parse({ ...userMsg, role: 'system' })).toThrow())

  it('uses the spec stop reasons for assistant messages, not loop outcomes', () => {
    for (const stopReason of ['end', 'tool_use', 'max_tokens', 'refusal'])
      expect(ChatMessageSchema.parse({ ...assistantMsg, stopReason }).role).toBe('assistant')
    for (const stopReason of ['max_steps', 'cancelled', 'error'])
      expect(() => ChatMessageSchema.parse({ ...assistantMsg, stopReason })).toThrow()
  })

  it('keeps raw provider content untouched for replay', () => {
    const parsed = ChatMessageSchema.parse(assistantMsg)
    expect(parsed.role === 'assistant' && parsed.raw).toEqual(assistantMsg.raw)
    expect(ChatMessageSchema.parse({ ...assistantMsg, raw: null }).role).toBe('assistant')
    expect(() => ChatMessageSchema.parse({ ...assistantMsg, raw: { provider: 'openai', content: [] } })).toThrow()
  })

  it('requires an object input on tool calls and a string content on results', () => {
    expect(() => ChatMessageSchema.parse({ ...assistantMsg, toolCalls: [{ id: 'a', name: 'x' }] })).toThrow()
    expect(() => ChatMessageSchema.parse({ ...toolMsg, results: [{ ...toolMsg.results[0], content: 5 }] })).toThrow()
  })
})

describe('models file', () => {
  it('defaults model config', () => {
    const m = ModelConfigSchema.parse({ id: 'mdl_0000000001', endpointId: 'end_0000000001', modelId: 'x', label: 'x', capabilities: ['text'] })
    expect(m.params).toEqual({})
    expect(m.maxReferenceImages).toBe(4)
  })

  it('does not share the default params object between parses', () => {
    const input = { id: 'mdl_0000000001', endpointId: 'end_0000000001', modelId: 'x', label: 'x', capabilities: ['text'] }
    const a = ModelConfigSchema.parse(input)
    a.params.effort = 'high'
    expect(ModelConfigSchema.parse(input).params).toEqual({})
  })

  it('rejects an unknown capability', () => {
    expect(() =>
      ModelConfigSchema.parse({ id: 'mdl_0000000001', endpointId: 'end_0000000001', modelId: 'x', label: 'x', capabilities: ['audio'] })
    ).toThrow()
  })

  it('parses endpoints of every kind', () => {
    const base = { id: 'end_0000000001', name: 'E', baseUrl: 'https://x.test', options: {} }
    for (const kind of ['anthropic', 'openai', 'gemini', 'mock']) expect(EndpointConfigSchema.parse({ ...base, kind }).kind).toBe(kind)
    expect(EndpointConfigSchema.parse({ ...base, kind: 'anthropic', options: { serverSideFallback: false } }).options).toEqual({
      serverSideFallback: false
    })
    expect(() => EndpointConfigSchema.parse({ ...base, kind: 'cohere' })).toThrow()
  })

  it('role assignments are optional per role', () => {
    expect(RoleAssignmentsSchema.parse({})).toEqual({})
    expect(RoleAssignmentsSchema.parse({ agent: 'mdl_0000000001', imageEdit: 'mdl_0000000002' })).toEqual({
      agent: 'mdl_0000000001',
      imageEdit: 'mdl_0000000002'
    })
    expect(() => RoleAssignmentsSchema.parse({ agent: 5 })).toThrow()
  })

  it('parses a whole models file', () => {
    const f = ModelsFileSchema.parse({
      endpoints: [{ id: 'end_0000000001', name: 'Mock', kind: 'mock', baseUrl: '', options: {} }],
      models: [{ id: 'mdl_0000000001', endpointId: 'end_0000000001', modelId: 'mock-text', label: 'Mock', capabilities: ['text'] }],
      roles: { agent: 'mdl_0000000001' }
    })
    expect(f.models[0].maxReferenceImages).toBe(4)
    expect(f.roles.agent).toBe('mdl_0000000001')
  })
})

describe('input schemas', () => {
  const draft = { episodeId: 'epi_0000000001', description: 'd', setting: 's', shot: 'wide', characters: [], dialogue: [] }

  it('parses a minimal panel draft without inventing defaults', () => {
    const d = PanelDraftSchema.parse(draft)
    expect(d).toEqual(draft)
    expect(d.aspect).toBeUndefined() // the service applies meta.defaultAspect
  })

  it('accepts afterPanelId as a string or null and dialogue without ids', () => {
    expect(PanelDraftSchema.parse({ ...draft, afterPanelId: null }).afterPanelId).toBeNull()
    expect(PanelDraftSchema.parse({ ...draft, afterPanelId: 'pnl_0000000001' }).afterPanelId).toBe('pnl_0000000001')
    const d = PanelDraftSchema.parse({ ...draft, dialogue: [{ speakerId: null, kind: 'sfx', text: 'BANG' }] })
    expect(d.dialogue).toEqual([{ speakerId: null, kind: 'sfx', text: 'BANG' }])
    expect(() => PanelDraftSchema.parse({ ...draft, dialogue: [{ kind: 'sfx', text: 'BANG' }] })).toThrow()
  })

  it('fills panel character defaults inside a draft', () => {
    const d = PanelDraftSchema.parse({ ...draft, characters: [{ characterId: 'chr_0000000001', variationId: 'var_0000000001' }] })
    expect(d.characters[0]).toMatchObject({ action: '', expression: '', position: 'center' })
  })

  it('panel patches are partial and never inject defaults', () => {
    expect(PanelPatchSchema.parse({})).toEqual({})
    expect(PanelPatchSchema.parse({ description: 'x' })).toEqual({ description: 'x' })
    expect(PanelPatchSchema.parse({ shot: 'close-up', continuityNotes: 'n' })).toEqual({ shot: 'close-up', continuityNotes: 'n' })
    expect(() => PanelPatchSchema.parse({ shot: 'dutch' })).toThrow()
  })

  it('panel patches drop episodeId and afterPanelId', () => {
    expect(PanelPatchSchema.parse({ description: 'x', episodeId: 'epi_0000000001', afterPanelId: null })).toEqual({ description: 'x' })
  })

  it('parses character inputs without inventing defaults', () => {
    const input = { name: 'Mina', role: 'protagonist', appearanceLock: 'lock' }
    expect(CharacterInputSchema.parse(input)).toEqual(input)
    expect(() => CharacterInputSchema.parse({ name: 'Mina', role: 'protagonist' })).toThrow()
    expect(
      CharacterInputSchema.parse({ ...input, aliases: ['M'], characterization: { personality: 'shy' }, appearance: { hair: 'black' } })
    ).toEqual({ ...input, aliases: ['M'], characterization: { personality: 'shy' }, appearance: { hair: 'black' } })
  })

  it('character patches change only what they name', () => {
    expect(CharacterPatchSchema.parse({})).toEqual({})
    expect(CharacterPatchSchema.parse({ name: 'x' })).toEqual({ name: 'x' })
    expect(CharacterPatchSchema.parse({ appearance: { hair: 'red' } })).toEqual({ appearance: { hair: 'red' } })
    expect(CharacterPatchSchema.parse({ characterization: { notes: 'n' } })).toEqual({ characterization: { notes: 'n' } })
    const relationships = [{ characterId: 'chr_0000000002', relation: 'sister' }]
    expect(CharacterPatchSchema.parse({ characterization: { relationships } })).toEqual({ characterization: { relationships } })
    expect(() => CharacterPatchSchema.parse({ role: 'hero' })).toThrow()
  })

  it('variation inputs refuse the base kind', () => {
    const input = { name: 'Uniform', kind: 'outfit', delta: 'school uniform' }
    expect(VariationInputSchema.parse(input)).toEqual(input)
    expect(() => VariationInputSchema.parse({ name: 'B', kind: 'base', delta: '' })).toThrow()
    expect(() => VariationInputSchema.parse({ name: 'B', kind: 'outfit' })).toThrow()
  })

  it('tool inputs can be converted to JSON Schema', () => {
    for (const schema of [PanelDraftSchema, PanelPatchSchema, CharacterInputSchema, CharacterPatchSchema, VariationInputSchema])
      expect(z.toJSONSchema(schema, { io: 'input' })).toMatchObject({ type: 'object' })
  })
})
