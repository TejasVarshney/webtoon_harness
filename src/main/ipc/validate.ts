import { z } from 'zod'

/** An entity id as `ProjectPaths` accepts it: `<prefix>_<alphanumerics>`. */
export const IdSchema = z.string().regex(/^[a-z]+_[A-Za-z0-9]+$/, 'not an id')

/** `Invalid input: <path>: <problem>; ...` on one line. */
export function describeZodError(error: z.ZodError): string {
  const issues = error.issues.map((i) => (i.path.length > 0 ? `${i.path.map(String).join('.')}: ${i.message}` : i.message))
  return `Invalid input: ${issues.join('; ')}`
}

/**
 * Parses a request at the main-process boundary (spec §4). A bad request rejects with a plain `Error` whose
 * message the renderer can show as it is.
 */
export function parseInput<S extends z.ZodType>(schema: S, value: unknown): z.output<S> {
  const result = schema.safeParse(value)
  if (!result.success) throw new Error(describeZodError(result.error))
  return result.data
}

/** A `ZodError` thrown anywhere in a handler becomes a plain `Error` with a short message; anything else is unchanged. */
export function readableError(error: unknown): unknown {
  return error instanceof z.ZodError ? new Error(describeZodError(error)) : error
}
