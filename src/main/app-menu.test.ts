import { describe, expect, it, vi } from 'vitest'
import type { MenuItemConstructorOptions } from 'electron'
import type { MenuCommand } from '@shared/types'
import { appMenuTemplate, MENU_IDS, projectMenuId } from './app-menu'

const STATE = { projects: [{ id: 'prj_0000000001', title: 'Moon & Stars' }, { id: 'prj_0000000002', title: 'Sun' }], projectId: 'prj_0000000002' }

function fileItems(template: MenuItemConstructorOptions[]): MenuItemConstructorOptions[] {
  const file = template.find((m) => m.label === '&File')
  if (!file || !Array.isArray(file.submenu)) throw new Error('no File menu')
  return file.submenu
}

function byId(items: MenuItemConstructorOptions[], id: string): MenuItemConstructorOptions {
  for (const item of items) {
    if (item.id === id) return item
    if (Array.isArray(item.submenu)) {
      const found = item.submenu.find((s) => s.id === id)
      if (found) return found
    }
  }
  throw new Error(`no item ${id}`)
}

function click(item: MenuItemConstructorOptions): void {
  ;(item.click as () => void)()
}

describe('appMenuTemplate', () => {
  it('puts File first, then the standard Edit, View and Window menus', () => {
    const template = appMenuTemplate(STATE, () => undefined, 'win32')
    expect(template.map((m) => m.label ?? m.role)).toEqual(['&File', 'editMenu', 'viewMenu', 'windowMenu'])
  })

  it('leads with the app menu on macOS', () => {
    expect(appMenuTemplate(STATE, () => undefined, 'darwin')[0].role).toBe('appMenu')
  })

  it('lists New project, Open project, Home, Settings and Exit in order', () => {
    const labels = fileItems(appMenuTemplate(STATE, () => undefined, 'win32')).map((m) => m.label ?? m.type)
    expect(labels).toEqual(['New project', 'Open project', 'Home', 'separator', 'Settings', 'separator', 'Exit'])
  })

  it('reports each choice as a command', () => {
    const run = vi.fn<(c: MenuCommand) => void>()
    const items = fileItems(appMenuTemplate(STATE, run, 'win32'))
    click(byId(items, MENU_IDS.newProject))
    click(byId(items, projectMenuId('prj_0000000001')))
    click(byId(items, MENU_IDS.home))
    click(byId(items, MENU_IDS.settings))
    expect(run.mock.calls.map(([c]) => c)).toEqual([{ kind: 'newProject' }, { kind: 'openProject', projectId: 'prj_0000000001' }, { kind: 'home' }, { kind: 'settings' }])
  })

  it('ticks the open project and escapes an ampersand in a title', () => {
    const items = fileItems(appMenuTemplate(STATE, () => undefined, 'win32'))
    expect(byId(items, projectMenuId('prj_0000000002')).checked).toBe(true)
    expect(byId(items, projectMenuId('prj_0000000001'))).toMatchObject({ checked: false, label: 'Moon && Stars' })
  })

  it('keeps New project and Settings on their shortcuts', () => {
    const items = fileItems(appMenuTemplate(STATE, () => undefined, 'win32'))
    expect(byId(items, MENU_IDS.newProject).accelerator).toBe('CmdOrCtrl+Shift+N')
    expect(byId(items, MENU_IDS.settings).accelerator).toBe('CmdOrCtrl+,')
  })

  it('on the home page has no Home to go to, and says when there are no projects', () => {
    const items = fileItems(appMenuTemplate({ projects: [], projectId: null }, () => undefined, 'win32'))
    expect(byId(items, MENU_IDS.home).enabled).toBe(false)
    expect(byId(items, MENU_IDS.openProject).submenu).toEqual([{ label: 'No projects yet', enabled: false }])
  })
})
