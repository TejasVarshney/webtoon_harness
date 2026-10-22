import { describe, expect, it } from 'vitest'
import { resolveMockRefs } from '../models/providers/mock'
import { makeCharacter, makeEpisode, makeMeta, makePanel, makeVariation } from '../test/factories'
import type { PanelVersion } from '@shared/types'
import { buildAgentSystemPrompt, buildPanelChatSystemPrompt, buildPanelContext, buildStateSnapshot, extractSection, versionLabel } from './system-prompt'

describe('system prompt', () => {
  it('builds a stable system prompt', () => {
    const s = buildAgentSystemPrompt('# Webtoon Agent\n...', [{ name: 'workflows/panel-generation', title: 'Panel Generation' }])
    expect(s).toContain('# Webtoon Agent')
    expect(s).toContain('## Available workflow docs')
    expect(s).toContain('- workflows/panel-generation: Panel Generation')
    expect(s).toContain('Read a doc with read_workflow_doc before the task it governs.')
  })

  it('renders the state snapshot', () => {
    const s = buildStateSnapshot({ meta: makeMeta({ title: 'Moon Diary' }), characters: [], episode: null, recentPanels: [] })
    expect(s.split('\n')[0]).toBe('<project_state>')
    expect(s).toContain('title: Moon Diary')
    expect(s).toContain('story_mode: user')
    expect(s).toContain('current_episode: none')
    expect(s).toContain('characters: none')
    expect(s).toContain('recent_panels: none')
    expect(s.trim().endsWith('</project_state>')).toBe(true)
  })

  it('renders characters, episode and panels; omits archived characters', () => {
    const mina = makeCharacter({
      variations: [makeVariation({ status: 'ready' }), makeVariation({ id: 'var_0000000002', name: 'Outfit: School uniform', kind: 'outfit', status: 'pending' })]
    })
    const gone = makeCharacter({ id: 'chr_0000000002', name: 'Ghost', archived: true, variations: [makeVariation({ id: 'var_0000000003', characterId: 'chr_0000000002' })] })
    const panel = makePanel({
      description: 'x'.repeat(200),
      characters: [{ characterId: mina.id, variationId: 'var_0000000001' }],
      dialogue: [{ id: 'dlg_0000000001', speakerId: mina.id, kind: 'speech', text: 'Hi' }]
    })
    const s = buildStateSnapshot({
      meta: makeMeta(),
      characters: [mina, gone],
      episode: makeEpisode({ title: 'Episode 1', panelIds: ['pnl_0000000001'] }),
      recentPanels: [panel]
    })
    expect(s).toContain('current_episode: epi_0000000001 "Episode 1" (1 panels)')
    expect(s).toContain('- chr_0000000001 Mina [protagonist] variations: var_0000000001 Base (ready), var_0000000002 Outfit: School uniform (pending)')
    expect(s).not.toContain('Ghost')
    expect(s).toContain(`- pnl_0000000001 [medium] cast: Mina (var_0000000001) | ${'x'.repeat(160)} | dialogue: Mina: "Hi"`)
    expect(s).not.toContain('x'.repeat(161))
  })

  it('extracts a section body', () => {
    const md = '# T\n\n## Mission\nGo.\n\n## Hard Rules\nR1 a\nR2 b\n\n## Other\nz\n'
    expect(extractSection(md, 'Hard Rules')).toBe('R1 a\nR2 b')
    expect(extractSection(md, 'Missing')).toBe('')
  })

  it('round-trips through the mock ref resolver', () => {
    const mina = makeCharacter({ variations: [makeVariation({ status: 'ready' })] })
    const snap = buildStateSnapshot({ meta: makeMeta(), characters: [mina], episode: makeEpisode(), recentPanels: [] })
    expect(resolveMockRefs({ c: { $character: 'Mina' }, e: { $episode: 'current' }, v: { $variation: ['Mina', 'Base'] } }, snap)).toEqual({
      c: 'chr_0000000001',
      e: 'epi_0000000001',
      v: 'var_0000000001'
    })
  })
})

