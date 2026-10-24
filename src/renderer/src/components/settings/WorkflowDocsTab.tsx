import { useCallback, useEffect, useState } from 'react'
import type { WorkflowDocEntry } from '@shared/ipc'
import { api } from '../../api'
import { useAppStore } from '../../stores/app-store'

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

/** The open project's workflow docs: open one in the system editor, or reset them all to the shipped defaults. */
export function WorkflowDocsTab() {
  const projectId = useAppStore((s) => s.projectId)
  const [docs, setDocs] = useState<WorkflowDocEntry[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [resetting, setResetting] = useState(false)

  /** Loads the list of project `id`; `live()` false means the tab moved on to another project, so the answer is dropped. */
  const load = useCallback(async (id: string, live: () => boolean = () => true): Promise<void> => {
    try {
      const listed = await api.invoke('docs:list', { projectId: id })
      if (live()) setDocs(listed)
    } catch (e) {
      if (live()) setError(errorText(e))
    }
  }, [])

  useEffect(() => {
    let live = true
    setDocs(null)
    setError(null)
    setNotice(null)
    setConfirming(false)
    if (projectId !== null) void load(projectId, () => live)
    return () => {
      live = false
    }
  }, [projectId, load])

  if (projectId === null) return <p className="placeholder">Open a project to see its workflow docs.</p>

  async function open(id: string, name: string): Promise<void> {
    setError(null)
    setNotice(null)
    try {
      await api.invoke('docs:open', { projectId: id, name })
    } catch (e) {
      setError(errorText(e))
    }
  }

  async function reset(id: string): Promise<void> {
    setConfirming(false)
    setResetting(true)
    setError(null)
    setNotice(null)
    try {
      await api.invoke('docs:reset', { projectId: id })
      setNotice('Workflow docs reset to the defaults.')
      await load(id)
    } catch (e) {
      setError(errorText(e))
    } finally {
      setResetting(false)
    }
  }

  return (
    <div className="workflow-docs-tab">
      <p className="hint">
        These markdown files tell the agent how to work. This project has its own copy in its <code>agent/</code> folder: edit them in your editor and
        the agent follows your version from its next message.
      </p>
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
      {docs === null ? (
        error === null && <p className="placeholder">Loading docs...</p>
      ) : (
        <ul className="doc-list">
          {docs.map((doc) => (
            <li key={doc.name}>
              <span className="doc-title">{doc.title}</span>
              <code>{`agent/${doc.name}.md`}</code>
              <button type="button" onClick={() => void open(projectId, doc.name)}>
                Open
              </button>
            </li>
          ))}
        </ul>
      )}
      {confirming ? (
        <div role="alertdialog" aria-label="Reset workflow docs" className="confirm-box">
          <p>Reset every workflow doc of this project to the shipped default? Your edits to these files are overwritten.</p>
          <span className="confirm-actions">
            <button type="button" onClick={() => void reset(projectId)}>
              Reset all
            </button>
            <button type="button" onClick={() => setConfirming(false)}>
              Cancel
            </button>
          </span>
        </div>
      ) : (
        <button type="button" disabled={resetting} onClick={() => setConfirming(true)}>
          Reset all to defaults
        </button>
      )}
    </div>
  )
}
