import { mkdtemp, readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
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
  // `pane-chat` wraps only the main chat; the panel side chat lives in the visualizer pane.
  const chat = page.getByTestId('pane-chat')
  await chat.getByTestId('composer-input').first().fill(text)
  await chat.getByTestId('composer-send').first().click()
  await expect(chat.getByTestId('message-assistant').last()).toContainText(expectedReply)
}

/**
 * Reads a JSON file of the project under `projectsRoot` (which holds exactly one `prj_*` folder, as a fresh test run does).
 * `relPath` is project-relative and POSIX, like the paths stored in project files. When it names a folder, the result is
 * the array of its parsed `*.json` files in file-name order; other entries (side-chat logs, image folders, temp files)
 * are skipped. The result is `any` on purpose: specs assert on whatever shape they are checking.
 */
export async function readProjectJson(projectsRoot: string, relPath: string): Promise<any> {
  const projects = (await readdir(projectsRoot, { withFileTypes: true })).filter((e) => e.isDirectory() && e.name.startsWith('prj_'))
  if (projects.length !== 1) throw new Error(`Expected exactly one project folder in ${projectsRoot}, found ${projects.length}`)
  const projectDir = join(projectsRoot, projects[0].name)
  const abs = resolve(projectDir, ...relPath.split('/'))
  if (abs !== projectDir && !abs.startsWith(projectDir + sep)) throw new Error(`Path leaves the project: ${relPath}`)
  if ((await stat(abs)).isDirectory()) {
    const names = (await readdir(abs, { withFileTypes: true })).filter((e) => e.isFile() && e.name.endsWith('.json')).map((e) => e.name).sort()
    return Promise.all(names.map(async (name) => JSON.parse(await readFile(join(abs, name), 'utf8'))))
  }
  return JSON.parse(await readFile(abs, 'utf8'))
}
