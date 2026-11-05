import { useEffect, useMemo, useRef, useState } from 'react'
import type { ExportInspection, ExportPreset, ExportProgress, ExportRequest } from '@shared/types'
import { api } from '../../api'
import { useAppStore } from '../../stores/app-store'
import { usePanelsStore } from '../../stores/panels-store'
import { Field, errorText } from '../characters/controls'
import { visibleOptions } from './export-options'

const PRESETS: { id: ExportPreset; label: string }[] = [
  { id: 'webtoon', label: 'Webtoon upload (JPEG slices)' },
  { id: 'long-image', label: 'Long image' },
  { id: 'pdf-reading', label: 'PDF for reading' },
  { id: 'pdf-print', label: 'PDF for print' },
  { id: 'cbz', label: 'CBZ (comic readers)' }
]

export interface ExportDialogProps {
  onClose(): void
}

type InspectedEpisode = ExportInspection['episodes'][number]

function unfinishedText(e: InspectedEpisode): string {
  const panels = e.unfinished.map((u) => (u.reason === 'none' ? `${u.position}` : `${u.position} (${u.reason})`)).join(', ')
  return `Episode ${e.number}: panels ${panels} have no finished image and will be left out.`
}

function progressText(p: ExportProgress): string {
  const head = `Episode ${p.episodeIndex + 1} of ${p.episodeCount}`
  if (p.stage === 'capturing' && p.slice > 0) return `${head}, slice ${p.slice} of ${p.sliceCount}`
  if (p.stage === 'writing') return `${head}, writing`
  if (p.stage === 'rendering') return `${head}, rendering`
  return head
}

