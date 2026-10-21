import type { Services } from '../../services'
import type { HandlerMap } from './projects'

export function modelsHandlers(s: Services): HandlerMap {
  const r = s.registry
  return {
    'models:get': async () => r.view(),
    'models:addEndpoint': (req) => r.addEndpoint(req),
    'models:updateEndpoint': ({ id, patch }) => r.updateEndpoint(id, patch),
    'models:removeEndpoint': ({ id }) => r.removeEndpoint(id),
    'models:setApiKey': ({ endpointId, key }) => r.setApiKey(endpointId, key),
    'models:addModel': (req) => r.addModel(req),
    'models:updateModel': ({ id, patch }) => r.updateModel(id, patch),
    'models:removeModel': ({ id }) => r.removeModel(id),
    'models:assignRole': ({ role, modelId }) => r.assignRole(role, modelId)
  }
}
