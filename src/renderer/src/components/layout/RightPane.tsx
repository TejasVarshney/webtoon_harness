import { BookOpen, GalleryVertical, Package, Users, type LucideIcon } from 'lucide-react'
import { useAppStore, type RightTab } from '../../stores/app-store'
import { CharacterStudio } from '../characters/CharacterStudio'
import { ItemStudio } from '../items/ItemStudio'
import { StoryTab } from '../story/StoryTab'
import { WebtoonPane } from '../visualizer/WebtoonPane'

const TABS: { id: RightTab; label: string; testId: string; icon: LucideIcon }[] = [
  { id: 'webtoon', label: 'Webtoon', testId: 'tab-webtoon', icon: GalleryVertical },
  { id: 'characters', label: 'Characters', testId: 'tab-characters', icon: Users },
  { id: 'items', label: 'Items', testId: 'tab-items', icon: Package },
  { id: 'story', label: 'Story', testId: 'tab-story', icon: BookOpen }
]

/** The visualizer pane: the Webtoon strip, the Characters tab, the Items tab and the Story tab. */
export function RightPane() {
  const tab = useAppStore((s) => s.rightTab)
  const setRightTab = useAppStore((s) => s.setRightTab)
  return (
    <div className="right-pane">
      <div className="tab-bar" role="tablist" aria-label="Visualizer">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            id={`tab-${t.id}`}
            aria-selected={tab === t.id}
            aria-controls="right-tabpanel"
            data-testid={t.testId}
            onClick={() => setRightTab(t.id)}
          >
            <t.icon size={15} aria-hidden="true" />
            {t.label}
          </button>
        ))}
      </div>
      <div className="tab-panel" role="tabpanel" id="right-tabpanel" aria-labelledby={`tab-${tab}`}>
        {tab === 'webtoon' && <WebtoonPane />}
        {tab === 'characters' && <CharacterStudio />}
        {tab === 'items' && <ItemStudio />}
        {tab === 'story' && <StoryTab />}
      </div>
    </div>
  )
}
