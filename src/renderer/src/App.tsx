import { ThreePaneLayout } from './components/layout/ThreePaneLayout'

export function App() {
  return (
    <ThreePaneLayout
      left={<p className="placeholder">Sessions</p>}
      middle={<p className="placeholder">Chat</p>}
      right={<p className="placeholder">Webtoon panels</p>}
    />
  )
}