const version = (id: string, status: PanelVersion['status']): PanelVersion => ({
  id,
  source: 'generate',
  status,
  error: status === 'failed' ? 'boom' : null,
  imagePath: status === 'ready' ? `panels/pnl_0000000001/${id}.png` : null,
  prompt: '',
  referenceImagePaths: [],
  instruction: null,
  parentVersionId: null,
  check: null,
  createdAt: '2026-01-01T00:00:00.000Z'
})

describe('versionLabel (Ruling P7)', () => {
  const panel = makePanel({
    versions: [version('ver_0000000001', 'ready'), version('ver_0000000002', 'failed'), version('ver_0000000003', 'pending'), version('ver_0000000004', 'ready')],
    currentVersionId: 'ver_0000000004'
  })

  it('numbers ready versions only, skipping failed and pending ones', () => {
    expect(versionLabel(panel, 'ver_0000000001')).toBe('v1')
    expect(versionLabel(panel, 'ver_0000000004')).toBe('v2')
  })

  it('has no label for a version that is not ready, or that does not exist', () => {
    expect(versionLabel(panel, 'ver_0000000002')).toBeNull()
    expect(versionLabel(panel, 'ver_0000000003')).toBeNull()
    expect(versionLabel(panel, 'ver_ffffffffff')).toBeNull()
    expect(versionLabel(panel, null)).toBeNull()
  })
})

describe('panel chat system prompt', () => {
  const agentsMd = "# Webtoon Agent\n\n## Mission\nDraw.\n\n## Hard Rules\nR1 Roster first\nR2 Attach, don't describe\n\n## Other\nnope\n"
  const intro = 'You are editing a single webtoon panel. Every tool acts on this panel only.'

  it('is the intro, the Hard Rules section and the panel-editing doc, and leaves the rest of AGENTS.md out', () => {
    const s = buildPanelChatSystemPrompt(agentsMd, '# Panel Editing\nUse edit_image for local changes.')
    expect(s.startsWith(intro)).toBe(true)
    expect(s).toContain("R1 Roster first\nR2 Attach, don't describe")
    expect(s).toContain('# Panel Editing\nUse edit_image for local changes.')
    expect(s.indexOf('R1 Roster first')).toBeLessThan(s.indexOf('# Panel Editing'))
    expect(s).not.toContain('Mission')
    expect(s).not.toContain('nope')
  })

  it('is stable for the same input', () => {
    expect(buildPanelChatSystemPrompt(agentsMd, 'doc')).toBe(buildPanelChatSystemPrompt(agentsMd, 'doc'))
  })

  it('falls back to the intro and the rules when the panel-editing doc does not exist yet', () => {
    const s = buildPanelChatSystemPrompt(agentsMd, '')
    expect(s).toContain(intro)
    expect(s).toContain('R1 Roster first')
    expect(s.endsWith('\n')).toBe(false)
    expect(s).not.toMatch(/\n\n\n/)
  })

  it('is just the intro when there is nothing else', () => {
    expect(buildPanelChatSystemPrompt('# Nothing here', '')).toBe(intro)
  })
})

