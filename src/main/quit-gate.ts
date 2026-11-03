export interface QuitGateDeps {
  /** Aborts every run, so each loop persists results for its pending tool calls. */
  cancelRuns(): void
  /** Stops the plugins (5 s cap each). */
  stopPlugins(): Promise<void>
  /** Runs the quit again; this time the gate lets it pass. */
  quit(): void
}

/**
 * The app's `before-quit` handler. `before-quit` cannot wait, so the first one is held back while the plugins stop,
 * then the quit is run again and passes. Whatever fails on the way, the quit still happens: a throw here would
 * leave the app impossible to quit.
 */
export function createQuitGate(deps: QuitGateDeps): (event: { preventDefault(): void }) => void {
  let pluginsStopped = false
  let stoppingPlugins = false
  return (event) => {
    if (pluginsStopped) return
    event.preventDefault()
    if (stoppingPlugins) return
    stoppingPlugins = true
    try {
      deps.cancelRuns()
    } catch (error) {
      console.error('Could not cancel the runs at quit', error)
    } finally {
      void deps
        .stopPlugins()
        .catch((error: unknown) => console.error('Could not stop the plugins at quit', error))
        .finally(() => {
          pluginsStopped = true
          deps.quit()
        })
    }
  }
}
