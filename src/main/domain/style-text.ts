// The rules for a style's words, used by every path that saves them. The text goes into the line-structured image
// prompts as `${stylePreset}.`, so it must be one line with no period of its own.

const MIN_TEXT = 3
const MAX_TEXT = 400
const MAX_NAME = 40

/** Every prompt forbids drawn text, so a style that asks for it would fight the prompt it starts. */
const ASKS_FOR_DRAWN_TEXT = /speech bubble|lettering|caption|watermark|signature/i

/** A style or a style change the library refuses. The message is written for the user and for the agent. */
export class StyleRejectedError extends Error {}

const oneLine = (raw: string): string => raw.replace(/\s+/g, ' ').trim()

export function normalizeStyleText(raw: string): string {
  const text = oneLine(raw).replace(/[.\s]+$/, '')
  if (text.length < MIN_TEXT || text.length > MAX_TEXT) throw new StyleRejectedError(`A style description needs ${MIN_TEXT} to ${MAX_TEXT} characters.`)
  if (ASKS_FOR_DRAWN_TEXT.test(text)) {
    throw new StyleRejectedError('A style describes how the art looks. Take out the words about lettering, speech bubbles, captions, watermarks or signatures: every image prompt already forbids them.')
  }
  return text
}

export function normalizeStyleName(raw: string): string {
  const name = oneLine(raw)
  if (name.length < 1 || name.length > MAX_NAME) throw new StyleRejectedError(`A style name needs 1 to ${MAX_NAME} characters.`)
  return name
}
