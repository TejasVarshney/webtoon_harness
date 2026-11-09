import type { ReactNode } from 'react'
import { Group, Panel, Separator } from 'react-resizable-panels'

export interface WorkspaceLayoutProps {
  /** The visualizer: the webtoon strip and the studios. Sits on the left, where the reader looks first. */
  left: ReactNode
  /** The chat with its sessions. */
  right: ReactNode
  /** The top bar over both panes, on the frame. */
  header?: ReactNode
  /** Drawn over both panes, on the sheet (editing mode). The panes under it stay mounted but inert. */
  overlay?: ReactNode
}

/** The window: a tinted frame holding the top bar, and one white sheet under it split into the visualizer and the chat. */
export function WorkspaceLayout({ left, right, header, overlay }: WorkspaceLayoutProps) {
  const covered = overlay !== undefined && overlay !== null
  return (
    <div className="workspace">
      {header !== undefined && <header className="top-bar">{header}</header>}
      <div className="sheet">
        <Group orientation="horizontal" className="sheet-panes" inert={covered}>
          <Panel id="visualizer" data-testid="pane-visualizer" defaultSize="60%" minSize="40%">
            <div className="pane-content pane-visualizer">{left}</div>
          </Panel>
          <Separator className="pane-separator pane-separator-sheet" />
          <Panel id="chat" data-testid="pane-chat" defaultSize="40%" minSize="26%">
            <div className="pane-content pane-chat">{right}</div>
          </Panel>
        </Group>
        {covered && <div className="sheet-overlay">{overlay}</div>}
      </div>
    </div>
  )
}
