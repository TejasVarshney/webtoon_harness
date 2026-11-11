// The building blocks every record schema shares. Their own file so `schemas.ts` and `location-schemas.ts` can both
// use them without importing each other.

import { z } from 'zod'

export const Id = z.string()
export const IsoTimestamp = z.string()

export const CreatedBySchema = z.enum(['user', 'ai'])
export const ImageStatusSchema = z.enum(['pending', 'ready', 'failed'])

// A refine and not a regex: a regex reaches the tool schemas as `pattern`, sent as it is to every provider.
export const HexColor = z.string().refine((v) => /^#[0-9a-f]{6}$/i.test(v), 'A colour is written as #rrggbb')

export const text = () => z.string().default('')

export const CheckResultSchema = z.object({
  passed: z.boolean(),
  issues: z.array(z.string()),
  skipped: z.boolean().default(false)
})
