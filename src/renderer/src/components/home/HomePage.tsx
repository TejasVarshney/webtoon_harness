import { useState } from 'react'
import { Plus } from 'lucide-react'
import { useAppStore } from '../../stores/app-store'
import { BrandMark } from '../sessions/BrandMark'
import { NewProjectDialog } from '../sessions/NewProjectDialog'
import { ProjectProblems } from '../sessions/ProjectProblems'
import { relativeTime } from '../sessions/relative-time'

/** What the app shows until a project is opened: the user's projects, newest first, and a way to start another. */
export function HomePage() {
  const projects = useAppStore((s) => s.projects)
  const [showNewProject, setShowNewProject] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const sorted = [...projects].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))

  function open(id: string): void {
    useAppStore.getState().openProject(id).then(
      () => setError(null),
      (e: unknown) => setError(e instanceof Error ? e.message : String(e))
    )
  }

  return (
    <main className="home">
      <div className="home-brand">
        <BrandMark />
        <span className="brand-name">Webtoon AI Harness</span>
      </div>

      <div className="home-head">
        <h1>{projects.length === 0 ? 'Start your first project' : 'Your projects'}</h1>
        <button type="button" className="btn-primary" data-testid="new-project" onClick={() => setShowNewProject(true)}>
          <Plus size={16} aria-hidden="true" />
          New project
        </button>
      </div>

      {error !== null && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <ProjectProblems />

      {sorted.length > 0 && (
        <ul className="home-projects">
          {sorted.map((p) => (
            <li key={p.id}>
              <button type="button" className="project-card" data-testid="project-card" onClick={() => open(p.id)}>
                <span className="project-card-title">{p.title}</span>
                <span className="project-card-time">{relativeTime(p.updatedAt)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {showNewProject && (
        <NewProjectDialog
          onCancel={() => setShowNewProject(false)}
          onCreate={async (title, stylePreset) => {
            await useAppStore.getState().createProject(title, stylePreset)
            setShowNewProject(false)
          }}
        />
      )}
    </main>
  )
}
