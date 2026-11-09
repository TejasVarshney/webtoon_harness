import { describe, expect, it } from 'vitest'
import type { Panel } from '@shared/types'
import { makePanel } from '../test/factories'
import { pickContinuity } from './continuity'

let n = 0
/** A drawn panel with one ready, current image. */
function drawn(shot: Panel['shot'], location: string, o: Partial<Panel> = {}): Panel {
  const id = `pnl_${String(++n).padStart(10, '0')}`
  const version = { id: `ver_${String(n).padStart(10, '0')}`, source: 'generate' as const, status: 'ready' as const, error: null, imagePath: `panels/${id}/v.png`, prompt: '', check: null, createdAt: '2026-11-08T00:00:00.000Z' }
  return makePanel({ id, shot, location, versions: [version], currentVersionId: version.id, ...o })
}

describe('pickContinuity', () => {
  it('continues from the panel right before when either has no location, as before locations existed', () => {
    const before = [drawn('wide', 'stockroom'), drawn('close-up', '')]
    expect(pickContinuity({ location: 'stockroom' }, before)).toEqual({ panelId: before[1].id, imagePath: `panels/${before[1].id}/v.png`, earlier: false })
    expect(pickContinuity({ location: '' }, [drawn('wide', 'stockroom'), drawn('close-up', 'stockroom')])?.earlier).toBe(false)
  })

  it('skips a low-angle panel for the last wide one in the same place: the stockroom of "A new World", panels 4 to 6', () => {
    // Panel 4 is a wide shot with the back door on the left; panel 5 is a worms-eye view with the door straight ahead.
    const outside = drawn('wide', 'supermarket exterior')
    const panel4 = drawn('wide', 'stockroom')
    const panel5 = drawn('worms-eye', 'Stockroom ')
    const picked = pickContinuity({ location: 'stockroom' }, [outside, panel4, panel5])
    expect(picked).toEqual({ panelId: panel4.id, imagePath: `panels/${panel4.id}/v.png`, earlier: true })
  })

  it('keeps the panel right before when it is an open shot of the same place', () => {
    const before = [drawn('wide', 'stockroom'), drawn('medium', 'stockroom')]
    expect(pickContinuity({ location: 'stockroom' }, before)).toMatchObject({ panelId: before[1].id, earlier: false })
  })

  it('falls back to the nearest tight shot of the place when it has no open one', () => {
    const before = [drawn('close-up', 'stockroom'), drawn('extreme-close-up', 'stockroom')]
    expect(pickContinuity({ location: 'stockroom' }, before)).toMatchObject({ panelId: before[1].id, earlier: false })
  })

  it('sends nothing for a new place, and returns to the last panel of a place after a cutaway', () => {
    const restaurant = drawn('medium', 'Lumière')
    const flashback = drawn('worms-eye', 'stockroom')
    expect(pickContinuity({ location: 'street' }, [restaurant, flashback])).toBeNull()
    expect(pickContinuity({ location: 'lumière' }, [restaurant, flashback])).toMatchObject({ panelId: restaurant.id, earlier: true })
  })

  it('passes over panels without a ready image, and unreadable ones', () => {
    const wide = drawn('wide', 'stockroom')
    const failed = drawn('wide', 'stockroom', { versions: [], currentVersionId: null })
    expect(pickContinuity({ location: 'stockroom' }, [wide, null, failed])).toMatchObject({ panelId: wide.id, earlier: true })
    // Right before is unreadable: with no location to go by, there is nothing to continue from.
    expect(pickContinuity({ location: '' }, [wide, null])).toBeNull()
  })

  it('has nothing to continue from on the first panel', () => {
    expect(pickContinuity({ location: 'stockroom' }, [])).toBeNull()
  })
})
