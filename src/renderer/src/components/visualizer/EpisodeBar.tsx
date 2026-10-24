import { useState, type FormEvent } from 'react'
import { useAppStore } from '../../stores/app-store'
import { usePanelsStore } from '../../stores/panels-store'
import { Field, errorText } from '../characters/controls'

/** Picks which episode the strip shows, and starts a new one. */
export function EpisodeBar() {
  const episodes = usePanelsStore((s) => s.episodes)
  const activeEpisodeId = useAppStore((s) => s.activeEpisodeId)
  const [creating, setCreating] = useState(false)
  const [title, setTitle] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function startCreating(): void {
    const next = episodes.reduce((max, e) => Math.max(max, e.number), 0) + 1
    setTitle(`Episode ${next}`)
    setError(null)
    setCreating(true)
  }

  async function submit(e: FormEvent): Promise<void> {
    e.preventDefault()
    if (busy || title.trim() === '') return
    setBusy(true)
    setError(null)
    try {
      await usePanelsStore.getState().createEpisode(title.trim())
      setCreating(false)
    } catch (err) {
      setError(errorText(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="episode-bar">
      <Field label="Episode">
        {(id) => (
          <select id={id} value={activeEpisodeId ?? ''} disabled={episodes.length === 0} onChange={(e) => usePanelsStore.getState().selectEpisode(e.target.value)}>
            {episodes.map((e) => (
              <option key={e.id} value={e.id}>
                {e.title}
              </option>
            ))}
          </select>
        )}
      </Field>
      {creating ? (
        <form className="episode-form" onSubmit={(e) => void submit(e)}>
          <Field label="Episode title">{(id) => <input id={id} autoFocus value={title} onChange={(e) => setTitle(e.target.value)} />}</Field>
          <button type="submit" disabled={busy || title.trim() === ''}>
            Create episode
          </button>
          <button type="button" onClick={() => setCreating(false)}>
            Cancel
          </button>
        </form>
      ) : (
        <button type="button" onClick={startCreating}>
          New episode
        </button>
      )}
      {error !== null && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
    </div>
  )
}
