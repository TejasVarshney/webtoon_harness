import { useEffect, useState } from 'react'
import type { EndpointConfig, ModelConfig, Role } from '@shared/types'
import { useModelsStore } from '../../stores/models-store'
import { EndpointForm } from './EndpointForm'
import { ModelForm } from './ModelForm'
import { RoleAssignments } from './RoleAssignments'

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

type Editing = { endpoint: EndpointConfig; model?: ModelConfig }

export function ModelsTab() {
  const view = useModelsStore((s) => s.view)
  const [addingEndpoint, setAddingEndpoint] = useState(false)
  const [editing, setEditing] = useState<Editing | null>(null)
  const [keyFor, setKeyFor] = useState<string | null>(null)
  const [keyDraft, setKeyDraft] = useState('')
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [testResults, setTestResults] = useState<Record<string, { ok: boolean; message: string }>>({})
  const [testing, setTesting] = useState<string | null>(null)

  useEffect(() => {
    if (useModelsStore.getState().view === null) void useModelsStore.getState().load().catch((e: unknown) => setError(errorText(e)))
  }, [])

  if (view === null) return <p className="placeholder">Loading models...</p>

  function report(cleared: Role[]): void {
    setNotice(cleared.length > 0 ? `Unassigned roles: ${cleared.join(', ')}` : null)
  }

  function run(task: Promise<unknown>): void {
    setError(null)
    task.catch((e: unknown) => setError(errorText(e)))
  }

  async function runTest(modelId: string): Promise<void> {
    setTesting(modelId)
    try {
      const result = await useModelsStore.getState().testModel(modelId)
      setTestResults((prev) => ({ ...prev, [modelId]: result }))
    } catch (e) {
      setTestResults((prev) => ({ ...prev, [modelId]: { ok: false, message: errorText(e) } }))
    } finally {
      setTesting(null)
    }
  }

  async function saveKey(endpointId: string): Promise<void> {
    await useModelsStore.getState().setApiKey(endpointId, keyDraft.trim() === '' ? null : keyDraft.trim())
    setKeyFor(null)
    setKeyDraft('')
  }

  return (
    <div className="models-tab">
      {notice !== null && <p role="status" className="notice-info">{notice}</p>}
      {error !== null && (
        <p role="alert" className="error">
          {error}
        </p>
      )}

      <RoleAssignments />

      <section>
        <div className="section-header">
          <h3>Endpoints</h3>
          <button type="button" onClick={() => setAddingEndpoint(true)}>
            Add endpoint
          </button>
        </div>
        {addingEndpoint && (
          <EndpointForm
            onCancel={() => setAddingEndpoint(false)}
            onDone={(problem) => {
              setAddingEndpoint(false)
              if (problem !== undefined) setError(problem)
            }}
          />
        )}

        {view.endpoints.map((endpoint) => {
          const models = view.models.filter((m) => m.endpointId === endpoint.id)
          const isMock = endpoint.kind === 'mock'
          return (
            <div key={endpoint.id} className="endpoint" data-testid={`endpoint-${endpoint.id}`}>
              <div className="endpoint-header">
                <strong>{endpoint.name}</strong>
                <span className="endpoint-meta">
                  {endpoint.kind} · {endpoint.baseUrl}
                </span>
                {!isMock && <span className="endpoint-key">{endpoint.hasKey ? 'Key set' : 'No key'}</span>}
                {!isMock && (
                  <>
                    <button type="button" onClick={() => setKeyFor(endpoint.id)}>
                      {endpoint.hasKey ? 'Replace key' : 'Set key'}
                    </button>
                    {endpoint.hasKey && (
                      <button type="button" onClick={() => run(useModelsStore.getState().setApiKey(endpoint.id, null))}>
                        Clear key
                      </button>
                    )}
                    <button type="button" onClick={() => run(useModelsStore.getState().removeEndpoint(endpoint.id).then(report))}>
                      Remove endpoint
                    </button>
                  </>
                )}
              </div>
              {keyFor === endpoint.id && (
                <form
                  className="key-form"
                  onSubmit={(e) => {
                    e.preventDefault()
                    run(saveKey(endpoint.id))
                  }}
                >
                  <input type="password" autoComplete="off" aria-label={`API key for ${endpoint.name}`} value={keyDraft} onChange={(e) => setKeyDraft(e.target.value)} />
                  <button type="submit">Save key</button>
                  <button type="button" onClick={() => setKeyFor(null)}>
                    Cancel
                  </button>
                </form>
              )}

              <ul className="model-list">
                {models.map((m) => (
                  <li key={m.id} data-testid={`model-row-${m.id}`}>
                    <span className="model-label">{m.label}</span>
                    <code>{m.modelId}</code>
                    <span className="model-caps">{m.capabilities.join(', ')}</span>
                    <button type="button" disabled={testing === m.id} onClick={() => void runTest(m.id)}>
                      Test
                    </button>
                    <button type="button" onClick={() => setEditing({ endpoint, model: m })}>
                      Edit
                    </button>
                    <button type="button" onClick={() => run(useModelsStore.getState().removeModel(m.id).then(report))}>
                      Remove
                    </button>
                    {testResults[m.id] !== undefined && (
                      <span className={testResults[m.id].ok ? 'test-ok' : 'error'}>
                        {testResults[m.id].ok ? 'OK: ' : 'Failed: '}
                        {testResults[m.id].message}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
              <button type="button" onClick={() => setEditing({ endpoint })}>
                Add model
              </button>
              {editing?.endpoint.id === endpoint.id && (
                <ModelForm
                  key={editing.model?.id ?? 'new'}
                  endpoint={endpoint}
                  model={editing.model}
                  onCancel={() => setEditing(null)}
                  onDone={() => setEditing(null)}
                />
              )}
            </div>
          )
        })}
      </section>
    </div>
  )
}
