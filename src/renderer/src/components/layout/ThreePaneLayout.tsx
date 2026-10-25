import type { ReactNode } from 'react'
import { Group, Panel, Separator } from 'react-resizable-panels'

export interface ThreePaneLayoutProps {
  left: ReactNode
  middle: ReactNode
  right: ReactNode
  /** The top bar over the chat and the visualizer, on the frame like the sidebar. */
  header?: ReactNode
}

/**
 * The window: the sessions sidebar and the top bar share one tinted frame (an L), and the chat and the visualizer sit
 * on one white sheet inside it. Sizes in numbers are pixels, so the sidebar keeps its width when the window grows.
 */
export function ThreePaneLayout({ left, middle, right, header }: ThreePaneLayoutProps) {
  return (
    <Group orientation="horizontal" className="three-pane">
      <Panel id="sessions" data-testid="pane-sessions" defaultSize={248} minSize={200} maxSize={380} groupResizeBehavior="preserve-pixel-size">
        <div className="pane-content pane-sidebar">{left}</div>
      </Panel>
      <Separator className="pane-separator pane-separator-frame" />
      <Panel id="workspace" minSize="40%" style={{ overflow: 'hidden' }}>
        <div className="workspace">
          {header !== undefined && <header className="top-bar">{header}</header>}
          <div className="sheet">
            <Group orientation="horizontal" className="sheet-panes">
              <Panel id="chat" data-testid="pane-chat" defaultSize="56%" minSize="34%">
                <div className="pane-content pane-chat">{middle}</div>
              </Panel>
              <Separator className="pane-separator pane-separator-sheet" />
              <Panel id="visualizer" data-testid="pane-visualizer" defaultSize="44%" minSize="26%">
                <div className="pane-content pane-visualizer">{right}</div>
              </Panel>
            </Group>
          </div>
        </div>
      </Panel>
    </Group>
  )
}
