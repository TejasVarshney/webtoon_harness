import { z } from 'zod'
import type { Services } from '../../services'
import { IdSchema, parseInput } from '../validate'
import type { HandlerMap } from './projects'

const SetEnabledSchema = z.object({ id: z.string(), enabled: z.boolean() })
const SetConfigSchema = z.object({ id: z.string(), patch: z.record(z.string(), z.unknown()) })
const ActiveContextSchema = z.object({ projectId: IdSchema.nullable(), episodeId: IdSchema.nullable() })

/** The built-in plugins, and the window's active project and episode that they act on. */
export function pluginsHandlers(s: Services): HandlerMap {
  return {
    'plugins:list': async () => s.plugins.list(),
    'plugins:setEnabled': async (req) => {
      const { id, enabled } = parseInput(SetEnabledSchema, req)
      return s.plugins.setEnabled(id, enabled)
    },
    'plugins:setConfig': async (req) => {
      const { id, patch } = parseInput(SetConfigSchema, req)
      return s.plugins.setConfig(id, patch)
    },
    'app:setActiveContext': async (req) => {
      s.activeContext.set(parseInput(ActiveContextSchema, req))
    }
  }
}
