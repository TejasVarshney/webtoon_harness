import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { ALL_TOOL_NAMES } from '../../agent/tools'
import { continueStoryPrompt } from '../../../shared/prompts'

const integrations = path.resolve(__dirname, '../../../../integrations')
const pluginDir = path.join(integrations, 'claude-code-plugin')

const readText = (...parts: string[]): string => fs.readFileSync(path.join(...parts), 'utf8')
const readJson = (...parts: string[]): any => JSON.parse(readText(...parts))

const textFiles = [
  path.join(integrations, '.claude-plugin', 'marketplace.json'),
  path.join(pluginDir, '.claude-plugin', 'plugin.json'),
  path.join(pluginDir, '.mcp.json'),
  path.join(pluginDir, 'skills', 'webtoon-agent', 'SKILL.md'),
  path.join(pluginDir, 'commands', 'continue-story.md'),
  path.join(pluginDir, 'commands', 'draw-panel.md'),
  path.join(pluginDir, 'commands', 'new-character.md'),
  path.join(pluginDir, 'README.md')
]

/** `get_project_state` exists only on the MCP link; the rest are the agent's tools. */
const MCP_TOOL_NAMES = new Set([...ALL_TOOL_NAMES, 'get_project_state'])

describe('Claude Code plugin files', () => {
  it('marketplace.json lists the plugin and its source folder exists', () => {
    const market = readJson(integrations, '.claude-plugin', 'marketplace.json')
    expect(market.name).toBe('webtoon-harness-local')
    expect(market.owner).toEqual({ name: 'Webtoon AI Harness' })
    expect(market.plugins).toHaveLength(1)
    const entry = market.plugins[0]
    expect(entry.name).toBe('webtoon-harness')
    expect(typeof entry.description).toBe('string')
    expect(fs.statSync(path.resolve(integrations, entry.source)).isDirectory()).toBe(true)
  })

  it('plugin.json names the plugin', () => {
    const plugin = readJson(pluginDir, '.claude-plugin', 'plugin.json')
    expect(plugin.name).toBe('webtoon-harness')
    expect(plugin.version).toMatch(/^\d+\.\d+\.\d+$/)
    expect(plugin.description.length).toBeGreaterThan(0)
  })

  it('.mcp.json points the webtoon server at the link with an env-expanded token', () => {
    const mcp = readJson(pluginDir, '.mcp.json')
    expect(mcp).toEqual({
      mcpServers: {
        webtoon: {
          type: 'http',
          url: 'http://127.0.0.1:${WEBTOON_MCP_PORT:-7880}/mcp',
          headers: { Authorization: 'Bearer ${WEBTOON_MCP_TOKEN}' }
        }
      }
    })
  })

  it('SKILL.md has the frontmatter and starts from get_project_state', () => {
    const skill = readText(pluginDir, 'skills', 'webtoon-agent', 'SKILL.md')
    expect(skill).toMatch(/^---\nname: webtoon-agent\ndescription: .+\n---\n/)
    expect(skill).toContain('`get_project_state`')
    expect(skill).toContain('`read_workflow_doc`')
  })

  it('every tool named in backticks in the skill and commands exists', () => {
    const files = [
      path.join(pluginDir, 'skills', 'webtoon-agent', 'SKILL.md'),
      path.join(pluginDir, 'commands', 'continue-story.md'),
      path.join(pluginDir, 'commands', 'draw-panel.md'),
      path.join(pluginDir, 'commands', 'new-character.md')
    ]
    for (const file of files) {
      const names = [...readText(file).matchAll(/`([a-z]+(?:_[a-z]+)+)`/g)].map((m) => m[1])
      for (const name of names) {
        expect(MCP_TOOL_NAMES.has(name), `${path.basename(file)}: unknown tool \`${name}\``).toBe(true)
      }
    }
  })

  it('continue-story uses the Continue story sentence with $ARGUMENTS and defaults to 4', () => {
    const body = readText(pluginDir, 'commands', 'continue-story.md')
    expect(body).toContain(continueStoryPrompt(0).replace('0', '$ARGUMENTS'))
    expect(body).toContain('Continue the story: plan the next beats and draw the next $ARGUMENTS panels.')
    expect(body).toMatch(/default is 4/i)
    expect(body).toContain('workflows/story-direction')
  })

  it('draw-panel and new-character take $ARGUMENTS and name their workflow', () => {
    expect(readText(pluginDir, 'commands', 'draw-panel.md')).toContain('$ARGUMENTS')
    expect(readText(pluginDir, 'commands', 'draw-panel.md')).toContain('workflows/panel-generation')
    expect(readText(pluginDir, 'commands', 'new-character.md')).toContain('$ARGUMENTS')
    expect(readText(pluginDir, 'commands', 'new-character.md')).toContain('workflows/character-creation')
  })

  it('no file contains a token-looking string', () => {
    for (const file of textFiles) {
      expect(readText(file), path.relative(integrations, file)).not.toMatch(/[A-Za-z0-9_-]{40,}/)
    }
  })
})
