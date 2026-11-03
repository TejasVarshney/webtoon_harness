import { createClaudeCodePlugin } from './claude-code/plugin'
import type { HarnessPlugin } from './types'

/** The plugins that ship with the app. */
export function builtinPlugins(): HarnessPlugin[] {
  return [createClaudeCodePlugin()]
}
