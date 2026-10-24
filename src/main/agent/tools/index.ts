import { characterTools } from './character-tools'
import { docTools } from './doc-tools'
import { buildPanelChatTools } from './panel-chat-tools'
import { panelTools } from './panel-tools'
import { ToolRegistry } from './registry'
import { storyTools } from './story-tools'

/** The agent's tool set. `view_panel_image` needs a model that can see, so it is offered only with `vision`. */
export function buildAgentTools(opts: { vision: boolean }): ToolRegistry {
  const panels = opts.vision ? panelTools : panelTools.filter((tool) => tool.name !== 'view_panel_image')
  return new ToolRegistry([...characterTools, ...panels, ...storyTools, ...docTools])
}

/** Every tool name a model can be offered: the main agent's and the panel side chat's, each once. The workflow-doc lint checks the docs against it. */
export const ALL_TOOL_NAMES: string[] = [
  ...new Set([...buildAgentTools({ vision: true }).names(), ...buildPanelChatTools('pnl_0000000000', { vision: true }).names()])
]
