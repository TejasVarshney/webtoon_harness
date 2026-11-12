import { z } from 'zod'

// Schemas for the panel's frame and picture that the crop and Layout tools added, kept apart so schemas.ts stays short.

/** How a slanted panel is cut (see `src/shared/panel-cuts.ts`); null alternates two wedges down the strip. */
export const PanelCutSchema = z.enum(['top-down', 'top-up', 'bottom-down', 'bottom-up', 'both-down', 'both-up', 'narrow-right', 'narrow-left', 'lean-right', 'lean-left', 'left-edge', 'right-edge'])

/** A part of an image, as fractions of its width and height: inside it, and not empty. */
export const CropAreaSchema = z
  .object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1), width: z.number().gt(0).max(1), height: z.number().gt(0).max(1) })
  .refine((a) => a.x + a.width <= 1 + 1e-6 && a.y + a.height <= 1 + 1e-6, 'The crop must lie inside the image')
