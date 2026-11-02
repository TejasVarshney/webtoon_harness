import { useEffect, useState } from 'react'
import type { PluginView } from '@shared/types'
import { api } from '../../api'
import { usePluginsStore } from '../../stores/plugins-store'

const DEFAULT_PORT = 7880

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

function statusText(plugin: PluginView): string {
  if (plugin.status.state === 'off') return 'Off'
  return plugin.status.message
}

interface ClaudeCodeControlsProps {
  plugin: PluginView
  /** Runs a task, showing its failure in the tab's error line and its success message as a notice. */
  run(task: Promise<unknown>, done?: string): void
}

/** What the `claude-code` card adds while the plugin is on: the port, the connect command and the token. */
function ClaudeCodeControls({ plugin, run }: ClaudeCodeControlsProps) {
  const saved = typeof plugin.config.port === 'number' ? plugin.config.port : DEFAULT_PORT
  const [port, setPort] = useState(String(saved))

  useEffect(() => setPort(String(saved)), [saved])

  async function copyCommand(): Promise<void> {
    const { command } = await api.invoke('claudeCode:connectCommand', {})
    await navigator.clipboard.writeText(command)
  }

  return (
    <div className="plugin-controls">
      <form
        className="plugin-port"
        onSubmit={(e) => {
          e.preventDefault()
          // Main validates the range and says so; an empty field reaches it as 0.
          run(usePluginsStore.getState().setConfig(plugin.id, { port: Number(port) }))
        }}
      >
        <label htmlFor={`${plugin.id}-port`}>Port</label>
        <input id={`${plugin.id}-port`} type="number" value={port} onChange={(e) => setPort(e.target.value)} />
        <button type="submit" disabled={port === String(saved)}>
          Save port
        </button>
      </form>
      <div className="plugin-actions">
        <button type="button" onClick={() => run(copyCommand(), 'Command copied. Paste it into a terminal to connect Claude Code.')}>
          Copy command
        </button>
        <button type="button" onClick={() => run(regenerate(), 'Token replaced. Copy the command again to reconnect.')}>
          Regenerate token
        </button>
      </div>
      <p className="hint">Saving a new port restarts the link. Regenerating the token disconnects every client that uses the old one.</p>
    </div>
  )
}

async function regenerate(): Promise<void> {
  await api.invoke('claudeCode:regenerateToken', {})
}

/** The built-in plugins: switch them on and off, see how they are doing, and set up the Claude Code link. */
export function PluginsTab() {
  const plugins = usePluginsStore((s) => s.plugins)
  const loadError = usePluginsStore((s) => s.loadError)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    usePluginsStore
      .getState()
      .load()
      .catch((e: unknown) => setError(errorText(e)))
  }, [])

  function run(task: Promise<unknown>, done?: string): void {
    setError(null)
    setNotice(null)
    task.then(
      () => setNotice(done ?? null),
      (e: unknown) => setError(errorText(e))
    )
  }

  if (plugins === null) return error === null ? <p className="placeholder">Loading plugins...</p> : <p role="alert" className="error">{error}</p>

  return (
    <div className="plugins-tab">
      {loadError !== null && (
        <p role="alert" className="error" data-testid="plugins-load-error">
          plugins.json could not be read: {loadError}. All plugins are off until it is fixed.
        </p>
      )}
      {notice !== null && (
        <p role="status" className="notice-info">
          {notice}
        </p>
      )}
      {error !== null && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <section>
        <div className="section-header">
          <h3>Plugins</h3>
        </div>
        {plugins.map((plugin) => (
          <div key={plugin.id} className="plugin-card" data-testid={`plugin-${plugin.id}`}>
            <div className="plugin-header">
              <strong>{plugin.name}</strong>
              <span className="plugin-status" data-state={plugin.status.state} data-testid={`plugin-status-${plugin.id}`}>
                {statusText(plugin)}
              </span>
              <input
                type="checkbox"
                role="switch"
                className="plugin-switch"
                aria-label={plugin.name}
                checked={plugin.enabled}
                disabled={loadError !== null}
                onChange={(e) => run(usePluginsStore.getState().setEnabled(plugin.id, e.target.checked))}
              />
            </div>
            <p className="hint">{plugin.description}</p>
            {plugin.enabled && plugin.id === 'claude-code' && <ClaudeCodeControls plugin={plugin} run={run} />}
          </div>
        ))}
      </section>
    </div>
  )
}
