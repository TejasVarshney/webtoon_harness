import type { MenuItemConstructorOptions } from 'electron'
import type { MenuCommand, MenuState } from '@shared/types'

/** Ids of the File menu's items, for `Menu.getMenuItemById` (the e2e helpers click through them). */
export const MENU_IDS = {
  newProject: 'menu-new-project',
  openProject: 'menu-open-project',
  home: 'menu-home',
  settings: 'menu-settings'
} as const

/** The id of a project's entry under File > Open project. */
export function projectMenuId(projectId: string): string {
  return `menu-project:${projectId}`
}

/**
 * The window's menu bar: File (new and open project, Home, Settings, quit), then Electron's own Edit, View and Window
 * menus, and on macOS the app menu first. Every File item only reports what was chosen through `run`; the renderer
 * carries it out, since the project list and the dialogs live there.
 */
export function appMenuTemplate(state: MenuState, run: (command: MenuCommand) => void, platform: NodeJS.Platform = process.platform): MenuItemConstructorOptions[] {
  const projects: MenuItemConstructorOptions[] =
    state.projects.length === 0
      ? [{ label: 'No projects yet', enabled: false }]
      : state.projects.map((p) => ({
          id: projectMenuId(p.id),
          // An `&` would turn the next letter into an access key on Windows.
          label: p.title.replaceAll('&', '&&'),
          type: 'checkbox',
          checked: p.id === state.projectId,
          click: () => run({ kind: 'openProject', projectId: p.id })
        }))
  const file: MenuItemConstructorOptions = {
    label: '&File',
    submenu: [
      { id: MENU_IDS.newProject, label: 'New project', accelerator: 'CmdOrCtrl+Shift+N', click: () => run({ kind: 'newProject' }) },
      { id: MENU_IDS.openProject, label: 'Open project', submenu: projects },
      { id: MENU_IDS.home, label: 'Home', enabled: state.projectId !== null, click: () => run({ kind: 'home' }) },
      { type: 'separator' },
      { id: MENU_IDS.settings, label: 'Settings', accelerator: 'CmdOrCtrl+,', click: () => run({ kind: 'settings' }) },
      { type: 'separator' },
      platform === 'darwin' ? { role: 'close' } : { role: 'quit', label: 'Exit' }
    ]
  }
  const rest: MenuItemConstructorOptions[] = [{ role: 'editMenu' }, { role: 'viewMenu' }, { role: 'windowMenu' }]
  return platform === 'darwin' ? [{ role: 'appMenu' }, file, ...rest] : [file, ...rest]
}
