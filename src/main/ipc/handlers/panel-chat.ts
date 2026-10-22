import type { Services } from '../../services'
import type { HandlerMap } from './projects'

/** A panel's side chat. Like `agent:send`, sending returns the run id at once; the reply follows as `agent.event`s keyed `panel:<panelId>`. */
export function panelChatHandlers(s: Services): HandlerMap {
  return {
    'panelChat:load': async ({ projectId, panelId }) => s.panelChat.load(await s.projects.open(projectId), panelId),
    'panelChat:send': (req) => s.panelChat.start(req),
    'panelChat:cancel': async ({ runId }) => s.panelChat.cancel(runId)
  }
}
