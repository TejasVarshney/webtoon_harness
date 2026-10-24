// Prompts the app itself sends on the user's behalf. No imports: the renderer uses this file too.

/** What "Continue story" sends in AI-led mode (spec §10). The wording is pinned: the workflow docs and the tests rely on it. */
export function continueStoryPrompt(n: number): string {
  return `Continue the story (AI-led): plan the next beats and draw the next ${n} panels.`
}
