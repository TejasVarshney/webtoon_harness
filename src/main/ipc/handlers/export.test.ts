import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { testServices, type TestServices } from '../../test/test-services'
import { registerIpc } from '../register'
import { exportHandlers } from './export'

let services: TestServices | undefined
afterEach(async () => {
  vi.restoreAllMocks()
  await services?.cleanup()
  services = undefined
})

const req = (preset: string, extra: object = {}) => ({ projectId: 'proj_a', episodeIds: ['ep_1'], preset, ...extra })

describe('export handlers', () => {
  it('export:start shows the folder dialog for webtoon and starts the job', async () => {
    services = await testServices()
    const start = vi.spyOn(services.exports, 'start').mockResolvedValue({ jobId: 'exp_1' })
    vi.spyOn(services.exports, 'suggestedName').mockResolvedValue('Moon Diary')
    const choose = vi.fn(async () => path.join(services!.projectsRoot, 'out'))
    const h = exportHandlers(services, { chooseExportTarget: choose })
    const res = await h['export:start']!(req('webtoon') as never, 'evt')
    expect(res).toEqual({ jobId: 'exp_1' })
    expect(choose).toHaveBeenCalledWith('evt', { kind: 'folder', defaultPath: services.exports.exportsDir, extension: null })
    expect(start).toHaveBeenCalledWith(expect.objectContaining({ preset: 'webtoon', imageType: 'jpeg' }), path.join(services.projectsRoot, 'out'))
  })

  it('export:start offers a suggested file name with its extension for a file preset', async () => {
    services = await testServices()
    vi.spyOn(services.exports, 'start').mockResolvedValue({ jobId: 'exp_1' })
    vi.spyOn(services.exports, 'suggestedName').mockResolvedValue('Moon Diary - 01 - Pilot.cbz')
    const choose = vi.fn(async () => '/x/y.cbz')
    await exportHandlers(services, { chooseExportTarget: choose })['export:start']!(req('cbz') as never)
    expect(choose).toHaveBeenCalledWith(undefined, {
      kind: 'file',
      defaultPath: path.join(services.exports.exportsDir, 'Moon Diary - 01 - Pilot.cbz'),
      extension: 'cbz'
    })
  })

  it('export:start returns {cancelled:true} when the dialog is dismissed and starts nothing', async () => {
    services = await testServices()
    const start = vi.spyOn(services.exports, 'start')
    const h = exportHandlers(services, { chooseExportTarget: async () => null })
    expect(await h['export:start']!(req('webtoon') as never)).toEqual({ cancelled: true })
    expect(await exportHandlers(services)['export:start']!(req('webtoon') as never)).toEqual({ cancelled: true })
    expect(start).not.toHaveBeenCalled()
  })

  it('export:start rejects a bad preset as one readable line', async () => {
    services = await testServices()
    const map = new Map<string, (e: unknown, r: unknown) => unknown>()
    registerIpc({ handle: (c, fn) => void map.set(c, fn) }, services, { chooseExportTarget: async () => '/x' })
    const error = await Promise.resolve(map.get('export:start')!(null, req('gif'))).then(() => null, (e: unknown) => e)
    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).toMatch(/^Invalid input: preset: /)
    expect((error as Error).message).not.toContain('\n')
  })

  it('export:reveal shows the job\'s first output and never takes a path', async () => {
    services = await testServices()
    vi.spyOn(services.exports, 'outputsOf').mockImplementation((id) => (id === 'exp_1' ? ['/o/a.pdf', '/o/b.pdf'] : []))
    const show = vi.fn()
    const h = exportHandlers(services, { showItemInFolder: show })
    await h['export:reveal']!({ jobId: 'exp_1', path: '/etc/passwd' } as never)
    expect(show).toHaveBeenCalledExactlyOnceWith('/o/a.pdf')
    await h['export:reveal']!({ jobId: 'exp_none' })
    expect(show).toHaveBeenCalledTimes(1)
  })

  it('export:cancel passes the job id to the service', async () => {
    services = await testServices()
    const cancel = vi.spyOn(services.exports, 'cancel')
    await exportHandlers(services)['export:cancel']!({ jobId: 'exp_1' })
    expect(cancel).toHaveBeenCalledWith('exp_1')
  })
})
