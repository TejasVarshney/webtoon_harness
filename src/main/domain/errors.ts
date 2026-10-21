// Errors shared by the storage layer and the services built on it. Each sets `name` so it
// survives logging and serialization, and keeps its structured fields for callers to branch on.

/** A looked-up entity does not exist. The wording is relied on by tool results and tests. */
export class EntityNotFoundError extends Error {
  readonly kind: string
  readonly id: string

  constructor(kind: string, id: string) {
    super(`Unknown ${kind}: ${id}`)
    this.name = 'EntityNotFoundError'
    this.kind = kind
    this.id = id
  }
}

/** A project file exists but is not valid JSON, or does not match its schema. */
export class CorruptFileError extends Error {
  readonly path: string

  constructor(path: string, detail?: string) {
    super(detail ? `Corrupt file ${path}: ${detail}` : `Corrupt file ${path}`)
    this.name = 'CorruptFileError'
    this.path = path
  }
}

/** A path or id would resolve outside the project root, or is not a well-formed id. */
export class PathEscapeError extends Error {
  readonly attempted: string

  constructor(attempted: string, detail?: string) {
    super(detail ? `${detail}: ${attempted}` : `Path escapes the project root: ${attempted}`)
    this.name = 'PathEscapeError'
    this.attempted = attempted
  }
}
