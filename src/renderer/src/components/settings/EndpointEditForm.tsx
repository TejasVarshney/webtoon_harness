import { useState, type FormEvent } from 'react'
import type { EndpointPatch } from '@shared/ipc'
import type { EndpointConfig } from '@shared/types'
import { useModelsStore } from '../../stores/models-store'

export interface EndpointEditFormProps {
  endpoint: EndpointConfig & { hasKey: boolean }
  /** `keyCleared`: the host changed, so main removed the stored key (Ruling F3). */
  onDone(result: { keyCleared: boolean }): void
  onCancel(): void
}

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

/** Changes an endpoint's name and base URL, and for `anthropic` the server-side refusal fallback (spec §3, T26a). */
export function EndpointEditForm({ endpoint, onDone, onCancel }: EndpointEditFormProps) {
  const [name, setName] = useState(endpoint.name)
  const [baseUrl, setBaseUrl] = useState(endpoint.baseUrl)
  // Unset means on: only an explicit `false` turns the fallback off.
  const [fallback, setFallback] = useState(endpoint.options.serverSideFallback !== false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const isAnthropic = endpoint.kind === 'anthropic'
  const incomplete = name.trim() === '' || baseUrl.trim() === ''

  async function submit(e: FormEvent): Promise<void> {
    e.preventDefault()
    if (busy || incomplete) return
    setBusy(true)
    setError(null)
    const patch: EndpointPatch = { name: name.trim(), baseUrl: baseUrl.trim() }
    if (isAnthropic) patch.options = { ...endpoint.options, serverSideFallback: fallback }
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
