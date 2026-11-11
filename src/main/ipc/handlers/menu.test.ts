import { describe, expect, it, vi } from 'vitest'
import type { MenuState } from '@shared/types'
import { menuHandlers } from './menu'

describe('app:setMenu', () => {
  it('passes the projects and the open one to the menu', async () => {
    const setMenu = vi.fn<(s: MenuState) => void>()
    const state = { projects: [{ id: 'prj_0000000001', title: 'Moon' }], projectId: 'prj_0000000001' }
    await menuHandlers({ setMenu })['app:setMenu']!(state as never)
    expect(setMenu).toHaveBeenCalledWith(state)
  })

  it('refuses a malformed state and leaves the menu alone', async () => {
    const setMenu = vi.fn<(s: MenuState) => void>()
    await expect(menuHandlers({ setMenu })['app:setMenu']!({ projects: [{ id: '../x', title: 'Bad' }], projectId: null } as never)).rejects.toThrow(/Invalid input/)
    expect(setMenu).not.toHaveBeenCalled()
  })
})
