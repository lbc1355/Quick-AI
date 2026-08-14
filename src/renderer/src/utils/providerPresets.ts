import type { ApiProvider, AppSettings } from '../../../shared/types'
import { normalizeProviderModelCatalog } from '../../../shared/modelCatalog'
import {
  CORE_PROVIDER_TYPES,
  getProviderRegistration,
  getRegisteredProviderAuthType,
  type ProviderRegistration
} from '../../../shared/providerRegistry'
import { createProviderFromRegistration } from '../../../shared/providerFactory'

export const PROVIDER_PRESET_VERSION = 4

const RETIRED_DEEPSEEK_MODEL_IDS = new Set(['deepseek-chat', 'deepseek-reasoner'])

const normalizeApiUrl = (value: string): string => value.trim().replace(/\/+$/, '').toLowerCase()

const migrateOfficialDeepSeekV4Preset = (provider: ApiProvider): ApiProvider => {
  const registration = getProviderRegistration('deepseek')
  if (
    !registration ||
    provider.type !== 'deepseek' ||
    normalizeApiUrl(provider.apiUrl) !== normalizeApiUrl(registration.accountDefaults.apiUrl || '')
  ) {
    return provider
  }

  const existingModelIds = provider.modelsList?.length
    ? provider.modelsList
    : Object.keys(provider.models || {})
  const modelsList = Array.from(
    new Set([
      ...registration.definition.models,
      ...existingModelIds.filter((id) => !RETIRED_DEEPSEEK_MODEL_IDS.has(id))
    ])
  )
  const model = RETIRED_DEEPSEEK_MODEL_IDS.has(provider.model)
    ? registration.definition.defaultModel
    : provider.model

  return { ...provider, model, modelsList }
}

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

  const migratedProviders = shouldInstallCorePresets
    ? providers.map(migrateOfficialDeepSeekV4Preset)
    : providers
  changed = changed || migratedProviders.some((provider, index) => provider !== providers[index])

  const normalizedProviders = migratedProviders.map((provider) => {
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
