import { flushSync } from 'react-dom'
import { createRoot } from 'react-dom/client'
// Fonts are bundled with the app, as in main.tsx: the policy loads nothing from the network.
import '@fontsource/ibm-plex-sans/latin-400.css'
import '@fontsource/ibm-plex-sans/latin-500.css'
import '@fontsource/ibm-plex-sans/latin-600.css'
import '@fontsource/ibm-plex-sans/latin-400-italic.css'
import '@fontsource/ibm-plex-mono/latin-400.css'
import '@fontsource/comic-neue/latin-400.css'
import '@fontsource/comic-neue/latin-700.css'
import '@fontsource/bangers/latin-400.css'
import type { ExportSnapshot, ViewLayout } from '@shared/types'
import { ExportView } from './components/export/ExportView'
import { waitForPaintAndMeasure } from './components/export/measure'
import { useAppStore } from './stores/app-store'
import { useCharactersStore } from './stores/characters-store'
import './styles.css'
import './export.css'

declare global {
  interface Window {
    webtoonExport: { render(snapshot: ExportSnapshot): Promise<ViewLayout> }
  }
}

const container = document.getElementById('root')
if (!container) throw new Error('Missing #root element')
const root = createRoot(container)

// Main drives this page with executeJavaScript. There is no preload here, so nothing may reach `window.api`:
// the stores are filled directly, and `loaded: true` keeps the roster hook from asking for characters.
window.webtoonExport = {
  render(snapshot) {
    useAppStore.setState({ projectId: snapshot.projectId })
    useCharactersStore.setState({ characters: snapshot.characters, loaded: true, projectId: snapshot.projectId })
    flushSync(() => root.render(<ExportView snapshot={snapshot} />))
    return waitForPaintAndMeasure(container)
  }
}