describe('buildPanelContext', () => {
  const mina = makeCharacter({
    variations: [makeVariation({ status: 'ready' }), makeVariation({ id: 'var_0000000002', name: 'Outfit: School uniform', kind: 'outfit', status: 'ready' })]
  })
  const jin = makeCharacter({ id: 'chr_0000000002', name: 'Jin', archived: true, variations: [makeVariation({ id: 'var_0000000003', characterId: 'chr_0000000002' })] })
  const panel = makePanel({
    shot: 'close-up',
    aspect: '1:1',
    setting: 'Rooftop, dusk',
    description: 'Mina turns\naround.',
    characters: [
      { characterId: mina.id, variationId: 'var_0000000002' },
      { characterId: jin.id, variationId: 'var_0000000003' }
    ],
    dialogue: [
      { id: 'dlg_0000000001', speakerId: mina.id, kind: 'speech', text: 'Hi' },
      { id: 'dlg_0000000002', speakerId: null, kind: 'narration', text: 'Wind.' }
    ],
    versions: [version('ver_0000000001', 'ready'), version('ver_0000000002', 'ready'), version('ver_0000000003', 'failed')],
    currentVersionId: 'ver_0000000002'
  })

  it('is wrapped in <panel_context> and carries the panel fields', () => {
    const s = buildPanelContext(panel, [mina, jin], null, null)
    const lines = s.split('\n')
    expect(lines[0]).toBe('<panel_context>')
    expect(lines.at(-1)).toBe('</panel_context>')
    expect(lines).toContain('panel: pnl_0000000001')
    expect(lines).toContain('version: v2 of 2')
    expect(lines).toContain('shot: close-up')
    expect(lines).toContain('aspect: 1:1')
    expect(lines).toContain('setting: Rooftop, dusk')
    expect(lines).toContain('description: Mina turns around.')
    expect(lines).toContain('cast: Mina (Outfit: School uniform), Jin (Base)')
    expect(lines).toContain('dialogue: Mina: "Hi" / narration: "Wind."')
    expect(lines).toContain('previous: none')
    expect(lines).toContain('next: none')
  })

  it('counts ready versions only, and says none when the current version is not ready', () => {
    expect(buildPanelContext({ ...panel, currentVersionId: 'ver_0000000001' }, [mina, jin], null, null)).toContain('version: v1 of 2')
    const pendingOnly = makePanel({ versions: [version('ver_0000000001', 'pending')], currentVersionId: null })
    expect(buildPanelContext(pendingOnly, [], null, null)).toContain('\nversion: none\n')
    expect(buildPanelContext(makePanel(), [], null, null)).toContain('\nversion: none\n')
  })

  it('shows an empty cast and no dialogue as none, and adds continuity notes and off-panel mentions only when set', () => {
    const bare = buildPanelContext(makePanel(), [], null, null)
    expect(bare).toContain('\ncast: none\n')
    expect(bare).toContain('\ndialogue: none\n')
    expect(bare).not.toContain('continuity')
    expect(bare).not.toContain('off_panel')
    const noted = buildPanelContext(makePanel({ continuityNotes: 'Same lighting.', offPanelMentions: ['Jin', 'Ren'] }), [], null, null)
    expect(noted).toContain('\ncontinuity_notes: Same lighting.\n')
    expect(noted).toContain('\noff_panel_mentions: Jin, Ren\n')
  })

  it('summarizes the previous and next panels on one line each, naming the cast by variation name', () => {
    const prev = makePanel({
      id: 'pnl_00000000a1',
      shot: 'wide',
      description: 'x'.repeat(200),
      characters: [{ characterId: mina.id, variationId: 'var_0000000001' }],
      dialogue: [{ id: 'dlg_0000000003', speakerId: mina.id, kind: 'speech', text: 'Ready?' }]
    })
    const next = makePanel({ id: 'pnl_00000000a2', shot: 'establishing', description: 'City skyline.' })
    const s = buildPanelContext(panel, [mina, jin], prev, next)
    expect(s).toContain(`\nprevious: pnl_00000000a1 [wide] cast: Mina (Base) | ${'x'.repeat(160)} | dialogue: Mina: "Ready?"\n`)
    expect(s).not.toContain('x'.repeat(161))
    expect(s).toContain('\nnext: pnl_00000000a2 [establishing] cast: none | City skyline. | dialogue: none\n')
  })

  it('falls back to ids for a character or variation that is not in the roster', () => {
    const s = buildPanelContext(makePanel({ characters: [{ characterId: 'chr_00000000ff', variationId: 'var_00000000ff' }] }), [], null, null)
    expect(s).toContain('\ncast: chr_00000000ff (var_00000000ff)\n')
  })
})
