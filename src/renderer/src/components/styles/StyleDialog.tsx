import { useCallback, useEffect, useState } from 'react'
import type { StyleEntry, StyleUsage } from '@shared/ipc'
import { api } from '../../api'
import { useAppStore } from '../../stores/app-store'
import { StyleForm } from './StyleForm'

export interface StyleDialogProps {
  projectId: string
  stylePreset: string
  onClose(): void
}

const count = (n: number, noun: string): string => `${n} ${noun}${n === 1 ? '' : 's'}`
const message = (error: unknown): string => (error instanceof Error ? error.message : String(error))

type Editing = { kind: 'new' } | { kind: 'edit'; style: StyleEntry }

/** Choose the project's style, and manage the library it comes from. The list is read each time this opens, so styles the agent added appear. */
export function StyleDialog({ projectId, stylePreset, onClose }: StyleDialogProps) {
  const applyStyle = useAppStore((s) => s.applyStyle)
  const [styles, setStyles] = useState<StyleEntry[]>([])
  const [loadError, setLoadError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState<Editing | null>(null)
  const [warning, setWarning] = useState<{ style: StyleEntry; usage: StyleUsage } | null>(null)
  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null)

  const reload = useCallback(async () => {
    const result = await api.invoke('styles:list', {})
    setStyles(result.styles)
    setLoadError(result.loadError)
  }, [])

  useEffect(() => {
    reload().catch((e: unknown) => setError(message(e)))
  }, [reload])

  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  /** Runs a change to the library, shows what it refuses, and reads the list again. */
  async function change(work: () => Promise<unknown>): Promise<void> {
    setError(null)
    setConfirmingDelete(null)
    try {
      await work()
      await reload()
    } catch (e) {
      setError(message(e))
    }
  }

  async function switchTo(style: StyleEntry): Promise<void> {
    setError(null)
    try {
      await applyStyle(style.id)
      onClose()
    } catch (e) {
      setWarning(null)
      setError(message(e))
    }
  }

  async function choose(style: StyleEntry): Promise<void> {
    setError(null)
    try {
      const usage = await api.invoke('styles:usage', { projectId })
      if (usage.sheets + usage.panels > 0) setWarning({ style, usage })
      else await switchTo(style)
    } catch (e) {
      setError(message(e))
    }
  }

  async function save(input: { name: string; text: string }): Promise<void> {
    if (editing?.kind === 'edit') await api.invoke('styles:update', { id: editing.style.id, patch: input })
    else await api.invoke('styles:create', input)
    setEditing(null)
    await reload()
  }

  return (
    <div className="modal-backdrop">
      <div className="modal style-dialog" role="dialog" aria-label="Art style">
        <div className="section-header">
          <h2>Art style</h2>
          <button type="button" onClick={onClose}>
            Close
          </button>
        </div>
        {loadError !== null && (
          <p role="alert" className="error">
            {loadError}
          </p>
        )}
        {error !== null && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        {warning !== null ? (
          <>
            <p>
              {count(warning.usage.sheets, 'sheet')} and {count(warning.usage.panels, 'panel')} were drawn in the current style. New images will use the new style, and references drawn in the old one may not match. Nothing is redrawn automatically.
            </p>
            <div className="modal-actions">
              <button type="button" onClick={() => setWarning(null)}>
                Cancel
              </button>
              <button type="button" onClick={() => void switchTo(warning.style)}>
                Switch style
              </button>
            </div>
          </>
        ) : editing !== null ? (
          <StyleForm initial={editing.kind === 'edit' ? editing.style : undefined} onSave={save} onCancel={() => setEditing(null)} />
        ) : (
          <>
            <ul className="style-list">
              {styles.map((style) => {
                const current = style.text === stylePreset
                return (
                  <li key={style.id} className="style-row" data-testid="style-row" data-current={current}>
                    <div className="style-row-words">
                      <strong>{style.name}</strong>
                      <span className="style-row-text">{style.text}</span>
                    </div>
                    <div className="style-row-actions">
                      {current ? (
                        <span className="style-row-current">Current</span>
                      ) : (
                        <button type="button" onClick={() => void choose(style)}>
                          Use
                        </button>
                      )}
                      <button type="button" onClick={() => setEditing({ kind: 'edit', style })}>
                        Edit
                      </button>
                      {style.edited && (
                        <button type="button" onClick={() => void change(() => api.invoke('styles:reset', { id: style.id }))}>
                          Reset to default
                        </button>
                      )}
                      {!style.builtin &&
                        (confirmingDelete === style.id ? (
                          <button type="button" onClick={() => void change(() => api.invoke('styles:delete', { id: style.id }))}>
                            Confirm delete
                          </button>
                        ) : (
                          <button type="button" onClick={() => setConfirmingDelete(style.id)}>
                            Delete
                          </button>
                        ))}
                    </div>
                  </li>
                )
              })}
            </ul>
            <div className="modal-actions">
              <button type="button" onClick={() => setEditing({ kind: 'new' })}>
                Add style
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
