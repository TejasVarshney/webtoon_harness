import { useEffect, useState, type KeyboardEvent } from 'react'
import { ChevronsUpDown, Plus, Settings, SquarePen } from 'lucide-react'
import type { SessionSummary } from '@shared/types'
import { useAppStore } from '../../stores/app-store'
import { SettingsDialog } from '../settings/SettingsDialog'
import { BrandMark } from './BrandMark'
import { NewProjectDialog } from './NewProjectDialog'
import { ProjectProblems } from './ProjectProblems'

function relativeTime(iso: string, now = Date.now()): string {
  const seconds = Math.max(0, Math.round((now - Date.parse(iso)) / 1000))
  if (Number.isNaN(seconds)) return ''
  if (seconds < 60) return 'just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

interface MenuState {
  session: SessionSummary
  x: number
  y: number
}

export function SessionSidebar() {
  const projects = useAppStore((s) => s.projects)
  const projectId = useAppStore((s) => s.projectId)
  const sessions = useAppStore((s) => s.sessions)
  const sessionId = useAppStore((s) => s.sessionId)
  const runningThreads = useAppStore((s) => s.runningThreads)
  const { openProject, createProject, newSession, selectSession, renameSession, deleteSession } = useAppStore.getState()

  const [showNewProject, setShowNewProject] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [menu, setMenu] = useState<MenuState | null>(null)
  const [confirming, setConfirming] = useState<SessionSummary | null>(null)
  const [error, setError] = useState<string | null>(null)

  function run(task: Promise<unknown>): void {
    task.then(
      () => setError(null),
      (e: unknown) => setError(e instanceof Error ? e.message : String(e))
    )
  }

  useEffect(() => {
    function onKey(e: globalThis.KeyboardEvent): void {
      if (e.ctrlKey && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'n') {
        e.preventDefault()
        if (useAppStore.getState().projectId !== null) run(useAppStore.getState().newSession())
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    if (!menu) return
    const close = (): void => setMenu(null)
    window.addEventListener('click', close)
    return () => window.removeEventListener('click', close)
  }, [menu])

  function startRename(s: SessionSummary): void {
    setMenu(null)
    setDraft(s.title)
    setRenamingId(s.id)
  }

  function commitRename(s: SessionSummary): void {
    const title = draft.trim()
    setRenamingId(null)
    if (title !== '' && title !== s.title) run(renameSession(s.id, title))
  }

  function onRenameKey(e: KeyboardEvent<HTMLInputElement>, s: SessionSummary): void {
    if (e.key === 'Enter') commitRename(s)
    else if (e.key === 'Escape') setRenamingId(null)
  }

  return (
    <div className="session-sidebar">
      <div className="brand">
        <BrandMark />
        <span className="brand-name">Webtoon AI Harness</span>
      </div>

      <div className="sidebar-header">
        {projects.length > 0 && (
          <div className="project-switcher">
            <select
              data-testid="project-select"
              aria-label="Project"
              value={projectId ?? ''}
              onChange={(e) => e.target.value !== '' && run(openProject(e.target.value))}
            >
              {projectId === null && <option value="">No project</option>}
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.title}
                </option>
              ))}
            </select>
            <ChevronsUpDown size={14} className="project-switcher-icon" aria-hidden="true" />
          </div>
        )}
        {/* Before the first project this is the only way in, so it says what it does in words. */}
        <button
          type="button"
          className={projects.length === 0 ? 'btn-primary new-project-first' : 'icon-button'}
          data-testid="new-project"
          aria-label="New project"
          title="New project"
          onClick={() => setShowNewProject(true)}
        >
          <Plus size={16} aria-hidden="true" />
          {projects.length === 0 && 'New project'}
        </button>
      </div>

      <button type="button" className="new-session" data-testid="new-session" disabled={projectId === null} onClick={() => run(newSession())}>
        <SquarePen size={16} aria-hidden="true" />
        <span>New session</span>
        <kbd>Ctrl N</kbd>
      </button>

      {error !== null && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {projectId === null && <p className="placeholder sidebar-note">Create a project to start.</p>}
      <ProjectProblems />

      {sessions.length > 0 && <h2 className="sidebar-group">Sessions</h2>}
      <ul className="session-list">
        {sessions.map((s) => (
          <li
            key={s.id}
            data-testid="session-item"
            data-running={runningThreads[s.id] !== undefined ? 'true' : undefined}
            data-selected={s.id === sessionId ? 'true' : undefined}
            className="session-item"
            onClick={() => selectSession(s.id)}
            onDoubleClick={() => startRename(s)}
            onContextMenu={(e) => {
              e.preventDefault()
              setMenu({ session: s, x: e.clientX, y: e.clientY })
            }}
          >
            {renamingId === s.id ? (
              <input
                autoFocus
                aria-label="Session title"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => onRenameKey(e, s)}
                onBlur={() => commitRename(s)}
                onClick={(e) => e.stopPropagation()}
                onDoubleClick={(e) => e.stopPropagation()}
              />
            ) : (
              <span className="session-title">{s.title}</span>
            )}
            {runningThreads[s.id] !== undefined ? (
              <span className="running-dot" aria-label="Running" />
            ) : (
              <span className="session-time">{relativeTime(s.updatedAt)}</span>
            )}
          </li>
        ))}
      </ul>

      <button type="button" data-testid="settings-open" className="settings-open" onClick={() => setShowSettings(true)}>
        <Settings size={16} aria-hidden="true" />
        Settings
      </button>

      {menu && (
        <div className="context-menu" role="menu" style={{ left: menu.x, top: menu.y }}>
          <button type="button" role="menuitem" onClick={() => startRename(menu.session)}>
            Rename
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setConfirming(menu.session)
              setMenu(null)
            }}
          >
            Delete
          </button>
        </div>
      )}

      {confirming && (
        <div className="modal-backdrop">
          <div className="modal" role="dialog" aria-label="Delete session">
            <p>Delete &ldquo;{confirming.title}&rdquo;? It moves to the trash.</p>
            <div className="modal-actions">
              <button type="button" onClick={() => setConfirming(null)}>
                Cancel
              </button>
              <button
                type="button"
                className="btn-danger"
                onClick={() => {
                  const target = confirming
                  setConfirming(null)
                  run(deleteSession(target.id))
                }}
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {showSettings && <SettingsDialog onClose={() => setShowSettings(false)} />}

      {showNewProject && (
        <NewProjectDialog
          onCancel={() => setShowNewProject(false)}
          onCreate={async (title) => {
            await createProject(title)
            setShowNewProject(false)
          }}
        />
      )}
    </div>
  )
}
