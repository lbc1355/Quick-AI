import { normalizeProviderModelCatalog } from './modelCatalog'
import type { ApiProvider } from './types'
import type { ProviderRegistration } from './providerRegistry'

export function createProviderFromRegistration(
  item: ProviderRegistration,
  options: { id?: string; name?: string } = {}
): ApiProvider {
  const { definition, accountDefaults, runtime } = item
  return normalizeProviderModelCatalog({
    id: options.id || `provider-${definition.type}`,
    name: options.name || definition.name,
    type: definition.type,
    apiKey: '',
    apiUrl: accountDefaults.apiUrl,
    authType: accountDefaults.authType,
    authHeader: accountDefaults.authHeader,
    headers: { ...(accountDefaults.headers || {}) },
    model: definition.defaultModel,
    modelsList: [...definition.models],
    endpointType: runtime.endpointType,
    transportId: runtime.transportId,
    apiFormat: runtime.apiFormat,
    features: { ...runtime.features },
    compatibility: { ...runtime.compatibility },
    promptProfile: runtime.promptProfile
  })
}
