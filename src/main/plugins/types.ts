import type { PluginStatus } from '@shared/types'
import type { StartRunInput } from '../agent/agent-runner'
import type { EventBus } from '../events/bus'
import type { SecretStore } from '../models/secrets'
import type { Services } from '../services'
import type { ActiveContext } from './active-context'

export type { PluginStatus }

/** A built-in plugin (spec §4.1). Nothing is loaded from outside the app. */
export interface HarnessPlugin {
  id: string
  name: string
  description: string
  /** Called when the plugin is enabled (and at app start if it was enabled). Never throws: problems go to status(). */
  start(host: PluginHost): Promise<void>
  /** Called when disabled and at app quit. Must release ports and child processes. */
  stop(): Promise<void>
  /** A short line for Settings, e.g. "Listening on 127.0.0.1:7880" or "Port 7880 is in use". */
  status(): PluginStatus
  /** Called with a config patch before it is saved; throws a readable error to refuse it. */
  validateConfig?(patch: Record<string, unknown>): void
  /** Phase 2. */
  agentBackend?: AgentBackend
}

/** What the app gives a plugin when it starts. */
export interface PluginHost {
  services: Services
  bus: EventBus
  secrets: SecretStore
  activeContext(): ActiveContext
  /** This plugin's `config` in plugins.json. */
  config(): Record<string, unknown>
  /** Merges `patch` into this plugin's config and saves it. Does not restart the plugin. */
  setConfig(patch: Record<string, unknown>): Promise<void>
}

/** Runs the main chat in place of the model loop (spec §6.1). */
export interface AgentBackend {
  /** Same shape as AgentRunner.start: appends the user message, streams AgentEvents for `threadKey`, persists the outcome. */
  start(input: StartRunInput): Promise<{ runId: string }>
  stop(sessionId: string): Promise<void>
  /** Stops the run with this id, if it is one of this backend's; does not wait for it to end. */
  cancel(runId: string): void
  isRunning(threadKey: string): boolean
}
