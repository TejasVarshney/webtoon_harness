import { create } from 'zustand'
import type { MenuCommand, MenuState } from '@shared/types'
import { api } from '../api'
import { useAppStore, type AppData } from './app-store'

/** The dialogs the window's File menu opens. */
type MenuDialog = 'newProject' | 'settings'

interface MenuData {
  dialog: MenuDialog | null
  /** Why the last File choice failed (a project that would not open), until it is dismissed or another choice works. */
  error: string | null
}

export const useMenuStore = create<MenuData>()(() => ({ dialog: null, error: null }))

export function closeMenuDialog(): void {
  useMenuStore.setState({ dialog: null })
}

export function dismissMenuError(): void {
  useMenuStore.setState({ error: null })
}

/** Leaves the open project for the home page, which lists what is on disk now, so a project made this session shows its current data. */
function goHome(): void {
  useAppStore.getState().closeProject()
  useAppStore.getState().loadProjects().catch((e: unknown) => console.error('Failed to reload projects', e))
}

/** Carries out what the File menu in the window's menu bar asked for. */
export function runMenuCommand(command: MenuCommand): void {
  switch (command.kind) {
    case 'newProject':
    case 'settings':
      useMenuStore.setState({ dialog: command.kind })
      return
    case 'home':
      dismissMenuError()
      goHome()
      return
    case 'openProject': {
      if (command.projectId === useAppStore.getState().projectId) return
      useAppStore
        .getState()
        .openProject(command.projectId)
        .then(
          () => dismissMenuError(),
          (e: unknown) => useMenuStore.setState({ error: e instanceof Error ? e.message : String(e) })
        )
    }
  }
}

/** Newest first, as the home page lists them. */
function menuState({ projects, projectId }: AppData): MenuState {
  const newest = [...projects].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  return { projects: newest.map((p) => ({ id: p.id, title: p.title })), projectId }
}

/**
 * Tells main what the File menu lists (`app:setMenu`): once now, then whenever a project is added, renamed or opened.
 * Returns the unsubscribe function.
 */
export function startMenuSync(): () => void {
  let last = ''
  const send = (s: AppData): void => {
    const state = menuState(s)
    const key = JSON.stringify(state)
    if (key === last) return
    last = key
    api.invoke('app:setMenu', state).catch((e: unknown) => console.error('Failed to update the File menu', e))
  }
  send(useAppStore.getState())
  return useAppStore.subscribe((s, prev) => {
    if (s.projects !== prev.projects || s.projectId !== prev.projectId) send(s)
  })
}
