import { versionPosition } from '@shared/panel-versions'
import type { Character, Episode, Panel, PanelCharacter, ProjectMeta } from '@shared/types'

/** AGENTS.md plus the index of the other workflow docs. Stable for a given input. */
export function buildAgentSystemPrompt(agentsMd: string, index: { name: string; title: string }[]): string {
  const lines = index.map((d) => `- ${d.name}: ${d.title}`)
  return [agentsMd.trimEnd(), '', '## Available workflow docs', ...lines, '', 'Read a doc with read_workflow_doc before the task it governs.', ''].join('\n')
}

/** The body of the `## <heading>` section, up to the next `## ` heading, trimmed. Empty when absent. */
export function extractSection(markdown: string, heading: string): string {
  const lines = markdown.split(/\r?\n/)
  const start = lines.findIndex((l) => l.trimEnd() === `## ${heading}`)
  if (start === -1) return ''
  let end = lines.length
  for (let i = start + 1; i < lines.length; i++) {
    if (/^## /.test(lines[i])) {
      end = i
      break
    }
  }
  return lines.slice(start + 1, end).join('\n').trim()
}

const oneLine = (s: string): string => s.replace(/\s+/g, ' ').trim()

export interface StateSnapshotInput {
  meta: ProjectMeta
  characters: Character[]
  episode: Episode | null
  recentPanels: Panel[]
}

/** The compact `<project_state>` block stored with each user message. */
export function buildStateSnapshot(s: StateSnapshotInput): string {
  // Archived characters are left out of the roster but still name the speakers of existing panels.
  const names = new Map(s.characters.map((c) => [c.id, c.name]))
  const roster = s.characters.filter((c) => !c.archived)
  const lines = ['<project_state>', `title: ${oneLine(s.meta.title)}`, `story_mode: ${s.meta.storyMode}`, `style: ${oneLine(s.meta.stylePreset)}`]
  lines.push(s.episode ? `current_episode: ${s.episode.id} "${oneLine(s.episode.title)}" (${s.episode.panelIds.length} panels)` : 'current_episode: none')
  if (roster.length === 0) lines.push('characters: none')
  else {
    lines.push('characters:')
    for (const c of roster) {
      const vars = c.variations.map((v) => `${v.id} ${oneLine(v.name)} (${v.status})`).join(', ')
      lines.push(`- ${c.id} ${oneLine(c.name)} [${c.role}] variations: ${vars || 'none'}`)
    }
  }
  if (s.recentPanels.length === 0) lines.push('recent_panels: none')
  else {
    lines.push('recent_panels:')
    for (const p of s.recentPanels) lines.push(`- ${panelSummary(p, names, (pc) => pc.variationId)}`)
  }
  lines.push('</project_state>')
  return lines.join('\n')
}

/** One line: id, shot, cast, the first 160 characters of the description, and the dialogue. `detail` is what follows a cast member's name. */
function panelSummary(p: Panel, names: Map<string, string>, detail: (cast: PanelCharacter) => string): string {
  const cast = p.characters.map((pc) => `${names.get(pc.characterId) ?? pc.characterId} (${detail(pc)})`).join(', ')
  return `${p.id} [${p.shot}] cast: ${cast || 'none'} | ${oneLine(p.description).slice(0, 160)} | dialogue: ${dialogueLine(p, names) || 'none'}`
}

const dialogueLine = (p: Panel, names: Map<string, string>): string =>
  p.dialogue.map((d) => `${d.speakerId ? (names.get(d.speakerId) ?? d.speakerId) : d.kind}: "${oneLine(d.text)}"`).join(' / ')

/** The names a panel's cast entry shows under: the character's, and the name of the variation it wears. Ids when the roster lacks them. */
export function castNames(entry: PanelCharacter, roster: Character[]): { name: string; variationName: string } {
  const character = roster.find((c) => c.id === entry.characterId)
  const variation = character?.variations.find((v) => v.id === entry.variationId)
  return { name: character ? oneLine(character.name) : entry.characterId, variationName: variation ? oneLine(variation.name) : entry.variationId }
}

/**
 * The `<panel_context>` block stored with each panel side-chat message. `roster` should include archived
 * characters: they still name the cast and speakers of panels drawn before they were archived.
 */
export function buildPanelContext(panel: Panel, roster: Character[], prev: Panel | null, next: Panel | null): string {
  const names = new Map(roster.map((c) => [c.id, c.name]))
  const variationOf = (entry: PanelCharacter): string => castNames(entry, roster).variationName
  const position = versionPosition(panel, panel.currentVersionId)
  const cast = panel.characters.map((pc) => `${castNames(pc, roster).name} (${variationOf(pc)})`).join(', ')
  const lines = [
    '<panel_context>',
    `panel: ${panel.id}`,
    position ? `version: ${position.label} of ${position.readyCount}` : 'version: none',
    `shot: ${panel.shot}`,
    `aspect: ${panel.aspect}`,
    `setting: ${oneLine(panel.setting)}`,
    `description: ${oneLine(panel.description)}`,
    `cast: ${cast || 'none'}`,
    `dialogue: ${dialogueLine(panel, names) || 'none'}`
  ]
  if (panel.continuityNotes.trim() !== '') lines.push(`continuity_notes: ${oneLine(panel.continuityNotes)}`)
  if (panel.offPanelMentions.length > 0) lines.push(`off_panel_mentions: ${panel.offPanelMentions.map(oneLine).join(', ')}`)
  lines.push(`previous: ${prev ? panelSummary(prev, names, variationOf) : 'none'}`, `next: ${next ? panelSummary(next, names, variationOf) : 'none'}`, '</panel_context>')
  return lines.join('\n')
}

const PANEL_CHAT_INTRO = 'You are editing a single webtoon panel. Every tool acts on this panel only.'

/**
 * The panel side chat's system prompt: the intro, the Hard Rules of AGENTS.md and the panel-editing
 * workflow doc. The doc is empty until the project has one, in which case it is left out.
 */
export function buildPanelChatSystemPrompt(agentsMd: string, panelEditingDoc: string): string {
  const rules = extractSection(agentsMd, 'Hard Rules')
  return [PANEL_CHAT_INTRO, rules === '' ? '' : `## Hard Rules\n${rules}`, panelEditingDoc.trim()].filter((part) => part !== '').join('\n\n')
}
