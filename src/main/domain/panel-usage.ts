import type { ProjectContext } from '../storage/project-store'
import type { PanelUsageLookup } from './character-service'
import type { ItemUsageLookup } from './item-service'
import type { LocationUsageLookup } from './location-service'
import { scanPanels } from './panel-files'

/**
 * Which panels use a character, an item or a location, or one of their looks, whether or not an episode lists them.
 * The character, item and location services ask before a delete, which they refuse while a panel uses it. Every
 * answer reads the panel files afresh. `PanelService` extends this, so it answers all three lookups.
 */
export class PanelUsageScanner implements PanelUsageLookup, ItemUsageLookup, LocationUsageLookup {
  /** Panels that cast the character or give it a dialogue line. */
  async panelsUsingCharacter(ctx: ProjectContext, characterId: string): Promise<string[]> {
    const panels = await scanPanels(ctx)
    return panels.filter((p) => p.characters.some((c) => c.characterId === characterId) || p.dialogue.some((d) => d.speakerId === characterId)).map((p) => p.id)
  }

  async panelsUsingVariation(ctx: ProjectContext, variationId: string): Promise<string[]> {
    const panels = await scanPanels(ctx)
    return panels.filter((p) => p.characters.some((c) => c.variationId === variationId)).map((p) => p.id)
  }

  /** Panels that attach the item. */
  async panelsUsingItem(ctx: ProjectContext, itemId: string): Promise<string[]> {
    const panels = await scanPanels(ctx)
    return panels.filter((p) => p.items.some((i) => i.itemId === itemId)).map((p) => p.id)
  }

  async panelsUsingItemUsage(ctx: ProjectContext, usageId: string): Promise<string[]> {
    const panels = await scanPanels(ctx)
    return panels.filter((p) => p.items.some((i) => i.usageId === usageId)).map((p) => p.id)
  }

  /** Panels set in the location. */
  async panelsUsingLocation(ctx: ProjectContext, locationId: string): Promise<string[]> {
    const panels = await scanPanels(ctx)
    return panels.filter((p) => p.location?.locationId === locationId).map((p) => p.id)
  }

  async panelsUsingLocationState(ctx: ProjectContext, stateId: string): Promise<string[]> {
    const panels = await scanPanels(ctx)
    return panels.filter((p) => p.location?.stateId === stateId).map((p) => p.id)
  }
}
