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
  /** A directory that stands in for the export save dialog (WEBTOON_EXPORT_TARGET). */
  exportTarget?: string
  /** Forces the main window's device scale factor. Chromium rounds a 2.5px frame border to whole device pixels, so a panel is a fraction of a px narrower at 1.25 than at 1, which a test comparing px against the export window needs to rule out. */
  deviceScaleFactor?: number
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
  delete env.WEBTOON_EXPORT_TARGET
  if (opts.exportTarget !== undefined) env.WEBTOON_EXPORT_TARGET = opts.exportTarget
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
  const args = opts.deviceScaleFactor === undefined ? ['.'] : ['.', `--force-device-scale-factor=${opts.deviceScaleFactor}`]
  const app = await electron.launch({ args, cwd: repoRoot, env })
  const page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  return { app, page, userDataDir, projectsRoot }
}

/** The app starts on the home page, so a relaunch opens the project it should show by clicking its card. */
export async function openFirstProject(page: Page): Promise<void> {
  await page.getByTestId('project-card').first().click()
  await expect(page.getByTestId('pane-chat')).toBeVisible()
}

/** Runs the new-project dialog, then creates a session. Leaves the new session selected. */
export async function createProjectAndSession(page: Page, title: string): Promise<void> {
  await page.getByTestId('new-project').click()
  await page.getByLabel('Title').fill(title)
  await page.getByRole('button', { name: 'Create' }).click()
  await page.getByTestId('new-session').click()
  await openSessions(page)
  await expect(page.getByTestId('session-item')).toHaveCount(1)
  await page.keyboard.press('Escape')
}

/** Opens the session list at the top of the chat. Choosing a session, or Escape, closes it again. */
export async function openSessions(page: Page): Promise<void> {
  await page.getByTestId('sessions-toggle').click()
  await expect(page.getByTestId('sessions-popup')).toBeVisible()
}

/**
 * Chats in the main chat only: `.main-chat` is the main chat's container inside `pane-chat`, so a panel side chat
 * below it (which has composer and assistant-message test ids of its own) is never typed into or read from.
 * Sends `text`, then waits until the main chat's last assistant message contains `expectedReply`.
 */
export async function sendChat(page: Page, text: string, expectedReply: string): Promise<void> {
  const chat = page.getByTestId('pane-chat').locator('.main-chat')
  await chat.getByTestId('composer-input').fill(text)
  await chat.getByTestId('composer-send').click()
  await expect(chat.getByTestId('message-assistant').last()).toContainText(expectedReply)
}

/**
 * Reads a JSON file of the project under `projectsRoot` (which holds exactly one `prj_*` folder, as a fresh test run does).
 * `relPath` is project-relative and POSIX, like the paths stored in project files. When it names a folder, the result is
 * the array of its parsed `*.json` files in file-name order; other entries (side-chat logs, image folders, temp files)
 * are skipped. The result is `any` on purpose: specs assert on whatever shape they are checking.
 */
export async function readProjectJson(projectsRoot: string, relPath: string): Promise<any> {
  const abs = await projectFilePath(projectsRoot, relPath)
  if ((await stat(abs)).isDirectory()) {
    const names = (await readdir(abs, { withFileTypes: true })).filter((e) => e.isFile() && e.name.endsWith('.json')).map((e) => e.name).sort()
    return Promise.all(names.map(async (name) => JSON.parse(await readFile(join(abs, name), 'utf8'))))
  }
  return JSON.parse(await readFile(abs, 'utf8'))
}

/** Writes a JSON file of the project under `projectsRoot`, like a hand edit would. Call it while the app is closed. */
export async function writeProjectJson(projectsRoot: string, relPath: string, data: unknown): Promise<void> {
  await writeFile(await projectFilePath(projectsRoot, relPath), JSON.stringify(data, null, 2), 'utf8')
}

async function projectFilePath(projectsRoot: string, relPath: string): Promise<string> {
  const projects = (await readdir(projectsRoot, { withFileTypes: true })).filter((e) => e.isDirectory() && e.name.startsWith('prj_'))
  if (projects.length !== 1) throw new Error(`Expected exactly one project folder in ${projectsRoot}, found ${projects.length}`)
  const projectDir = join(projectsRoot, projects[0].name)
  const abs = resolve(projectDir, ...relPath.split('/'))
  if (abs !== projectDir && !abs.startsWith(projectDir + sep)) throw new Error(`Path leaves the project: ${relPath}`)
  return abs
}

/** Opens one tab of the visualizer pane and waits until it is the selected one. */
export async function openTab(page: Page, tab: 'webtoon' | 'characters' | 'items' | 'locations' | 'story'): Promise<void> {
  const button = page.getByTestId(`tab-${tab}`)
  await button.click()
  await expect(button).toHaveAttribute('aria-selected', 'true')
}

/**
 * Makes a blank panel through the Generate page ("+" on the strip, then Add blank panel), and opens it in focus mode,
 * where the page leaves it selected on the strip.
 */
export async function addBlankPanel(page: Page): Promise<void> {
  await page.getByTestId('add-panel').last().click()
  await page.getByTestId('generate-blank').click()
  await page.locator('[data-testid="panel-card"][data-selected="true"]').dblclick()
}

/**
 * Clicks an item of the window's menu bar by its id (see `MENU_IDS` in src/main/app-menu.ts). Playwright cannot reach
 * a native menu, so this runs the item's click in main, which is what a real click on it does.
 */
export async function clickMenuItem(app: ElectronApplication, id: string): Promise<void> {
  await app.evaluate(({ Menu }, itemId) => {
    const item = Menu.getApplicationMenu()?.getMenuItemById(itemId)
    if (!item) throw new Error(`No menu item ${itemId}`)
    item.click()
  }, id)
}

/** The titles under File > Open project, as the menu shows them now. */
export async function menuProjects(app: ElectronApplication): Promise<string[]> {
  return app.evaluate(({ Menu }) => (Menu.getApplicationMenu()?.getMenuItemById('menu-open-project')?.submenu?.items ?? []).filter((i) => i.enabled).map((i) => i.label))
}

/** Switches to a project by its title, through File > Open project in the window's menu bar. */
export async function openProjectFromMenu(app: ElectronApplication, page: Page, title: string): Promise<void> {
  // The renderer reports its projects to the menu, so a project made a moment ago may take a tick to be listed.
  await expect.poll(() => menuProjects(app)).toContain(title)
  await app.evaluate(({ Menu }, label) => {
    const item = Menu.getApplicationMenu()?.getMenuItemById('menu-open-project')?.submenu?.items.find((i) => i.label === label)
    if (!item) throw new Error(`No project ${label} in File > Open project`)
    item.click()
  }, title)
  await expect(page.getByTestId('pane-chat')).toBeVisible()
}

/** Opens the Settings dialog from File > Settings in the window's menu bar. */
export async function openSettings(app: ElectronApplication, page: Page): Promise<void> {
  await clickMenuItem(app, 'menu-settings')
  await expect(page.getByRole('dialog', { name: 'Settings' })).toBeVisible()
}
