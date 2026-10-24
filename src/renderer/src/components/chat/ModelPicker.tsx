import { useState } from 'react'
import { useModelsStore } from '../../stores/models-store'

/** Chooses the `agent` role's model among the text-capable ones. */
export function ModelPicker() {
  const view = useModelsStore((s) => s.view)
  const assignRole = useModelsStore((s) => s.assignRole)
  const [error, setError] = useState<string | null>(null)
  if (view === null) return null

  const textModels = view.models.filter((m) => m.capabilities.includes('text'))
  const endpointName = (id: string): string => view.endpoints.find((e) => e.id === id)?.name ?? ''

  return (
    <span className="model-picker">
      <select
        data-testid="model-picker"
        aria-label="Agent model"
        value={view.effectiveRoles.agent ?? ''}
        onChange={(e) => {
          setError(null)
          assignRole('agent', e.target.value === '' ? null : e.target.value).catch((err: unknown) =>
            setError(err instanceof Error ? err.message : String(err))
          )
        }}
      >
        {view.effectiveRoles.agent === null && <option value="">No model</option>}
        {textModels.map((m) => (
          <option key={m.id} value={m.id}>
            {m.label} ({endpointName(m.endpointId)})
          </option>
        ))}
      </select>
      {error !== null && (
        <span role="alert" className="error">
          {error}
        </span>
      )}
    </span>
  )
}
