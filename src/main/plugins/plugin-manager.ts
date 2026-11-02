import { z } from 'zod'
import type { PluginView } from '@shared/types'
import { CorruptFileError, EntityNotFoundError } from '../domain/errors'
import type { EventBus } from '../events/bus'
import type { Services } from '../services'
import { readJson, writeJsonAtomic } from '../storage/atomic'
import { KeyedMutex } from '../storage/mutex'
import type { ActiveContext } from './active-context'
import type { AgentBackend, HarnessPlugin, PluginHost, PluginStatus } from './types'

const PluginsFileSchema = z.object({
  plugins: z.record(z.string(), z.object({ enabled: z.boolean(), config: z.record(z.string(), z.unknown()).default({}) }))
})
type PluginsFile = z.infer<typeof PluginsFileSchema>

/** How long a plugin's `stop()` may take before the app moves on without it. */
const STOP_CAP_MS = 5_000

const LIFECYCLE_KEY = 'lifecycle'

/**
 * The built-in plugins and their saved state (`plugins.json`). Entries for ids that are not built in are kept
 * and ignored. A corrupt file is reported by `loadError()`, treated as "all off", and never overwritten: changes
 * are refused until it is fixed.
 *
 * Starting and stopping run one at a time (`LIFECYCLE_KEY`); saving has its own lock (the file path), so a plugin
 * can save its config from inside `start()`.
 */
export class PluginManager {
  private readonly mutex = new KeyedMutex()
  private readonly file: string
  private readonly plugins: HarnessPlugin[]
  private readonly services: Services
  private readonly bus: EventBus
  private readonly activeContext: ActiveContext
  private state: PluginsFile = { plugins: {} }
  private corrupt: string | null = null
  /** Plugins whose `start` has been called and `stop` has not: the ones to stop at quit. */
  private readonly active = new Set<string>()
  private readonly startErrors = new Map<string, PluginStatus>()

  constructor(opts: { file: string; plugins: HarnessPlugin[]; services: Services; activeContext: ActiveContext }) {
    this.file = opts.file
    this.plugins = opts.plugins
    this.services = opts.services
    this.bus = opts.services.bus
    this.activeContext = opts.activeContext
  }

