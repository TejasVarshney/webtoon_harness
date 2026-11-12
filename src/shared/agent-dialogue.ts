import { z } from 'zod'
import { DialogueDraftSchema } from './schemas'

/**
 * What the in-app agent may send for a bubble's placement or tail tip: panel fractions, which may sit off the panel
 * (outside 0..1) but not far. A pixel value such as 320 is a mistake, not a place, so it is refused; the renderer's own
 * saves go through IPC with the unbounded schemas, which have no such limit.
 */
const AgentPlacementSchema = z.object({ x: z.number().min(-10).max(10), y: z.number().min(-10).max(10) })

/** The dialogue of the agent's panel tools: like a stored draft, with placement and tail bounded to -10..10. */
export const AgentDialogueSchema = z.array(
  DialogueDraftSchema.extend({
    placement: AgentPlacementSchema.nullable().optional(),
    tail: z.union([z.enum(['none']), AgentPlacementSchema]).nullable().optional()
  })
)
