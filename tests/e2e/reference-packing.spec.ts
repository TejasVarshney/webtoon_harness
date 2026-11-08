import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { createProjectAndSession, launchApp, openTab, readProjectJson, sendChat } from './helpers'

// Reference packing on the real offscreen canvas. Four cast members and the previous panel are one reference over the
// mock image model's cap of 4, so the last two cast sheets are drawn onto one image, side by side under their names.
const names = ['Mina', 'Jin', 'Kai', 'Ara']
const character = (name: string) => ({ name, role: 'supporting', appearanceLock: `${name}, a teenager in a plain jacket.` })
const castEntry = (name: string) => ({ characterId: { $character: name }, variationId: { $variation: [name, 'Base'] } })
const panelInput = (description: string, cast: string[]) => ({
  episodeId: { $episode: 'current' },
  description,
  setting: 'Rooftop at night',
  shot: 'wide',
  characters: cast.map(castEntry),
  dialogue: []
})

const script = {
  turns: [
    { toolCalls: names.map((name) => ({ name: 'create_character', input: character(name) })) },
    { text: 'Cast ready.' },
    {
      toolCalls: [
        { name: 'create_panel', input: panelInput('Mina waits on the roof.', ['Mina']) },
        { name: 'create_panel', input: panelInput('The other three join Mina.', names) }
      ]
    },
    { text: 'Panels drawn.' }
  ]
}

test('a panel over the reference cap is drawn from a packed, labeled image of the last cast sheets', async () => {
  const { app, page, projectsRoot } = await launchApp({ script })
  await createProjectAndSession(page, 'Packing Test')
  await sendChat(page, 'Make the cast', 'Cast ready.')
  await sendChat(page, 'Draw the panels', 'Panels drawn.')
  await openTab(page, 'webtoon')
  await expect(page.getByTestId('panel-card').locator('img')).toHaveCount(2)

  const [episode] = await readProjectJson(projectsRoot, 'episodes')
  const first = await readProjectJson(projectsRoot, `panels/${episode.panelIds[0]}.json`)
  const second = await readProjectJson(projectsRoot, `panels/${episode.panelIds[1]}.json`)
  const characters: { name: string; variations: { imagePath: string }[] }[] = await readProjectJson(projectsRoot, 'characters')
  const sheet = (name: string) => characters.find((c) => c.name === name)!.variations[0].imagePath
  const version = second.versions[0]
  expect(version.status).toBe('ready')
  const pack: string = version.referenceImagePaths[2]
  expect(pack).toMatch(new RegExp(`^panels/${second.id}/pack-[0-9a-f]{16}\\.png$`))
  expect(version.referenceImagePaths).toEqual([sheet('Mina'), sheet('Jin'), pack, first.versions[0].imagePath])
  expect(version.prompt).toContain("[CHARACTERS] Reference image 3 holds 2 character sheets, each labeled with the person's name")
  expect(version.prompt).toContain('- Ara (reference image 3, the sheet labeled Ara): ')

  const projectDir = join(projectsRoot, (await readdir(projectsRoot)).find((n) => n.startsWith('prj_'))!)
  const abs = (rel: string) => join(projectDir, ...rel.split('/'))
  const picture = await app.evaluate(
    ({ nativeImage }, [packPath, kaiPath, araPath]) => {
      const img = nativeImage.createFromPath(packPath)
      const { width, height } = img.getSize()
      const bgra = img.toBitmap()
      const at = (x: number, y: number) => {
        const i = (y * width + x) * 4
        return [bgra[i + 2], bgra[i + 1], bgra[i]]
      }
      const colorOf = (path: string) => {
        const s = nativeImage.createFromPath(path)
        const { width: w, height: h } = s.getSize()
        const b = s.toBitmap()
        const i = (Math.floor(h / 2) * w + Math.floor(w / 2)) * 4
        return [b[i + 2], b[i + 1], b[i]]
      }
      /** Dark pixels along the middle row of a band: the letters of the name. */
      const ink = (x0: number, x1: number, y: number) => {
        let n = 0
        for (let x = x0; x < x1; x++) if (at(x, y).every((c) => c < 100)) n++
        return n
      }
      return {
        width,
        height,
        bandCorner: at(4, 4),
        gap: at(768, 700),
        leftSheet: at(376, 712),
        rightSheet: at(1159, 712),
        kai: colorOf(kaiPath),
        ara: colorOf(araPath),
        leftInk: ink(0, 753, 73),
        rightInk: ink(783, 1536, 73)
      }
    },
    [abs(pack), abs(sheet('Kai')), abs(sheet('Ara'))]
  )
  expect([picture.width, picture.height]).toEqual([1536, 1277])
  expect(picture.bandCorner).toEqual([255, 255, 255])
  expect(picture.gap).toEqual([255, 255, 255])
  // Kai's sheet on the left, Ara's on the right, in cast order.
  expect(picture.leftSheet).toEqual(picture.kai)
  expect(picture.rightSheet).toEqual(picture.ara)
  expect(picture.leftInk).toBeGreaterThan(10)
  expect(picture.rightInk).toBeGreaterThan(10)
  await app.close()
})
