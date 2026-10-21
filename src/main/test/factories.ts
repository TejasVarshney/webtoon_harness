import type { z } from 'zod'
import { CharacterSchema, EpisodeSchema, PanelSchema, ProjectMetaSchema, VariationSchema } from '@shared/schemas'
import type { Character, Episode, Panel, ProjectMeta, Variation } from '@shared/types'

// Test factories. Each one returns a schema-valid object with fixed, deterministic ids and
// timestamps; pass overrides for anything a test cares about. Overrides are typed as the schema's
// INPUT shape (so `{ appearance: { hair: 'red' } }` or a panel character without `action` is fine)
// and are validated and default-filled like any other parse.

type Overrides<S extends z.ZodType> = Partial<z.input<S>>

const T = '2026-01-01T00:00:00.000Z'

export function makeVariation(o: Overrides<typeof VariationSchema> = {}): Variation {
  return VariationSchema.parse({
    id: 'var_0000000001',
    characterId: 'chr_0000000001',
    name: 'Base',
    kind: 'base',
    status: 'pending',
    createdBy: 'user',
    createdAt: T,
    ...o
  })
}

/** A character with exactly one base variation that points back at it (the spec invariant). */
export function makeCharacter(o: Overrides<typeof CharacterSchema> = {}): Character {
  const id = o.id ?? 'chr_0000000001'
  return CharacterSchema.parse({
    id,
    name: 'Mina',
    role: 'protagonist',
    appearanceLock: 'Slim build, shoulder-length black bob haircut, amber eyes, round glasses',
    variations: [makeVariation({ characterId: id })],
    createdBy: 'user',
    createdAt: T,
    updatedAt: T,
    ...o
  })
}

export function makePanel(o: Overrides<typeof PanelSchema> = {}): Panel {
  return PanelSchema.parse({
    id: 'pnl_0000000001',
    episodeId: 'epi_0000000001',
    description: 'Mina opens the apartment door.',
    setting: 'Apartment hallway, evening',
    shot: 'medium',
    aspect: '2:3',
    dialogue: [],
    createdBy: 'user',
    createdAt: T,
    updatedAt: T,
    ...o
  })
}

export function makeEpisode(o: Overrides<typeof EpisodeSchema> = {}): Episode {
  return EpisodeSchema.parse({
    id: 'epi_0000000001',
    number: 1,
    title: 'Episode 1',
    createdAt: T,
    updatedAt: T,
    ...o
  })
}

export function makeMeta(o: Overrides<typeof ProjectMetaSchema> = {}): ProjectMeta {
  return ProjectMetaSchema.parse({
    id: 'prj_0000000001',
    title: 'Test Webtoon',
    createdAt: T,
    updatedAt: T,
    ...o
  })
}
