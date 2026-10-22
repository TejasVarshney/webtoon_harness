import { useAppStore, type RightTab } from '../../stores/app-store'
import { CharacterStudio } from '../characters/CharacterStudio'
import { WebtoonPane } from '../visualizer/WebtoonPane'

const TABS: { id: RightTab; label: string; testId: string }[] = [
  { id: 'webtoon', label: 'Webtoon', testId: 'tab-webtoon' },
  { id: 'characters', label: 'Characters', testId: 'tab-characters' },
  { id: 'story', label: 'Story', testId: 'tab-story' }
]

/** The visualizer pane: the Webtoon strip and the Characters tab. Story is a placeholder until its task lands. */
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
            {t.label}
          </button>
        ))}
      </div>
      <div className="tab-panel" role="tabpanel" id="right-tabpanel" aria-labelledby={`tab-${tab}`}>
        {tab === 'webtoon' && <WebtoonPane />}
        {tab === 'characters' && <CharacterStudio />}
        {tab === 'story' && <p className="placeholder">Story bible and beats</p>}
      </div>
    </div>
  )
}