/** Exports ticked episodes. Progress for the job arrives as `export.progress` events. */
export function ExportDialog({ onClose }: ExportDialogProps) {
  const projectId = useAppStore((s) => s.projectId)
  const activeEpisodeId = useAppStore((s) => s.activeEpisodeId)
  const episodes = usePanelsStore((s) => s.episodes)

  const [ticked, setTicked] = useState<string[]>(() => (activeEpisodeId !== null ? [activeEpisodeId] : []))
  const [preset, setPreset] = useState<ExportPreset>('webtoon')
  const [imageType, setImageType] = useState<ExportRequest['imageType']>('jpeg')
  const [paper, setPaper] = useState<ExportRequest['paper']>('a4')
  const [resolution, setResolution] = useState<ExportRequest['resolution']>('standard')
  const [combine, setCombine] = useState(false)
  const [withoutLettering, setWithoutLettering] = useState(false)

  const [inspection, setInspection] = useState<ExportInspection | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [starting, setStarting] = useState(false)
  const [jobId, setJobId] = useState<string | null>(null)
  const [progress, setProgress] = useState<ExportProgress | null>(null)
  const [cancelling, setCancelling] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // R3: events can arrive before `export:start` resolves, so every one is recorded and the job's latest is applied
  // once its id is known.
  const latest = useRef(new Map<string, ExportProgress>())
  const jobRef = useRef<string | null>(null)

  useEffect(() => {
    return api.onEvent((event) => {
      if (event.type !== 'export.progress') return
      const p = event.progress
      latest.current.set(p.jobId, p)
      if (p.jobId === jobRef.current) setProgress(p)
    })
  }, [])

  const orderedTicked = useMemo(() => episodes.filter((e) => ticked.includes(e.id)).map((e) => e.id), [episodes, ticked])
  const tickedKey = orderedTicked.join(',')

  useEffect(() => {
    setInspection(null)
    setConfirming(false)
    if (projectId === null || orderedTicked.length === 0) return
    let stale = false
    api
      .invoke('export:inspect', { projectId, episodeIds: orderedTicked })
      .then((res) => {
        if (!stale) setInspection(res)
      })
      .catch((e: unknown) => {
        if (!stale) setError(errorText(e))
      })
    return () => {
      stale = true
    }
    // `orderedTicked` is derived from `tickedKey`.
  }, [projectId, tickedKey])

  const terminal = progress !== null && (progress.stage === 'done' || progress.stage === 'failed' || progress.stage === 'cancelled')
  const running = jobId !== null && !terminal
  const busy = starting || running

  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape' && !busy) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, busy])

  const options = visibleOptions(preset, orderedTicked.length)
  const withUnfinished = inspection?.episodes.filter((e) => e.unfinished.length > 0) ?? []
  const nothingFinished = inspection !== null && inspection.episodes.every((e) => e.finishedCount === 0)
  const canStart = inspection !== null && orderedTicked.length > 0 && !nothingFinished

  function toggle(id: string): void {
    setTicked((t) => (t.includes(id) ? t.filter((x) => x !== id) : [...t, id]))
  }

  async function send(): Promise<void> {
    if (projectId === null) return
    const request: ExportRequest = {
      projectId,
      episodeIds: orderedTicked,
      preset,
      imageType,
      paper,
      resolution,
      combine: options.combine && combine,
      lettering: !withoutLettering
    }
    setError(null)
    setConfirming(false)
    setStarting(true)
    latest.current.clear()
    try {
      const res = await api.invoke('export:start', request)
      if ('cancelled' in res) return
      jobRef.current = res.jobId
      setJobId(res.jobId)
      setCancelling(false)
      setProgress(latest.current.get(res.jobId) ?? null)
    } catch (e) {
      setError(errorText(e))
    } finally {
      setStarting(false)
    }
  }

  function onStart(): void {
    if (withUnfinished.length > 0 && !confirming) setConfirming(true)
    else void send()
  }

  async function cancel(): Promise<void> {
    if (jobId === null) return
    setCancelling(true)
    try {
      await api.invoke('export:cancel', { jobId })
    } catch (e) {
      setError(errorText(e))
      setCancelling(false)
    }
  }

  async function reveal(): Promise<void> {
    if (jobId === null) return
    try {
      await api.invoke('export:reveal', { jobId })
    } catch (e) {
      setError(errorText(e))
    }
  }

  function backToForm(): void {
    jobRef.current = null
    setJobId(null)
    setProgress(null)
    setCancelling(false)
    setError(null)
  }

  const showForm = jobId === null
  const failed = progress?.stage === 'failed'
  const canReveal = progress !== null && (progress.stage === 'done' || (failed && progress.outputs.length > 0))

  return (
    <div className="modal-backdrop">
      <div className="modal export-dialog" role="dialog" aria-label="Export episodes" data-testid="export-dialog">
        <div className="section-header">
          <h2>Export episodes</h2>
        </div>

        {showForm ? (
          <>
            <fieldset className="export-episodes" disabled={busy}>
              <legend>Episodes</legend>
              {episodes.map((e) => (
                <label key={e.id} className="export-episode">
                  <input type="checkbox" data-testid={`export-episode-${e.id}`} checked={ticked.includes(e.id)} onChange={() => toggle(e.id)} />
                  {e.title}
                </label>
              ))}
            </fieldset>
            <Field label="Format">
              {(id) => (
                <select id={id} data-testid="export-preset" value={preset} disabled={busy} onChange={(e) => setPreset(e.target.value as ExportPreset)}>
                  {PRESETS.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                    </option>
                  ))}
                </select>
              )}
            </Field>
            {options.imageType && (
              <Field label="Image type">
                {(id) => (
                  <select id={id} value={imageType} disabled={busy} onChange={(e) => setImageType(e.target.value as ExportRequest['imageType'])}>
                    <option value="jpeg">JPEG</option>
                    <option value="png">PNG</option>
                  </select>
                )}
              </Field>
            )}
            {options.paper && (
              <Field label="Paper">
                {(id) => (
                  <select id={id} value={paper} disabled={busy} onChange={(e) => setPaper(e.target.value as ExportRequest['paper'])}>
                    <option value="a4">A4</option>
                    <option value="letter">Letter</option>
                  </select>
                )}
              </Field>
            )}
            {options.resolution && (
              <Field label="Resolution">
                {(id) => (
                  <select id={id} value={resolution} disabled={busy} onChange={(e) => setResolution(e.target.value as ExportRequest['resolution'])}>
                    <option value="standard">Standard</option>
                    <option value="high">High</option>
                  </select>
                )}
              </Field>
            )}
            {options.combine && (
              <label className="export-check">
                <input type="checkbox" checked={combine} disabled={busy} onChange={(e) => setCombine(e.target.checked)} />
                Combine into one file
              </label>
            )}
            <label className="export-check">
              <input type="checkbox" checked={withoutLettering} disabled={busy} onChange={(e) => setWithoutLettering(e.target.checked)} />
              Without lettering
            </label>

            {withUnfinished.length > 0 && (
              <div className="export-warning" role="status">
                {withUnfinished.map((e) => (
                  <p key={e.episodeId}>{unfinishedText(e)}</p>
                ))}
              </div>
            )}
            {nothingFinished && <p className="muted">No ticked episode has a finished panel.</p>}
            {error !== null && (
              <p role="alert" className="error">
                {error}
              </p>
            )}
            <div className="modal-actions">
              <button type="button" onClick={onClose} disabled={busy}>
                Close
              </button>
              {confirming ? (
                <button type="button" data-testid="export-anyway" onClick={() => void send()} disabled={busy}>
                  Export anyway
                </button>
              ) : (
                <button type="button" data-testid="export-start" onClick={onStart} disabled={!canStart || busy}>
                  Export
                </button>
              )}
            </div>
          </>
        ) : (
          <>
            {progress === null && (
              <p data-testid="export-progress" className="muted">
                Starting…
              </p>
            )}
            {progress !== null && !terminal && (
              <p data-testid="export-progress" className="muted">
                {progressText(progress)}
              </p>
            )}
            {progress?.stage === 'done' && <p>Exported.</p>}
            {progress?.stage === 'cancelled' && <p>Export cancelled.</p>}
            {failed && (
              <p role="alert" className="error">
                {progress.message ?? 'The export failed.'}
              </p>
            )}
            {!failed && error !== null && (
              <p role="alert" className="error">
                {error}
              </p>
            )}
            <div className="modal-actions">
              {running && (
                <button type="button" data-testid="export-cancel" onClick={() => void cancel()} disabled={cancelling}>
                  {cancelling ? 'Cancelling…' : 'Cancel'}
                </button>
              )}
              {canReveal && (
                <button type="button" data-testid="export-reveal" onClick={() => void reveal()}>
                  Show in folder
                </button>
              )}
              {terminal && (
                <>
                  {progress.stage !== 'done' && (
                    <button type="button" onClick={backToForm}>
                      Back
                    </button>
                  )}
                  <button type="button" onClick={onClose}>
                    Close
                  </button>
                </>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
