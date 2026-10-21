import { describe, expect, it } from 'vitest'
import { assetUrl, parseAssetUrl } from './asset-url'

const PROJECT = 'prj_00000000aa'

describe('assetUrl', () => {
  it('builds webtoon-asset://<projectId>/<percent-encoded path>', () => {
    expect(assetUrl(PROJECT, 'panels/pnl_1/ver 1.png')).toBe('webtoon-asset://prj_00000000aa/panels/pnl_1/ver%201.png')
    expect(assetUrl(PROJECT, 'characters/chr_1/var_1_base.png')).toBe('webtoon-asset://prj_00000000aa/characters/chr_1/var_1_base.png')
  })
})

describe('parseAssetUrl', () => {
  it('round-trips asset urls with spaces', () => {
    const url = assetUrl('prj_00000000aa', 'panels/pnl_1/ver 1.png')
    expect(parseAssetUrl(url)).toEqual({ projectId: 'prj_00000000aa', relPath: 'panels/pnl_1/ver 1.png' })
  })

  it.each(['a#b.png', 'what?.png', '100%.png', 'a+b&c=d;e,f@g$.png', 'café/マンガ.png', "it's (1).png"])(
    'round-trips the awkward name %s',
    (name) => {
      const relPath = `uploads/${name}`
      expect(parseAssetUrl(assetUrl(PROJECT, relPath))).toEqual({ projectId: PROJECT, relPath })
    }
  )

  it('ignores a query string and fragment', () => {
    expect(parseAssetUrl(`webtoon-asset://${PROJECT}/uploads/a.png?v=2#top`)).toEqual({ projectId: PROJECT, relPath: 'uploads/a.png' })
  })

  it('decodes an encoded traversal so the path guard sees what the file system would', () => {
    expect(parseAssetUrl(`webtoon-asset://${PROJECT}/..%2F..%2Fsecret.txt`).relPath).toBe('../../secret.txt')
  })

  it.each([
    ['not a url at all', 'not a url'],
    ['an empty string', ''],
    ['a different scheme', `https://${PROJECT}/uploads/a.png`],
    ['a file url', 'file:///etc/passwd'],
    ['a missing host', 'webtoon-asset:///uploads/a.png'],
    ['an empty path', `webtoon-asset://${PROJECT}/`],
    ['no path at all', `webtoon-asset://${PROJECT}`],
    ['a broken percent escape', `webtoon-asset://${PROJECT}/uploads/%E0%A4%A.png`]
  ])('throws on %s', (_label, url) => {
    expect(() => parseAssetUrl(url)).toThrow()
  })
})
