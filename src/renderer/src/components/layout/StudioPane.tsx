import { BookOpen, GalleryVertical, MapPin, Package, Users, type LucideIcon } from 'lucide-react'
import { useAppStore, type StudioTab } from '../../stores/app-store'
import { CharacterStudio } from '../characters/CharacterStudio'
import { ItemStudio } from '../items/ItemStudio'
import { LocationStudio } from '../locations/LocationStudio'
import { StoryTab } from '../story/StoryTab'
import { WebtoonPane } from '../visualizer/WebtoonPane'

const TABS: { id: StudioTab; label: string; testId: string; icon: LucideIcon }[] = [
  { id: 'webtoon', label: 'Webtoon', testId: 'tab-webtoon', icon: GalleryVertical },
  { id: 'characters', label: 'Characters', testId: 'tab-characters', icon: Users },
  { id: 'items', label: 'Items', testId: 'tab-items', icon: Package },
  { id: 'locations', label: 'Locations', testId: 'tab-locations', icon: MapPin },
  { id: 'story', label: 'Story', testId: 'tab-story', icon: BookOpen }
]

/** The visualizer pane: the Webtoon strip, the Characters, Items and Locations tabs, and the Story tab. */
export function StudioPane() {
  const tab = useAppStore((s) => s.studioTab)
  const setStudioTab = useAppStore((s) => s.setStudioTab)
  return (
    <div className="studio-pane">
      <div className="tab-bar" role="tablist" aria-label="Visualizer">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            id={`tab-${t.id}`}
            aria-selected={tab === t.id}
            aria-controls="studio-tabpanel"
            data-testid={t.testId}
            onClick={() => setStudioTab(t.id)}
          >
            <t.icon size={15} aria-hidden="true" />
            {t.label}
          </button>
        ))}
      </div>
      <div className="tab-panel" role="tabpanel" id="studio-tabpanel" aria-labelledby={`tab-${tab}`}>
        {tab === 'webtoon' && <WebtoonPane />}
        {tab === 'characters' && <CharacterStudio />}
        {tab === 'items' && <ItemStudio />}
        {tab === 'locations' && <LocationStudio />}
        {tab === 'story' && <StoryTab />}
      </div>
    </div>
  )
}
