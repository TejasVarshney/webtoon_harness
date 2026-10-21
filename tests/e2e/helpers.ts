import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron as electron, expect, type ElectronApplication, type Page } from '@playwright/test'

const repoRoot = resolve(__dirname, '..', '..')

export interface LaunchOptions {
  /** Mock-provider script; written to a temp JSON file and handed to the app via WEBTOON_MOCK_SCRIPT. */
  script?: unknown
  /** Reuse an existing userData directory (e.g. to relaunch against the same state). */
  userDataDir?: string
  /** Reuse an existing projects root. */
  projectsRoot?: string
}

export interface LaunchedApp {
  app: ElectronApplication
  page: Page
  userDataDir: string
  projectsRoot: string
}

export async function launchApp(opts: LaunchOptions = {}): Promise<LaunchedApp> {
  const userDataDir = opts.userDataDir ?? (await mkdtemp(join(tmpdir(), 'webtoon-userdata-')))
  const projectsRoot = opts.projectsRoot ?? (await mkdtemp(join(tmpdir(), 'webtoon-projects-')))

  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) env[key] = value
  }
  // Windows needs the inherited environment; these two must not leak in from the caller's shell.
  delete env.ELECTRON_RUN_AS_NODE
  delete env.WEBTOON_MOCK_SCRIPT
  env.WEBTOON_USER_DATA = userDataDir
  env.WEBTOON_PROJECTS_ROOT = projectsRoot
  if (opts.script !== undefined) {
    const scriptDir = await mkdtemp(join(tmpdir(), 'webtoon-script-'))
    const scriptPath = join(scriptDir, 'mock-script.json')
    await writeFile(scriptPath, JSON.stringify(opts.script), 'utf8')
    env.WEBTOON_MOCK_SCRIPT = scriptPath
  }

  // `args: ['.']` with cwd at the repo root makes app.getAppPath() the repo root, so the
  // package.json "main" entry (out/main/index.js) is what Electron runs.
  const app = await electron.launch({ args: ['.'], cwd: repoRoot, env })
  const page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  return { app, page, userDataDir, projectsRoot }
}

/** Runs the new-project dialog, then creates a session. Leaves the new session selected. */
export async function createProjectAndSession(page: Page, title: string): Promise<void> {
  await page.getByTestId('new-project').click()
  await page.getByLabel('Title').fill(title)
  await page.getByRole('button', { name: 'Create' }).click()
  await page.getByTestId('new-session').click()
  await expect(page.getByTestId('session-item')).toHaveCount(1)
}

/**
 * Chats in the main pane: uses the first composer and assistant list on the page (the panel side chat comes
 * later in the DOM), sends `text`, and waits until the last assistant message contains `expectedReply`.
 */
export async function sendChat(page: Page, text: string, expectedReply: string): Promise<void> {
  await page.getByTestId('composer-input').first().fill(text)
  await page.getByTestId('composer-send').first().click()
  await expect(page.getByTestId('message-assistant').last()).toContainText(expectedReply)
}
