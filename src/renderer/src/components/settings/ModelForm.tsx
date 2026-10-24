import { useState, type FormEvent } from 'react'
import type { Capability, EndpointConfig, ModelConfig } from '@shared/types'
import { useModelsStore } from '../../stores/models-store'
import { KIND_CAPABILITIES } from './presets'

export interface ModelFormProps {
  endpoint: EndpointConfig
  /** Present when editing. */
  model?: ModelConfig
  onDone(): void
  onCancel(): void
}

export function ModelForm({ endpoint, model, onDone, onCancel }: ModelFormProps) {
  const { addModel, updateModel } = useModelsStore.getState()
  const [modelId, setModelId] = useState(model?.modelId ?? '')
  const [label, setLabel] = useState(model?.label ?? '')
  const [capabilities, setCapabilities] = useState<Capability[]>(model?.capabilities ?? [])
  const [maxRefs, setMaxRefs] = useState(String(model?.maxReferenceImages ?? 4))
  const [params, setParams] = useState(JSON.stringify(model?.params ?? {}, null, 2))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const allowed = KIND_CAPABILITIES[endpoint.kind]

  function toggle(c: Capability, on: boolean): void {
    setCapabilities((prev) => (on ? [...prev, c] : prev.filter((x) => x !== c)))
  }

  async function submit(e: FormEvent): Promise<void> {
    e.preventDefault()
    if (busy) return
    let parsedParams: Record<string, unknown>
    try {
      const value: unknown = JSON.parse(params.trim() === '' ? '{}' : params)
      if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('not an object')
      parsedParams = value as Record<string, unknown>
    } catch {
      setError('Params must be a JSON object, for example {"effort":"high"}.')
      return
    }
    const refs = Number(maxRefs)
    if (!Number.isInteger(refs) || refs < 0) {
      setError('Max reference images must be a whole number.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const fields = { modelId: modelId.trim(), label: label.trim() || modelId.trim(), capabilities, params: parsedParams, maxReferenceImages: refs }
      if (model) await updateModel(model.id, fields)
      else await addModel({ endpointId: endpoint.id, ...fields })
      onDone()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setBusy(false)
    }
  }

  return (
    <form className="model-form" aria-label={model ? 'Edit model' : 'Add model'} onSubmit={(e) => void submit(e)}>
      <label>
        Model id
        <input value={modelId} onChange={(e) => setModelId(e.target.value)} />
      </label>
      <label>
        Label
        <input value={label} onChange={(e) => setLabel(e.target.value)} />
      </label>
      <fieldset>
        <legend>Capabilities</legend>
        {allowed.map((c) => (
          <label key={c} className="inline-label">
            <input type="checkbox" checked={capabilities.includes(c)} onChange={(e) => toggle(c, e.target.checked)} />
            {c}
          </label>
        ))}
      </fieldset>
      <label>
        Max reference images
        <input inputMode="numeric" value={maxRefs} onChange={(e) => setMaxRefs(e.target.value)} />
      </label>
      <label>
        Params (JSON)
        <textarea rows={3} value={params} onChange={(e) => setParams(e.target.value)} />
      </label>
      {error !== null && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <div className="modal-actions">
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" disabled={busy || modelId.trim() === '' || capabilities.length === 0}>
          Save model
        </button>
      </div>
    </form>
  )
}
