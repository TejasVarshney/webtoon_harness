import { z } from 'zod'
import { Id } from './schema-primitives'

// What the user can choose for how one panel is drawn, beyond what it shows: panels whose pictures are sent as
// references, a style of its own, and a prompt of its own. Their own file because `schemas.ts` is at the size limit.

/** The stored fields of a panel. A file from before they existed reads as no choice. */
export const PanelDrawChoices = {
  /** Panels (of any episode) whose current pictures go to the image model as references, after the sketch. */
  referencePanelIds: z.array(Id).default([]),
  /** Replaces the project's style in this panel's [STYLE] line; null: the project's. */
  styleOverride: z.string().nullable().default(null),
  /** Sent to the image model as the whole prompt instead of the composed one; null: the app composes it. */
  promptOverride: z.string().nullable().default(null)
}

/** For `.omit` on a draft or patch schema: the agent's tools take none of these, the user's editor sets them. */
export const PanelDrawChoiceKeys = { referencePanelIds: true, styleOverride: true, promptOverride: true } as const

/** The same fields in a draft or patch, with no defaults (left out keeps the stored value; null clears a text). */
export const PanelDrawChoicesInput = {
  referencePanelIds: z.array(Id).optional(),
  styleOverride: z.string().nullable().optional(),
  promptOverride: z.string().nullable().optional()
}
