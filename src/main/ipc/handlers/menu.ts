import { z } from 'zod'
import type { MenuState } from '@shared/types'
import { IdSchema, parseInput } from '../validate'
import type { HandlerMap } from './projects'

const MenuStateSchema = z.object({
  projects: z.array(z.object({ id: IdSchema, title: z.string() })),
  projectId: IdSchema.nullable()
})

/** The window's menu bar. `setMenu` rebuilds it; without one (tests) the state is checked and dropped. */
export function menuHandlers(deps: { setMenu?: (state: MenuState) => void } = {}): HandlerMap {
  return {
    'app:setMenu': async (req) => {
      const state = parseInput(MenuStateSchema, req)
      deps.setMenu?.(state)
    }
  }
}
