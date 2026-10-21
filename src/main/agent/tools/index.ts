import { characterTools } from './character-tools'
import { panelTools } from './panel-tools'
import { ToolRegistry } from './registry'

/** The agent's tool set. `view_panel_image` needs a model that can see, so it is offered only with `vision`. */
export function buildAgentTools(opts: { vision: boolean }): ToolRegistry {
  const panels = opts.vision ? panelTools : panelTools.filter((tool) => tool.name !== 'view_panel_image')
  return new ToolRegistry([...characterTools, ...panels])
}
