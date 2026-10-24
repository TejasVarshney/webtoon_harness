import type { Character, Variation } from '@shared/types'

export const PROJECT_ID = 'prj_aaaaaaaaaa'
const T = '2026-10-21T10:00:00.000Z'

export function variation(o: Partial<Variation> = {}): Variation {
  return {
    id: 'var_0000000001',
    characterId: 'chr_0000000001',
    name: 'Base',
    kind: 'base',
    delta: '',
    imagePath: 'characters/chr_0000000001/var_0000000001_aaaaaa.png',
    status: 'ready',
    error: null,
    createdBy: 'user',
    createdAt: T,
    ...o
  }
}

export function character(o: Partial<Character> = {}): Character {
  return {
    id: 'chr_0000000001',
    name: 'Mina',
    aliases: [],
    role: 'protagonist',
    characterization: { personality: '', backstory: '', motivation: '', speechStyle: '', relationships: [], notes: '' },
    appearance: { age: '', gender: '', build: '', height: '', hair: '', eyes: '', skin: '', distinguishingFeatures: '', defaultOutfit: '', palette: '' },
    appearanceLock: 'Teenage girl, silver bob haircut, amber eyes',
    variations: [variation()],
    archived: false,
    createdBy: 'user',
    createdAt: T,
    updatedAt: T,
    ...o
  }
}

/** `base` plus one extra variation. */
export function withVariation(c: Character, name: string, o: Partial<Variation> = {}): Character {
  const id = `var_${String(c.variations.length + 1).padStart(10, '0')}`
  return { ...c, variations: [...c.variations, variation({ id, characterId: c.id, name, kind: 'outfit', delta: 'navy blazer', imagePath: `characters/${c.id}/${id}_bbbbbb.png`, ...o })] }
}
