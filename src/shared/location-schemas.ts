// Locations: saved places with a fixed layout and states, the third twin of characters and items. `schemas.ts`
// re-exports everything here, so callers import from '@shared/schemas' as for every other record.

import { z } from 'zod'
import { CheckResultSchema, CreatedBySchema, Id, ImageStatusSchema, IsoTimestamp, text } from './schema-primitives'

const LocationStateKindSchema = z.enum(['base', 'state'])

/**
 * One look of a location ("Night, embers only", "Back door open to a blizzard"). The base state is the empty place
 * seen from its main camera angle; another state's picture is drawn from the base one, and a state with no ready
 * picture of its own is drawn from the base picture and its words.
 */
export const LocationStateSchema = z.object({
  id: Id,
  locationId: Id,
  name: z.string(),
  kind: LocationStateKindSchema,
  delta: text(),
  imagePath: z.string().nullable().default(null),
  status: ImageStatusSchema,
  error: z.string().nullable().default(null),
  check: CheckResultSchema.nullable().default(null),
  createdBy: CreatedBySchema,
  createdAt: IsoTimestamp
})

export const LocationSchema = z.object({
  id: Id,
  name: z.string(),
  aliases: z.array(z.string()).default([]),
  notes: text(),
  /** The place's fixed layout from its main camera angle: its landmarks and which side of the frame each one is on. */
  layout: z.string(),
  states: z.array(LocationStateSchema),
  archived: z.boolean().default(false),
  createdBy: CreatedBySchema,
  createdAt: IsoTimestamp,
  updatedAt: IsoTimestamp
})

export const LocationInputSchema = z.object({
  name: z.string(),
  aliases: z.array(z.string()).optional(),
  notes: z.string().optional(),
  layout: z.string()
})

export const LocationPatchSchema = LocationInputSchema.partial()

export const LocationStateInputSchema = z.object({
  name: z.string(),
  delta: z.string()
})

/**
 * Where a panel is set: a saved location, one of its states, and where the camera is. `camera` is `main` (the location's
 * main angle, which its layout and picture show), `reverse` (facing the other way, so left and right swap) or the
 * user's own words ("low, from the doorway, looking in").
 */
export const PanelLocationSchema = z.object({
  locationId: Id,
  stateId: Id,
  camera: z.string().default('main')
})
