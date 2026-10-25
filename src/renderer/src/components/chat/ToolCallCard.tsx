import { Check, ChevronRight, CircleAlert, LoaderCircle } from 'lucide-react'
import type { ToolCall, ToolResult } from '@shared/types'
import { assetUrl } from '@shared/asset-url'
import { usePanelsStore } from '../../stores/panels-store'

const PANEL_PATH = /^panels\/(pnl_[A-Za-z0-9]+)\//

function summarize(input: unknown): string {
  let text: string
  try {
    text = typeof input === 'string' ? input : (JSON.stringify(input) ?? '')
  } catch {
    text = String(input)
  }
  return text.length > 80 ? `${text.slice(0, 77)}...` : text
}

export interface ToolCallCardProps {
  call: ToolCall
  /** Absent while the tool is still running. */
  result: ToolResult | undefined
  projectId: string | null
}

const STATUS_ICON = {
  running: <LoaderCircle size={14} className="spin" aria-hidden="true" />,
  ok: <Check size={14} aria-hidden="true" />,
  error: <CircleAlert size={14} aria-hidden="true" />
}

/** One tool call as a single line (status, tool, input) that opens to its result, with any images it made below. */
export function ToolCallCard({ call, result, projectId }: ToolCallCardProps) {
  const status = result === undefined ? 'running' : result.ok ? 'ok' : 'error'
  return (
    <div className="tool-card" data-testid="tool-card" data-status={status}>
      <details>
        <summary>
          <span className={`tool-status tool-status-${status}`} title={status}>
            {STATUS_ICON[status]}
            <span className="visually-hidden">{status === 'running' ? 'running...' : status}</span>
          </span>
          <span className="tool-name">{call.name}</span>
          <span className="tool-summary">{summarize(call.input)}</span>
          <ChevronRight size={14} className="tool-chevron" aria-hidden="true" />
        </summary>
        <pre className="tool-body">{result === undefined ? 'Waiting for the result...' : result.content}</pre>
      </details>
      {result !== undefined && projectId !== null && result.images.length > 0 && (
        <div className="tool-images">
          {result.images.map((rel) => (
            <button
              key={rel}
              type="button"
              className="tool-image"
              data-testid="tool-image"
              aria-label={`Open ${rel}`}
              onClick={() => {
                const panelId = PANEL_PATH.exec(rel)?.[1]
                // The panel may be in another episode than the one shown; showPanel opens it first.
                if (panelId) void usePanelsStore.getState().showPanel(panelId)
              }}
            >
              <img src={assetUrl(projectId, rel)} alt="" />
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
