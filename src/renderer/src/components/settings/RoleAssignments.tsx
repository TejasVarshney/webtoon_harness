import { useState } from 'react'
import type { Capability, Role } from '@shared/types'
import { useModelsStore } from '../../stores/models-store'

interface RoleInfo {
  role: Role
  label: string
  needs: Capability
  /** The role used when this one is unassigned. */
  fallback?: Role
}

const ROLES: RoleInfo[] = [
  { role: 'agent', label: 'Agent (main chat)', needs: 'text' },
  { role: 'panelChat', label: 'Panel chat', needs: 'text', fallback: 'agent' },
  { role: 'vision', label: 'Consistency check (optional)', needs: 'vision' },
  { role: 'image', label: 'Image generation', needs: 'image-gen' },
  { role: 'imageEdit', label: 'Image editing', needs: 'image-edit', fallback: 'image' }
]

export function RoleAssignments() {
  const view = useModelsStore((s) => s.view)
  const assignRole = useModelsStore((s) => s.assignRole)
  const [error, setError] = useState<string | null>(null)
  if (view === null) return null
  const endpointName = (id: string): string => view.endpoints.find((e) => e.id === id)?.name ?? ''

  return (
    <section className="role-assignments">
      <h3>Roles</h3>
      {ROLES.map(({ role, label, needs, fallback }) => (
        <label key={role} className="role-row">
          <span>{label}</span>
          <select
            aria-label={`${role} role`}
            value={view.roles[role] ?? ''}
            onChange={(e) => {
              setError(null)
              assignRole(role, e.target.value === '' ? null : e.target.value).catch((err: unknown) =>
                setError(err instanceof Error ? err.message : String(err))
              )
            }}
          >
            <option value="">{fallback ? `Same as ${fallback}` : 'None'}</option>
            {view.models
              .filter((m) => m.capabilities.includes(needs))
              .map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label} ({endpointName(m.endpointId)})
                </option>
              ))}
          </select>
        </label>
      ))}
      {error !== null && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
    </section>
  )
}
