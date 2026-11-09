import { useEffect, useState } from 'react'
import type { StyleEntry } from '@shared/ipc'
import { api } from '../../api'
import { useAppStore } from '../../stores/app-store'
import { StyleDialog } from './StyleDialog'
import { styleNameFor } from './style-name'

/** The top bar's view of the project's art style, and the way into the style picker. */
export function StyleButton() {
  const project = useAppStore((s) => s.projects.find((p) => p.id === s.projectId))
  const projectId = project?.id
  const stylePreset = project?.stylePreset
  const [styles, setStyles] = useState<StyleEntry[]>([])
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (projectId === undefined || open) return
    let current = true
    api
      .invoke('styles:list', {})
      .then((result) => {
        if (current) setStyles(result.styles)
      })
      // Only the name on this button depends on it; the picker reports a failure when it opens.
      .catch(() => {
        if (current) setStyles([])
      })
    return () => {
      current = false
    }
  }, [projectId, stylePreset, open])

  if (projectId === undefined || stylePreset === undefined) return null

  return (
    <>
      <button type="button" className="style-button" data-testid="style-button" title={stylePreset} onClick={() => setOpen(true)}>
        Style: {styleNameFor(styles, stylePreset)}
      </button>
      {open && <StyleDialog projectId={projectId} stylePreset={stylePreset} onClose={() => setOpen(false)} />}
    </>
  )
}
