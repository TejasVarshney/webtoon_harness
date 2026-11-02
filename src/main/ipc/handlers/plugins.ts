import { z } from 'zod'
import type { Services } from '../../services'
import { LINK_OFF, type ClaudeCodePlugin } from '../../plugins/claude-code/plugin'
import { IdSchema, parseInput } from '../validate'
import type { HandlerMap } from './projects'

const SetEnabledSchema = z.object({ id: z.string(), enabled: z.boolean() })
const SetConfigSchema = z.object({ id: z.string(), patch: z.record(z.string(), z.unknown()) })
const ActiveContextSchema = z.object({ projectId: IdSchema.nullable(), episodeId: IdSchema.nullable() })

/** The Claude Code plugin, if it is on; otherwise the "turn it on first" error. */
function claudeCode(s: Services): ClaudeCodePlugin {
  const plugin = s.plugins.get('claude-code')
  if (!plugin || !s.plugins.isEnabled('claude-code')) throw new Error(LINK_OFF)
  return plugin as ClaudeCodePlugin
}

/** The built-in plugins, and the window's active project and episode that they act on. */
export function pluginsHandlers(s: Services): HandlerMap {
  return {
    'plugins:list': async () => s.plugins.list(),
    'plugins:loadError': async () => s.plugins.loadError(),
    'plugins:setEnabled': async (req) => {
      const { id, enabled } = parseInput(SetEnabledSchema, req)
      return s.plugins.setEnabled(id, enabled)
    },
    'plugins:setConfig': async (req) => {
      const { id, patch } = parseInput(SetConfigSchema, req)
      return s.plugins.setConfig(id, patch)
    },
    'claudeCode:connectCommand': async () => ({ command: claudeCode(s).connectCommand() }),
    'claudeCode:regenerateToken': async () => claudeCode(s).regenerateToken(),
    'app:setActiveContext': async (req) => {
      s.activeContext.set(parseInput(ActiveContextSchema, req))
    }
  }
}
