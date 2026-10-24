import { z } from 'zod'
import type { Services } from '../../services'
import { parseInput } from '../validate'
import type { HandlerMap } from './projects'

const SendSchema = z.object({ projectId: z.string(), panelId: z.string(), text: z.string() })

/** A panel's side chat. Like `agent:send`, sending returns the run id at once; the reply follows as `agent.event`s keyed `panel:<panelId>`. */
export function panelChatHandlers(s: Services): HandlerMap {
  return {
    'panelChat:load': async ({ projectId, panelId }) => s.panelChat.load(await s.projects.open(projectId), panelId),
    'panelChat:send': async (req) => s.panelChat.start(parseInput(SendSchema, req)),
    'panelChat:cancel': async ({ runId }) => s.panelChat.cancel(runId)
  }
}
