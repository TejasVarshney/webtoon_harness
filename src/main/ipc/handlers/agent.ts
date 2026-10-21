import type { Services } from '../../services'
import type { HandlerMap } from './projects'

export function agentHandlers(s: Services): HandlerMap {
  return {
    'agent:send': (req) => s.agent.start(req),
    'agent:cancel': async ({ runId }) => s.agent.cancel(runId)
  }
}