  /** A missing file means every plugin is off. A corrupt one is left untouched; see `loadError()`. */
  async load(): Promise<void> {
    await this.mutex.run(this.file, async () => {
      try {
        this.state = await readJson(this.file, PluginsFileSchema)
        this.corrupt = null
      } catch (error) {
        if (error instanceof CorruptFileError) {
          this.state = { plugins: {} }
          this.corrupt = error.message
        } else if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          this.state = { plugins: {} }
        } else {
          throw error
        }
      }
    })
  }

  /** The message about a corrupt `plugins.json`, or null. */
  loadError(): string | null {
    return this.corrupt
  }

  /** Starts every plugin that is enabled; a plugin that fails to start shows an error status. Never throws. */
  startEnabled(): Promise<void> {
    return this.mutex.run(LIFECYCLE_KEY, async () => {
      const toStart = this.plugins.filter((p) => this.isEnabled(p.id) && !this.active.has(p.id))
      if (toStart.length === 0) return
      await Promise.all(toStart.map((p) => this.startPlugin(p)))
      this.bus.emit({ type: 'plugins.changed' })
    })
  }

  list(): PluginView[] {
    return this.plugins.map((p) => this.view(p))
  }

  get(id: string): HarnessPlugin | undefined {
    return this.plugins.find((p) => p.id === id)
  }

  isEnabled(id: string): boolean {
    return this.state.plugins[id]?.enabled === true
  }

  async setEnabled(id: string, enabled: boolean): Promise<PluginView> {
    const plugin = this.require(id)
    return this.mutex.run(LIFECYCLE_KEY, async () => {
      await this.mutate((draft) => {
        entry(draft, id).enabled = enabled
      })
      if (enabled) await this.startPlugin(plugin)
      else await this.stopPlugin(plugin)
      this.bus.emit({ type: 'plugins.changed' })
      return this.view(plugin)
    })
  }

  /** Merges `patch` into the plugin's config and saves it (unless the plugin's `validateConfig` refuses it); a running plugin is restarted so it sees the change. */
  async setConfig(id: string, patch: Record<string, unknown>): Promise<PluginView> {
    const plugin = this.require(id)
    plugin.validateConfig?.(patch)
    return this.mutex.run(LIFECYCLE_KEY, async () => {
      await this.mutate((draft) => {
        const e = entry(draft, id)
        e.config = { ...e.config, ...patch }
      })
      if (this.active.has(id)) {
        await this.stopPlugin(plugin)
        await this.startPlugin(plugin)
      }
      this.bus.emit({ type: 'plugins.changed' })
      return this.view(plugin)
    })
  }

  /** Stops every started plugin at once; one whose `stop` never settles is given up on after 5 s. Never throws. */
  async stopAll(): Promise<void> {
    await Promise.all(this.plugins.filter((p) => this.active.has(p.id)).map((p) => this.stopPlugin(p)))
  }

  /** The backend of the enabled plugin that is set to run the main chat (`config.useAsAgent`), if any. */
  agentBackend(): AgentBackend | null {
    for (const p of this.plugins) {
      if (p.agentBackend && this.isEnabled(p.id) && this.state.plugins[p.id]?.config.useAsAgent === true) return p.agentBackend
    }
    return null
  }

  private require(id: string): HarnessPlugin {
    const plugin = this.get(id)
    if (!plugin) throw new EntityNotFoundError('plugin', id)
    return plugin
  }

  /** Applies `change` to a copy, writes it, and only then adopts it, so a failed write leaves the state as it was. */
  private mutate(change: (draft: PluginsFile) => void): Promise<void> {
    return this.mutex.run(this.file, async () => {
      if (this.corrupt !== null) throw new Error(`Plugin settings were not saved. Fix or remove the file first: ${this.corrupt}`)
      const draft = structuredClone(this.state)
      change(draft)
      await writeJsonAtomic(this.file, draft)
      this.state = draft
    })
  }

  private host(id: string): PluginHost {
    return {
      services: this.services,
      bus: this.bus,
      secrets: this.services.secrets,
      activeContext: () => this.activeContext,
      config: () => structuredClone(this.state.plugins[id]?.config ?? {}),
      setConfig: async (patch) => {
        await this.mutate((draft) => {
          const e = entry(draft, id)
          e.config = { ...e.config, ...patch }
        })
        this.bus.emit({ type: 'plugins.changed' })
      }
    }
  }

  private async startPlugin(plugin: HarnessPlugin): Promise<void> {
    if (this.active.has(plugin.id)) return
    this.active.add(plugin.id)
    this.startErrors.delete(plugin.id)
    try {
      await plugin.start(this.host(plugin.id))
    } catch (error) {
      this.startErrors.set(plugin.id, { state: 'error', message: error instanceof Error ? error.message : String(error) })
    }
  }

  private async stopPlugin(plugin: HarnessPlugin): Promise<void> {
    if (!this.active.delete(plugin.id)) return
    this.startErrors.delete(plugin.id)
    let timer: NodeJS.Timeout | undefined
    const timeout = new Promise<'timeout'>((resolve) => {
      timer = setTimeout(() => resolve('timeout'), STOP_CAP_MS)
    })
    try {
      const outcome = await Promise.race([Promise.resolve().then(() => plugin.stop()).then(() => 'stopped' as const), timeout])
      if (outcome === 'timeout') console.warn(`Plugin ${plugin.id} did not stop within ${STOP_CAP_MS / 1000} s; moving on`)
    } catch (error) {
      console.error(`Plugin ${plugin.id} failed to stop`, error)
    } finally {
      clearTimeout(timer)
    }
  }

  private view(plugin: HarnessPlugin): PluginView {
    const status: PluginStatus =
      this.isEnabled(plugin.id) && this.active.has(plugin.id)
        ? (this.startErrors.get(plugin.id) ?? safeStatus(plugin))
        : { state: 'off', message: '' }
    return {
      id: plugin.id,
      name: plugin.name,
      description: plugin.description,
      enabled: this.isEnabled(plugin.id),
      status,
      config: structuredClone(this.state.plugins[plugin.id]?.config ?? {})
    }
  }
}

function entry(draft: PluginsFile, id: string): PluginsFile['plugins'][string] {
  return (draft.plugins[id] ??= { enabled: false, config: {} })
}

function safeStatus(plugin: HarnessPlugin): PluginStatus {
  try {
    return plugin.status()
  } catch (error) {
    return { state: 'error', message: error instanceof Error ? error.message : String(error) }
  }
}
