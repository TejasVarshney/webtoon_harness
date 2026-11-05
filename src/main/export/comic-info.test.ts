import { describe, expect, it } from 'vitest'
import { comicInfoXml } from './comic-info'

describe('comicInfoXml', () => {
  it('escapes & < > " \'', () => {
    const xml = comicInfoXml({ series: `A & B`, title: `<"Hi">`, summary: `it's`, pageCount: 1 })
    expect(xml).toContain('<Series>A &amp; B</Series>')
    expect(xml).toContain('<Title>&lt;&quot;Hi&quot;&gt;</Title>')
    expect(xml).toContain('<Summary>it&apos;s</Summary>')
  })

  it('omits Number and Summary when not given', () => {
    const xml = comicInfoXml({ series: 'S', title: 'T', pageCount: 2 })
    expect(xml).not.toContain('<Number>')
    expect(xml).not.toContain('<Summary>')
    expect(xml.startsWith('<?xml version="1.0" encoding="utf-8"?><ComicInfo>')).toBe(true)
    expect(xml).toContain('<Manga>No</Manga>')
  })

  it('writes PageCount', () => {
    expect(comicInfoXml({ series: 'S', title: 'T', number: 4, pageCount: 17 })).toContain('<PageCount>17</PageCount>')
    expect(comicInfoXml({ series: 'S', title: 'T', number: 4, pageCount: 17 })).toContain('<Number>4</Number>')
  })
})
