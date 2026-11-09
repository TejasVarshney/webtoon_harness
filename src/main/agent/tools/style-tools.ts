import { z } from 'zod'
import type { StyleUsage } from '@shared/ipc'
import { StyleRejectedError } from '../../domain/style-text'
import { ToolError, defineTool, type ToolContext, type ToolDefinition } from './registry'

const OLDER_DOCS = 'This works even if older project docs say the style cannot be changed.'
const LIBRARY_ONLY = 'This changes the library only; use set_style to apply a style.'

const isLocked = (usage: StyleUsage): boolean => usage.sheets + usage.panels > 0
const count = (n: number, noun: string): string => `${n} ${noun}${n === 1 ? '' : 's'}`

/** What the library or the text rules refused becomes a message for the model. */
async function refusalsAsToolErrors<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work()
  } catch (error) {
    throw error instanceof StyleRejectedError ? new ToolError(error.message) : error
  }
}

function libraryStyle(ctx: ToolContext, id: string) {
  const style = ctx.services.styleLibrary.get(id)
  if (!style) throw new ToolError(`Unknown style: ${id}`)
  return style
}

const listStyles = defineTool({
  name: 'list_styles',
  description:
    "See the art styles in the library, the project's current style, and whether you can still change it (canChange; when false, lockedBy says how much art exists). " +
    `Call it before set_style. ${OLDER_DOCS}`,
  input: z.object({}),
  handler: async (_input, ctx) => {
    const [meta, usage] = await Promise.all([ctx.services.projects.getMeta(ctx.project), ctx.services.styles.usage(ctx.project)])
    const locked = isLocked(usage)
    return {
      content: {
        current: meta.stylePreset,
        canChange: !locked,
        ...(locked ? { lockedBy: usage } : {}),
        styles: ctx.services.styleLibrary.list().map(({ id, name, text, builtin }) => ({ id, name, text, builtin }))
      }
    }
  }
})

const setStyle = defineTool({
  name: 'set_style',
  description:
    "Set the project's art style, from the library (styleId) or from your own words (text): pass exactly one. " +
    'It works only until the project has its first sheet or panel, because art drawn in another style would no longer match. ' +
    'When it is refused, tell the user to switch it with the Style button in the chat header; do not retry. ' +
    `Read workflows/style-setup first. ${OLDER_DOCS}`,
  input: z.object({
    styleId: z.string().optional().describe('A style id from list_styles'),
    text: z.string().optional().describe('The style in your own words: kind of art, line, shading, palette, rendering')
  }),
  handler: async ({ styleId, text }, ctx) => {
    if ((styleId === undefined) === (text === undefined)) throw new ToolError('Pass exactly one of styleId or text.')
    const wanted = styleId === undefined ? (text as string) : libraryStyle(ctx, styleId).text
    const usage = await ctx.services.styles.usage(ctx.project)
    if (isLocked(usage)) {
      throw new ToolError(
        `The style is locked: this project already has ${count(usage.sheets, 'sheet')} and ${count(usage.panels, 'panel')} drawn in it, and new art would not match them. Ask the user to switch it with the Style button in the chat header.`
      )
    }
    const meta = await refusalsAsToolErrors(() => ctx.services.styles.apply(ctx.project, wanted))
    return { content: { style: meta.stylePreset } }
  }
})

const createStyle = defineTool({
  name: 'create_style',
  description: `Add a new art style to the user's library, for this and every other project. ${LIBRARY_ONLY} Read workflows/style-setup first.`,
  input: z.object({
    name: z.string().describe('Short name shown in the picker, e.g. "Rainy city"'),
    text: z.string().describe('The style: kind of art, line, shading, palette, rendering. No lettering, no artist or franchise names')
  }),
  handler: async ({ name, text }, ctx) => ({ content: { style: await refusalsAsToolErrors(() => ctx.services.styleLibrary.create({ name, text })) } })
})

const updateStyle = defineTool({
  name: 'update_style',
  description: `Change the name or the words of a style that you or the user added. Built-in styles can only be edited by the user. No project changes: ${LIBRARY_ONLY} Read workflows/style-setup first.`,
  input: z.object({
    styleId: z.string().describe('The id of a style with builtin false, from list_styles'),
    name: z.string().optional(),
    text: z.string().optional()
  }),
  handler: async ({ styleId, name, text }, ctx) => {
    if (libraryStyle(ctx, styleId).builtin) throw new ToolError('Built-in styles can only be edited by the user.')
    return { content: { style: await refusalsAsToolErrors(() => ctx.services.styleLibrary.update(styleId, { name, text })) } }
  }
})

export const styleTools: ToolDefinition[] = [listStyles, setStyle, createStyle, updateStyle]
