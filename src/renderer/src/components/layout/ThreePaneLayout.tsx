import type { ReactNode } from 'react'
import { Group, Panel, Separator } from 'react-resizable-panels'

export interface ThreePaneLayoutProps {
  left: ReactNode
  middle: ReactNode
  right: ReactNode
}

export function ThreePaneLayout({ left, middle, right }: ThreePaneLayoutProps) {
  return (
    <Group orientation="horizontal" className="three-pane">
      <Panel id="sessions" data-testid="pane-sessions" defaultSize="18%" minSize="12%">
        <div className="pane-content">{left}</div>
      </Panel>
      <Separator className="pane-separator" />
      <Panel id="chat" data-testid="pane-chat" defaultSize="47%" minSize="30%">
        <div className="pane-content">{middle}</div>
      </Panel>
      <Separator className="pane-separator" />
      <Panel id="visualizer" data-testid="pane-visualizer" defaultSize="35%" minSize="22%">
        <div className="pane-content">{right}</div>
      </Panel>
    </Group>
  )
}
