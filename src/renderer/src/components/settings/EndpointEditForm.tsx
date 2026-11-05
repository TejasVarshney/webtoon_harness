import { useState, type FormEvent } from 'react'
import type { EndpointPatch } from '@shared/ipc'
import type { EndpointConfig } from '@shared/types'
import { useModelsStore } from '../../stores/models-store'

export interface EndpointEditFormProps {
  endpoint: EndpointConfig & { hasKey: boolean }
  /** `keyCleared`: the host changed, so main removed the stored key. */
  onDone(result: { keyCleared: boolean }): void
  onCancel(): void
}

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

/**
 * Changes an endpoint's name, base URL and the timeout for its image draws and consistency checks, and for
 * `anthropic` the server-side refusal fallback.
 */
export function EndpointEditForm({ endpoint, onDone, onCancel }: EndpointEditFormProps) {
  const [name, setName] = useState(endpoint.name)
  const [baseUrl, setBaseUrl] = useState(endpoint.baseUrl)
  // Unset means on: only an explicit `false` turns the fallback off.
  const [fallback, setFallback] = useState(endpoint.options.serverSideFallback !== false)
  // Empty means the default (180 s).
  const [timeoutText, setTimeoutText] = useState(endpoint.options.timeoutSeconds === undefined ? '' : String(endpoint.options.timeoutSeconds))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const isAnthropic = endpoint.kind === 'anthropic'
  const incomplete = name.trim() === '' || baseUrl.trim() === ''

  async function submit(e: FormEvent): Promise<void> {
    e.preventDefault()
    if (busy || incomplete) return
    const seconds = timeoutText.trim() === '' ? undefined : Number(timeoutText)
    if (seconds !== undefined && (!Number.isInteger(seconds) || seconds < 10 || seconds > 3600)) {
      setError('Timeout must be a whole number of seconds from 10 to 3600, or empty for the default (180).')
      return
    }
    setBusy(true)
    setError(null)
    // The patch replaces `options` as a whole, so every option the form does not edit is carried over.
    const options: EndpointConfig['options'] = { ...endpoint.options }
    delete options.timeoutSeconds
    if (seconds !== undefined) options.timeoutSeconds = seconds
    if (isAnthropic) options.serverSideFallback = fallback
    const patch: EndpointPatch = { name: name.trim(), baseUrl: baseUrl.trim(), options }
    try {
      const { keyCleared } = await useModelsStore.getState().updateEndpoint(endpoint.id, patch)
      onDone({ keyCleared })
    } catch (err) {
      setError(errorText(err))
      setBusy(false)
    }
  }

  return (
    <form className="endpoint-form" aria-label="Edit endpoint" onSubmit={(e) => void submit(e)}>
      <label>
        Name
        <input value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <label>
        Base URL
        <input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} />
      </label>
      {endpoint.hasKey && <p className="placeholder">Changing the host clears the stored key, so it is never sent to another server.</p>}
      <label>
        Image and check timeout (seconds)
        <input inputMode="numeric" placeholder="180" value={timeoutText} onChange={(e) => setTimeoutText(e.target.value)} />
      </label>
      {isAnthropic && (
        <label className="inline-label">
          <input type="checkbox" checked={fallback} onChange={(e) => setFallback(e.target.checked)} />
          Server-side refusal fallback
        </label>
      )}
      {error !== null && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <div className="modal-actions">
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" disabled={busy || incomplete}>
          Save endpoint
        </button>
      </div>
    </form>
  )
}
