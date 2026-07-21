import type { ApiProvider, AppSettings } from '../../../shared/types'
import { normalizeProviderModelCatalog } from '../../../shared/modelCatalog'
import {
  CORE_PROVIDER_TYPES,
  createProviderFromRegistration,
  getProviderRegistration,
  getRegisteredProviderAuthType,
  type ProviderRegistration
} from '../../../shared/providerRegistry'

export const PROVIDER_PRESET_VERSION = 3

const providerMatchesRegistration = (
  provider: ApiProvider,
  registration: ProviderRegistration
): boolean => {
  const { definition, accountDefaults } = registration
  if (provider.type === definition.type) return true
  if (provider.name.trim().toLowerCase() === definition.name.toLowerCase()) return true
  if (
    accountDefaults.apiUrl &&
    provider.apiUrl.trim().toLowerCase() === accountDefaults.apiUrl.toLowerCase()
  ) {
    return true
  }
  return false
}

export function ensureCoreProviderPresets(settings: AppSettings): {
  settings: AppSettings
  changed: boolean
} {
  const shouldInstallCorePresets = (settings.providerPresetVersion || 0) < PROVIDER_PRESET_VERSION
  const providers = [...(settings.providers || [])]
  let changed = false

  if (shouldInstallCorePresets) {
    for (const type of CORE_PROVIDER_TYPES) {
      const registration = getProviderRegistration(type)
      if (!registration) continue
      const exists = providers.some((provider) =>
        providerMatchesRegistration(provider, registration)
      )
      if (!exists) {
        providers.push(createProviderFromRegistration(registration))
        changed = true
      }
    }
  }

  const activeProviderId =
    settings.activeProviderId &&
    providers.some((provider) => provider.id === settings.activeProviderId)
      ? settings.activeProviderId
      : providers[0]?.id || ''

  const normalizedProviders = providers.map((provider) => {
    const normalized = normalizeProviderModelCatalog(provider)
    return {
      ...normalized,
      authType: normalized.authType || getRegisteredProviderAuthType(normalized.type)
    }
  })
  changed =
    changed ||
    normalizedProviders.some((provider, index) => {
      const original = providers[index]
      return (
        !original ||
        original.endpointType !== provider.endpointType ||
        original.authType !== provider.authType ||
        JSON.stringify(original.models || {}) !== JSON.stringify(provider.models || {}) ||
        JSON.stringify(original.modelContextWindows || {}) !==
          JSON.stringify(provider.modelContextWindows || {})
      )
    })

  const nextSettings: AppSettings = {
    ...settings,
    providers: normalizedProviders,
    activeProviderId,
    providerPresetVersion: PROVIDER_PRESET_VERSION
  }

  return {
    settings: nextSettings,
    changed:
      changed ||
      activeProviderId !== settings.activeProviderId ||
      settings.providerPresetVersion !== PROVIDER_PRESET_VERSION
  }
}
