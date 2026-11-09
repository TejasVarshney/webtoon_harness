import { useEffect, useRef, useState } from 'react'
import { Check, Home, Plus, Settings } from 'lucide-react'
import { useAppStore } from '../../stores/app-store'
import { SettingsDialog } from '../settings/SettingsDialog'
import { NewProjectDialog } from '../sessions/NewProjectDialog'

/** The top bar's way between projects, and into Settings. Projects are switched here rather than in a sidebar. */
export function FileMenu() {
  const projects = useAppStore((s) => s.projects)
  const projectId = useAppStore((s) => s.projectId)
  const [open, setOpen] = useState(false)
  const [showNewProject, setShowNewProject] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const root = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if (e.ctrlKey && e.shiftKey && !e.altKey && e.key.toLowerCase() === 'n') {
        e.preventDefault()
        setShowNewProject(true)
      } else if (e.key === 'Escape') {
        setOpen(false)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    if (!open) return
    function onPointerDown(e: PointerEvent): void {
      if (root.current !== null && !root.current.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('pointerdown', onPointerDown)
    return () => window.removeEventListener('pointerdown', onPointerDown)
  }, [open])

  function openProject(id: string): void {
    setOpen(false)
    if (id === projectId) return
    useAppStore.getState().openProject(id).then(
      () => setError(null),
      (e: unknown) => setError(e instanceof Error ? e.message : String(e))
    )
  }

  function goHome(): void {
    setOpen(false)
    useAppStore.getState().closeProject()
    // The home page lists what is on disk now, so a project made or changed this session shows its current data.
    useAppStore.getState().loadProjects().catch((e: unknown) => console.error('Failed to reload projects', e))
  }

  return (
    <div className="file-menu" ref={root}>
      <button
        type="button"
        className="file-menu-button"
        data-testid="file-menu"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        File
      </button>
      {open && (
        <div className="file-menu-popup" role="menu" aria-label="File">
          <button type="button" role="menuitem" data-testid="file-menu-home" onClick={goHome}>
            <Home size={15} aria-hidden="true" />
            <span>Home</span>
          </button>
          <div className="file-menu-rule" role="separator" />
          {projects.map((p) => (
            <button
              key={p.id}
              type="button"
              role="menuitem"
              data-testid="file-menu-project"
              aria-current={p.id === projectId ? 'true' : undefined}
              onClick={() => openProject(p.id)}
            >
              <span className="file-menu-check">{p.id === projectId && <Check size={14} aria-hidden="true" />}</span>
              <span>{p.title}</span>
            </button>
          ))}
          <div className="file-menu-rule" role="separator" />
          <button
            type="button"
            role="menuitem"
            data-testid="new-project"
            onClick={() => {
              setOpen(false)
              setShowNewProject(true)
            }}
          >
            <Plus size={15} aria-hidden="true" />
            <span>New project</span>
            <kbd>Ctrl Shift N</kbd>
          </button>
          <button
            type="button"
            role="menuitem"
            data-testid="settings-open"
            onClick={() => {
              setOpen(false)
              setShowSettings(true)
            }}
          >
            <Settings size={15} aria-hidden="true" />
            <span>Settings</span>
          </button>
        </div>
      )}
      {error !== null && (
        <p role="alert" className="error file-menu-error">
          {error}
        </p>
      )}

      {showSettings && <SettingsDialog onClose={() => setShowSettings(false)} />}
      {showNewProject && (
        <NewProjectDialog
          onCancel={() => setShowNewProject(false)}
          onCreate={async (title, stylePreset) => {
            await useAppStore.getState().createProject(title, stylePreset)
            setShowNewProject(false)
          }}
        />
      )}
    </div>
  )
}
