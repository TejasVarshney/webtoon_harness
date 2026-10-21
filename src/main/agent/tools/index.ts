import { ToolRegistry } from './registry'

/** The agent's tool set. Empty for now; later tasks add tool groups here. */
export function buildAgentTools(opts: { vision: boolean }): ToolRegistry {
  void opts.vision
  return new ToolRegistry([])
}
