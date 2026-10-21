import type { ToolCall, ToolResult } from '@shared/types'
import { assetUrl } from '@shared/asset-url'
import { useAppStore } from '../../stores/app-store'

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

export function ToolCallCard({ call, result, projectId }: ToolCallCardProps) {
  const status = result === undefined ? 'running' : result.ok ? 'ok' : 'error'
  const selectPanel = useAppStore((s) => s.selectPanel)
  return (
    <div className="tool-card" data-testid="tool-card" data-status={status}>
      <details>
        <summary>
          <span className="tool-name">{call.name}</span>
          <span className="tool-summary">{summarize(call.input)}</span>
          <span className={`tool-status tool-status-${status}`}>{status === 'running' ? 'running...' : status}</span>
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
                if (panelId) selectPanel(panelId)
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
