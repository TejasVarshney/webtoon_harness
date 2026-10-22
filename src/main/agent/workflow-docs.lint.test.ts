import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildCheckMessage } from '../domain/consistency-checker'
import { listSections } from '../domain/markdown-sections'
import { baseReferencePrompt, composePanelPrompt, editPanelPrompt, variationPrompt } from '../domain/prompts'
import { makeCharacter, makePanel, makeVariation } from '../test/factories'
import { extractSection } from './system-prompt'
import { ALL_TOOL_NAMES, buildAgentTools } from './tools'
import { buildPanelChatTools } from './tools/panel-chat-tools'
import type { ToolContext, ToolRegistry } from './tools/registry'

// Lints the shipped workflow docs (spec §11) against the code they describe: required sections, the hard
// rules, the tool catalog, tool names, example tool calls and the prompt templates.

const DOCS_DIR = path.resolve('resources', 'agent-docs')
const read = (name: string): string => fs.readFileSync(path.join(DOCS_DIR, ...`${name}.md`.split('/')), 'utf8')

const REQUIRED: Record<string, string[]> = {
  AGENTS: ['Mission', 'Operating Loop', 'Story Modes', 'Hard Rules', 'Tool Catalog', 'Workflow Docs Index', 'Communication Style', 'Failure Handling'],
  'workflows/story-direction': ['Purpose', 'User-Led Mode', 'AI-Led Mode', 'Story Bible', 'Beats and Outline', 'Episode Structure', 'Vertical Pacing', 'Continuity Across Sessions', 'Conflicts and Retcons', 'Examples'],
  'workflows/character-creation': ['Purpose', 'Character Sheet', 'Writing the Appearance Lock', 'Base Reference Image', 'Variations', 'Variation Naming', 'When Not to Create a Variation', 'Automating Creation from Chat', 'Updating Characters', 'Examples'],
  'workflows/panel-generation': ['Purpose', 'Pipeline', 'Selecting the Cast', 'Choosing Variations', 'Using the Previous Panel', 'Shot and Aspect Selection', 'Writing the Description', 'Dialogue and SFX', 'Off-Panel Mentions', 'Reading the Consistency Check', 'Examples'],
  'workflows/panel-editing': ['Purpose', 'Scope', 'Edit vs Regenerate', 'Preserving Identity', 'Versions and Revert', 'Dialogue-Only Changes', 'Reporting Changes', 'Examples'],
  'reference/webtoon-style-guide': ['Format', 'Panel Aspects', 'Shot Vocabulary', 'Pacing and Gutters', 'Dialogue Conventions', 'Color and Lighting Continuity', 'Genre Notes'],
  'reference/prompt-templates': ['Panel Prompt', 'Base Reference Prompt', 'Variation Prompt', 'Panel Edit Prompt', 'Consistency Check Prompt'],
  'reference/consistency-checklist': ['Checklist', 'Output Format', 'Severity', 'Retry Guidance']
}
const DOCS = Object.keys(REQUIRED)

/** Snake-case keys the code itself writes into `<project_state>` / `<panel_context>`: the only backticked snake_case that is not a tool. */
const NON_TOOL_TOKENS = ['story_mode', 'current_episode', 'recent_panels', 'continuity_notes', 'off_panel_mentions']

const CHECK_CONTRACT = 'Respond with only one JSON object: {"passed": true|false, "issues": ["…"]}'

/** The fenced code blocks whose text is `<tool_name> {…}`: the docs' example tool calls. */
function exampleCalls(md: string): { tool: string; json: string }[] {
  const out: { tool: string; json: string }[] = []
  for (const block of md.matchAll(/^```[^\n]*\n([\s\S]*?)^```/gm)) {
    const call = /^([a-z]+(?:_[a-z]+)+) (\{[\s\S]*\})\s*$/.exec(block[1])
    if (call) out.push({ tool: call[1], json: call[2] })
  }
  return out
}

type JsonSchema = { properties?: Record<string, JsonSchema>; items?: JsonSchema; anyOf?: JsonSchema[]; oneOf?: JsonSchema[]; type?: string | string[] }

/** Paths of object keys in `value` that `schema` does not declare (zod would strip them silently). */
function undeclaredKeys(value: unknown, schema: JsonSchema, at: string): string[] {
  const variants = schema.anyOf ?? schema.oneOf
  if (variants) return variants.map((v) => undeclaredKeys(value, v, at)).reduce((best, next) => (next.length < best.length ? next : best))
  if (Array.isArray(value)) return schema.items ? value.flatMap((v, i) => undeclaredKeys(v, schema.items!, `${at}[${i}]`)) : []
  if (value !== null && typeof value === 'object') {
    const props = schema.properties ?? {}
    return Object.entries(value).flatMap(([key, v]) => (key in props ? undeclaredKeys(v, props[key], `${at}.${key}`) : [`${at}.${key}`]))
  }
  return []
}

const NOT_RUN = 'example input accepted'
/** A context whose services refuse every use: a handler that gets past input validation stops with NOT_RUN. */
const stubContext = {
  services: new Proxy({}, { get: () => { throw new Error(NOT_RUN) } }),
  project: {},
  signal: new AbortController().signal,
  threadKey: 'lint'
} as unknown as ToolContext

const registries: ToolRegistry[] = [buildAgentTools({ vision: true }), buildPanelChatTools('pnl_0000000000', { vision: true })]

