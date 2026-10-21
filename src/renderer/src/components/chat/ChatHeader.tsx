import { useModelsStore } from '../../stores/models-store'
import { ModelPicker } from './ModelPicker'

export const MOCK_BANNER_TEXT = "You're using the offline mock model. Add a real endpoint in Settings → Models."

export function ChatHeader() {
  const view = useModelsStore((s) => s.view)
  const agentModelId = view?.effectiveRoles.agent ?? null
  const agentModel = view?.models.find((m) => m.id === agentModelId)
  const onMock = view?.endpoints.find((e) => e.id === agentModel?.endpointId)?.kind === 'mock'

  return (
    <div className="chat-header">
      <ModelPicker />
      {onMock && (
        <p className="mock-banner" data-testid="mock-banner">
          {MOCK_BANNER_TEXT}
        </p>
      )}
    </div>
  )
}
