import { describe, expect, it } from 'vitest'
import { resolveMockRefs } from '../models/providers/mock'
import { makeCharacter, makeEpisode, makeMeta, makePanel, makeVariation } from '../test/factories'
import { buildAgentSystemPrompt, buildStateSnapshot, extractSection } from './system-prompt'

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