describe('workflow docs lint', () => {
  it.each(Object.entries(REQUIRED))('%s has its required sections', (name, sections) => expect(listSections(read(name))).toEqual(expect.arrayContaining(sections)))

  it.each(DOCS)('%s starts with a "# " title for the doc index', (name) => expect(read(name)).toMatch(/^# \S/))

  it('AGENTS.md states R1–R12', () => {
    for (let i = 1; i <= 12; i++) expect(read('AGENTS')).toMatch(new RegExp(`\\*\\*R${i}\\b`))
  })

  it('the Hard Rules section alone carries R1–R12 (the panel side chat sees only that section)', () => {
    const rules = extractSection(read('AGENTS'), 'Hard Rules')
    for (let i = 1; i <= 12; i++) expect(rules).toMatch(new RegExp(`\\*\\*R${i}\\b`))
  })

  it('every tool is in the Tool Catalog', () => {
    const cat = extractSection(read('AGENTS'), 'Tool Catalog')
    for (const t of ALL_TOOL_NAMES) expect(cat).toContain('`' + t + '`')
  })

  it('every tool has its own bullet in the Tool Catalog', () => {
    const cat = extractSection(read('AGENTS'), 'Tool Catalog')
    for (const t of ALL_TOOL_NAMES) expect(cat).toMatch(new RegExp('^- `' + t + '`', 'm'))
  })

  it('docs reference only real tools', () => {
    for (const name of DOCS) {
      for (const [, tok] of read(name).matchAll(/`([a-z]+(?:_[a-z]+)+)`/g)) expect([...ALL_TOOL_NAMES, ...NON_TOOL_TOKENS], `${name}: ${tok}`).toContain(tok)
    }
  })

  it('every example tool call names a real tool and uses only its real input fields', async () => {
    let checked = 0
    for (const name of DOCS) {
      for (const { tool, json } of exampleCalls(read(name))) {
        const where = `${name}: ${tool} ${json.slice(0, 80)}`
        let input: unknown
        expect(() => (input = JSON.parse(json)), where).not.toThrow()
        const registry = registries.find((r) => r.names().includes(tool))
        expect(registry, `${where}: unknown tool`).toBeDefined()
        const spec = registry!.specs().find((s) => s.name === tool)!
        expect(undeclaredKeys(input, spec.inputSchema as JsonSchema, 'input'), where).toEqual([])
        const result = await registry!.execute({ id: 'lint', name: tool, input }, stubContext)
        expect(result.content, where).toBe(NOT_RUN)
        checked++
      }
    }
    expect(checked).toBeGreaterThanOrEqual(25)
  })

  it('prompt templates mirror the code markers', () => {
    const s = extractSection(read('reference/prompt-templates'), 'Panel Prompt')
    for (const m of ['[STYLE]', '[SETTING]', '[ACTION]', '[CHARACTERS]', '[CONTINUITY]']) expect(s).toContain(m)
  })

  it('prompt templates reproduce the prompt builders verbatim', () => {
    const doc = read('reference/prompt-templates')
    const character = makeCharacter({
      name: '{name}',
      appearanceLock: '{appearanceLock}',
      variations: [makeVariation({ name: '{variation.name}', delta: '{variation.delta}', status: 'ready', imagePath: 'characters/a.png' })]
    })
    const panel = composePanelPrompt({
      stylePreset: '{stylePreset}',
      panel: {
        description: '{description}',
        setting: '{setting}',
        shot: '{shot}' as never,
        aspect: '{aspect}' as never,
        characters: [{ characterId: character.id, variationId: character.variations[0].id, action: '{action}', expression: '{expression}', position: '{position}' as never }],
        continuityNotes: '{continuityNotes}'
      },
      roster: new Map([[character.id, character]]),
      previous: { panelId: 'pnl_0000000002', imagePath: 'panels/b.png' },
      maxReferences: 4
    }).prompt.replace('(reference image 1)', '(reference image {n})').replace('(reference image 2)', '(reference image {m})')
    expect(extractSection(doc, 'Panel Prompt')).toContain(panel)

    expect(extractSection(doc, 'Base Reference Prompt')).toContain(baseReferencePrompt(character, '{stylePreset}'))
    const variation = makeVariation({ name: '{variation.name}', kind: 'outfit', delta: '{variation.delta}' })
    expect(extractSection(doc, 'Variation Prompt')).toContain(variationPrompt(character, variation, '{stylePreset}'))
    expect(extractSection(doc, 'Panel Edit Prompt')).toContain(editPanelPrompt('{instruction}', [{ name: '{name}', appearanceLock: '{appearanceLock}' }]))
  })

  it('prompt templates reproduce the consistency checker user message verbatim', () => {
    const character = makeCharacter({
      name: '{name}',
      appearanceLock: '{appearanceLock}',
      variations: [makeVariation({ name: '{variation.name}', delta: '{variation.delta}', status: 'ready', imagePath: 'characters/a.png' })]
    })
    const message = buildCheckMessage({
      references: [
        { relPath: 'characters/a.png', label: '{name}' },
        { relPath: 'panels/b.png', label: 'previous panel' }
      ],
      panel: {
        ...makePanel({ characters: [{ characterId: character.id, variationId: character.variations[0].id }] }),
        description: '{description}',
        shot: '{shot}' as never
      },
      roster: [character]
    })
    expect(extractSection(read('reference/prompt-templates'), 'Consistency Check Prompt')).toContain(message)
  })

  it('the consistency checklist ends with the exact output contract', () => {
    expect(read('reference/consistency-checklist').trimEnd().endsWith(CHECK_CONTRACT)).toBe(true)
  })

  it('docs are substantial', () => expect(DOCS.reduce((n, k) => n + read(k).split('\n').length, 0)).toBeGreaterThanOrEqual(1200))
})
