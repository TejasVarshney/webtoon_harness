import type { Character, Episode, Panel, ProjectMeta } from '@shared/types'

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
    for (const p of s.recentPanels) {
      const cast = p.characters.map((pc) => `${names.get(pc.characterId) ?? pc.characterId} (${pc.variationId})`).join(', ')
      const dialogue = p.dialogue.map((d) => `${d.speakerId ? (names.get(d.speakerId) ?? d.speakerId) : d.kind}: "${oneLine(d.text)}"`).join(' / ')
      lines.push(`- ${p.id} [${p.shot}] cast: ${cast || 'none'} | ${oneLine(p.description).slice(0, 160)} | dialogue: ${dialogue || 'none'}`)
    }
  }
  lines.push('</project_state>')
  return lines.join('\n')
}
