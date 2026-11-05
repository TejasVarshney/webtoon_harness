import { describe, expect, it } from 'vitest'
import type { DialogueLine, ExportSnapshot } from '@shared/types'
import { makeCharacter, makeEpisode, makePanel } from '../test/factories'
import { snapshotScript } from './snapshot-script'

describe('snapshotScript', () => {
  it('serializes the snapshot safely', () => {
    // A closing script tag, both quotes, an emoji and the two line separators that once ended JS string literals.
    const text = `</script>"' 😀    \`\${x}\` \\`
    const line = { id: 'dlg_0000000001', kind: 'speech', speakerId: null, text, placement: null } as DialogueLine
    const snapshot: ExportSnapshot = {
      projectId: 'prj_0000000001',
      episode: makeEpisode({ title: text }),
      panels: [makePanel({ dialogue: [line] })],
      characters: [makeCharacter({ name: text })],
      lettering: true
    }
    const script = snapshotScript(snapshot)
    const window = { webtoonExport: { render: (s: ExportSnapshot): ExportSnapshot => s } }
    const run = new Function('window', 'return ' + script) as (w: typeof window) => ExportSnapshot
    expect(run(window)).toEqual(snapshot)
    // The text only ever appears inside a string literal that JSON.parse reads.
    expect(script.startsWith('window.webtoonExport.render(JSON.parse(')).toBe(true)
  })
})
