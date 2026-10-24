import { useAppStore } from '../../stores/app-store'

/**
 * The open project's problems (spec §12): files that could not be read, such as a hand-edited JSON file that is no
 * longer valid. The project still works without them; each entry names the file and what is wrong, so the user can
 * repair it. Hidden while there is none.
 */
export function ProjectProblems() {
  const problems = useAppStore((s) => s.problems)
  if (problems.length === 0) return null
  const count = problems.length
  return (
    <details className="project-problems" data-testid="project-problems" role="status">
      <summary>{`${count} ${count === 1 ? 'file' : 'files'} could not be read`}</summary>
      <ul>
        {problems.map((p) => (
          <li key={p.path}>
            <code>{p.path}</code>
            <span>{p.message}</span>
          </li>
        ))}
      </ul>
    </details>
  )
}
