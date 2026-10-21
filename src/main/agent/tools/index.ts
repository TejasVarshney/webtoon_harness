import { characterTools } from './character-tools'
import { ToolRegistry } from './registry'

/** The agent's tool set. Later tasks add tool groups here. */
export function buildAgentTools(opts: { vision: boolean }): ToolRegistry {
  void opts.vision
  return new ToolRegistry([...characterTools])
}
