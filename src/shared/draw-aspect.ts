// How a panel's shape becomes a request to an image model. Pure and type-only imports: no Node
// modules, no zod, so the main process and the renderer can both use it.

import type { DrawAspect, PanelAspect } from './types'

/** The very tall panels: no image model draws them, so they are drawn at 9:16, and the strip fades its top and bottom into the gutter. */
export function isTallAspect(aspect: PanelAspect): boolean {
  return aspect === '1:2' || aspect === '1:3'
}

/** The aspect to ask an image model for. Image providers never see `1:2` or `1:3`. */
export function drawAspect(aspect: PanelAspect): DrawAspect {
  return isTallAspect(aspect) ? '9:16' : (aspect as DrawAspect)
}
