import { useState, type FormEvent } from 'react'
import type { EndpointKind } from '@shared/types'
import { useModelsStore } from '../../stores/models-store'
import { ADDABLE_KINDS, presets } from './presets'

export interface EndpointFormProps {
  /** `problem` is set when the endpoint was created but a later step (key, suggested models) failed. */
  onDone(problem?: string): void
  onCancel(): void
}

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

export function EndpointForm({ onDone, onCancel }: EndpointFormProps) {
  const { addEndpoint, setApiKey, addModel } = useModelsStore.getState()
  const [presetLabel, setPresetLabel] = useState('')
  const [name, setName] = useState('')
  const [kind, setKind] = useState<EndpointKind>('openai')
  const [baseUrl, setBaseUrl] = useState('')
  const [apiKey, setKey] = useState('')
  const [skipped, setSkipped] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const preset = presets.find((p) => p.label === presetLabel)

  function choosePreset(label: string): void {
    setPresetLabel(label)
    setSkipped(new Set())
    const p = presets.find((x) => x.label === label)
    if (p) {
      setName(p.label)
      setKind(p.kind)
      setBaseUrl(p.baseUrl)
    }
  }

  async function submit(e: FormEvent): Promise<void> {
    e.preventDefault()
    if (busy || name.trim() === '' || baseUrl.trim() === '') return
    setBusy(true)
    setError(null)
    let created: { id: string }
    try {
      created = await addEndpoint({ name: name.trim(), kind, baseUrl: baseUrl.trim() })
    } catch (err) {
      setError(errorText(err))
      setBusy(false)
      return
    }
    // The endpoint exists from here on, so a later failure closes the form rather than inviting a duplicate.
    try {
      if (apiKey.trim() !== '') await setApiKey(created.id, apiKey.trim())
      for (const m of preset?.suggestedModels ?? []) {
        if (skipped.has(m.modelId)) continue
        await addModel({ endpointId: created.id, modelId: m.modelId, label: m.modelId, capabilities: m.capabilities })
      }
    } catch (err) {
      onDone(`Endpoint saved, but: ${errorText(err)}`)
      return
    }
    onDone()
  }

  return (
    <form className="endpoint-form" aria-label="Add endpoint" onSubmit={(e) => void submit(e)}>
      <label>
        Preset
        <select value={presetLabel} onChange={(e) => choosePreset(e.target.value)}>
          <option value="">Custom</option>
          {presets.map((p) => (
            <option key={p.label} value={p.label}>
              {p.label}
            </option>
          ))}
        </select>
      </label>
      <label>
        Name
        <input value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <label>
        Kind
        <select value={kind} onChange={(e) => setKind(e.target.value as EndpointKind)}>
          {ADDABLE_KINDS.map((k) => (
            <option key={k} value={k}>
              {k}
            </option>
          ))}
        </select>
      </label>
      <label>
        Base URL
        <input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} />
      </label>
      <label>
        API key
        <input type="password" autoComplete="off" value={apiKey} onChange={(e) => setKey(e.target.value)} placeholder="Stored encrypted; never shown again" />
      </label>
      {preset !== undefined && preset.suggestedModels.length > 0 && (
        <fieldset>
          <legend>Suggested models</legend>
          {preset.suggestedModels.map((m) => (
            <label key={m.modelId} className="inline-label">
              <input
                type="checkbox"
                checked={!skipped.has(m.modelId)}
                onChange={(e) =>
                  setSkipped((prev) => {
                    const next = new Set(prev)
                    if (e.target.checked) next.delete(m.modelId)
                    else next.add(m.modelId)
                    return next
                  })
                }
              />
              {m.modelId}
            </label>
          ))}
        </fieldset>
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
        <button type="submit" disabled={busy || name.trim() === '' || baseUrl.trim() === ''}>
          Save endpoint
        </button>
      </div>
    </form>
  )
}
