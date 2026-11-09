import { z } from 'zod'
import { StyleRejectedError } from '../../domain/style-text'
import type { Services } from '../../services'
import { parseInput } from '../validate'
import type { HandlerMap } from './projects'

const Text = z.string()
const Key = z.object({ id: z.string() })
const CreateSchema = z.object({ name: Text, text: Text })
const UpdateSchema = z.object({ id: z.string(), patch: z.object({ name: Text.optional(), text: Text.optional() }) })
const ProjectSchema = z.object({ projectId: z.string() })
const ApplySchema = z.object({ projectId: z.string(), styleId: z.string() })

export function stylesHandlers(s: Services): HandlerMap {
  const library = s.styleLibrary
  return {
    'styles:list': async () => {
      // A file reported as unreadable may have been repaired since.
      if (library.loadError() !== null) await library.load()
      return { styles: library.list(), loadError: library.loadError() }
    },
    'styles:create': async (req) => library.create(parseInput(CreateSchema, req)),
    'styles:update': async (req) => {
      const { id, patch } = parseInput(UpdateSchema, req)
      return library.update(id, patch)
    },
    'styles:reset': async (req) => library.reset(parseInput(Key, req).id),
    'styles:delete': async (req) => library.delete(parseInput(Key, req).id),
    'styles:usage': async (req) => s.styles.usage(await s.projects.open(parseInput(ProjectSchema, req).projectId)),
    'styles:apply': async (req) => {
      const { projectId, styleId } = parseInput(ApplySchema, req)
      const style = library.get(styleId)
      if (!style) throw new StyleRejectedError(`Unknown style: ${styleId}`)
      return s.styles.apply(await s.projects.open(projectId), style.text)
    }
  }
}
