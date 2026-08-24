import React, { useState, useEffect, useRef } from 'react'
import { useToast } from '../contexts/ToastContext'
import {
  ApiProvider,
  AppSettings,
  ContextRetentionMode,
  FetchedModelInfo,
  WebSearchProviderType,
  ApiKeyItem,
  ProviderAuthType,
  ProviderApiFormat,
  ModelPromptProfile,
  ModelInfo,
  ModelReasoningControl,
  ModelCompatibilityProfile,
  ReasoningPreference,
  ResolvedProviderConnection,
  ProviderModelDiscoveryCache,
  ProviderModelDiscoveryRequest,
  ProviderConnectionTestResult
} from '../../../shared/types'
import { normalizeContextWindowTokens } from '../../../shared/modelContext'
import {
  createModelInfo,
  normalizeProviderModelCatalog,
  normalizeProvidersModelCatalog
} from '../../../shared/modelCatalog'
import {
  normalizeProviderApiKeys,
  getActiveProviderApiKey
} from '../../../shared/providerKeyHelper'
import { ensureCoreProviderPresets } from '../utils/providerPresets'
import {
  getProviderRegistration,
  getRegisteredProviderAuthType
} from '../../../shared/providerRegistry'
import { createProviderFromRegistration } from '../../../shared/providerFactory'
import {
  mergeDiscoveredModelMetadata,
  resolveProviderModelDiscoveryUrl
} from '../../../shared/providerModelDiscovery'
import {
  canRefreshProviderModelsInBackground,
  completeProviderModelDiscovery,
  failProviderModelDiscovery,
  getCachedProviderModels,
  shouldRefreshProviderModels
} from '../../../shared/providerModelDiscoveryCache'
import { getProviderAccount, resolveProviderConnection } from '../../../shared/providerConfig'
import {
  isValidProviderAuthHeader,
  ProviderHeaderItem,
  providerHeaderItemsToRecord,
  providerHeadersToItems
} from '../utils/providerHeaderEditor'

const getPreferredModelDiscoveryUrl = (provider: ApiProvider): string =>
  provider.modelDiscovery?.sourceUrl ||
  resolveProviderModelDiscoveryUrl(provider.type, provider.apiUrl || '')

const createStoredProviderDiscoveryRequest = (
  provider: ApiProvider
): ProviderModelDiscoveryRequest => ({
  fetchUrl: getPreferredModelDiscoveryUrl(provider),
  providerType: provider.type,
  providerConnection: resolveProviderConnection(getProviderAccount(provider)),
  ...(provider.defaultReasoningControl
    ? { defaultReasoningControl: provider.defaultReasoningControl }
    : {})
})

export interface UseProvidersReturn {
  apiKey: string
  setApiKey: React.Dispatch<React.SetStateAction<string>>
  apiUrl: string
  setApiUrl: React.Dispatch<React.SetStateAction<string>>
  selectedModel: string
  setSelectedModel: React.Dispatch<React.SetStateAction<string>>
  modelsList: string[]
  setModelsList: React.Dispatch<React.SetStateAction<string[]>>
  modelContextWindows: Record<string, number>
  setModelContextWindows: React.Dispatch<React.SetStateAction<Record<string, number>>>
  systemPrompt: string
  setSystemPrompt: React.Dispatch<React.SetStateAction<string>>
  autoHideOnBlur: boolean
  setAutoHideOnBlur: React.Dispatch<React.SetStateAction<boolean>>
  contextRetentionMode: ContextRetentionMode
  setContextRetentionMode: React.Dispatch<React.SetStateAction<ContextRetentionMode>>
  reasoningDefaults: Record<string, ReasoningPreference>
  setReasoningDefault: (key: string, value: ReasoningPreference) => Promise<void>
  appStorePath: string
  saveSuccess: boolean
  theme: 'dark' | 'light'
  setTheme: React.Dispatch<React.SetStateAction<'dark' | 'light'>>
  toggleTheme: () => void
  providers: ApiProvider[]
  setProviders: React.Dispatch<React.SetStateAction<ApiProvider[]>>
  activeProviderId: string
  setActiveProviderId: React.Dispatch<React.SetStateAction<string>>
  editingProviderId: string
  setEditingProviderId: React.Dispatch<React.SetStateAction<string>>
  isEditingProviderDetail: boolean
  setIsEditingProviderDetail: React.Dispatch<React.SetStateAction<boolean>>
  showAddForm: boolean
  setShowAddForm: React.Dispatch<React.SetStateAction<boolean>>
  newProviderName: string
  setNewProviderName: React.Dispatch<React.SetStateAction<string>>
  newProviderType: ApiProvider['type']
  setNewProviderType: React.Dispatch<React.SetStateAction<ApiProvider['type']>>
  manualModelInput: string
  setManualModelInput: React.Dispatch<React.SetStateAction<string>>
  fetchModelsUrl: string
  setFetchModelsUrl: React.Dispatch<React.SetStateAction<string>>
  isFetchingModels: boolean
  isTestingProviderConnection: boolean
  providerConnectionTest?: ProviderConnectionTestResult
  refreshingModelContextId: string | null
  fetchedModels: FetchedModelInfo[]
  showModelsModal: boolean
  setShowModelsModal: React.Dispatch<React.SetStateAction<boolean>>
  apiKeys: ApiKeyItem[]
  setApiKeys: React.Dispatch<React.SetStateAction<ApiKeyItem[]>>
  activeApiKeyId: string
  setActiveApiKeyId: React.Dispatch<React.SetStateAction<string>>
  providerAuthType: ProviderAuthType
  setProviderAuthType: React.Dispatch<React.SetStateAction<ProviderAuthType>>
  providerAuthHeader: string
  setProviderAuthHeader: React.Dispatch<React.SetStateAction<string>>
  providerHeaders: ProviderHeaderItem[]
  handleAddProviderHeader: () => void
  handleChangeProviderHeader: (id: string, field: 'name' | 'value', value: string) => void
  handleDeleteProviderHeader: (id: string) => void
  handleSelectApiKey: (id: string) => void
  handleChangeApiKeyItemName: (id: string, name: string) => void
  handleChangeApiKeyValue: (id: string, value: string) => void
  handleAddApiKey: () => void
  handleDeleteApiKey: (id: string) => void
  handleApiUrlChange: (newUrl: string) => void
  handleSaveGlobalSettings: () => Promise<void>
  handleSaveProviderDetails: () => Promise<void>
  handleAddProvider: (name: string, type: ApiProvider['type']) => Promise<void>
  handleSetActiveProvider: (id: string) => Promise<void>
  handleStartEditingProvider: (id: string) => void
  handleDeleteProvider: (id: string) => Promise<void>
  handleChangeEditingProviderName: (name: string) => void
  handleChangeEditingProviderApiFormat: (format: ProviderApiFormat) => void
  handleChangeEditingProviderPromptProfile: (profile?: ModelPromptProfile) => void
  handleChangeEditingProviderDefaultReasoningControl: (
    control: ModelReasoningControl | undefined
  ) => void
  handleChangeEditingModelAdvancedConfig: (
    modelId: string,
    config: {
      requestBodyOverrides?: Record<string, unknown>
      reasoningControlOverride?: ModelReasoningControl
      reasoningResponseFormat?: ModelCompatibilityProfile['reasoningResponseFormat']
    }
  ) => void
  handleAddManualModel: () => void
  handleFetchModels: () => Promise<void>
  handleTestProviderConnection: () => Promise<void>
  handleRefreshModelContext: (modelId: string) => Promise<void>
  handleRemoveModelDirectly: (modelId: string) => void
  handleToggleModelSelection: (model: FetchedModelInfo) => void
  handleChangeModelContextWindow: (modelId: string, value: string) => void
  resetLocalSettings: () => void
  permissions: Record<string, 'allow' | 'ask' | 'deny'>
  onChangeToolPermission: (toolName: string, policy: 'allow' | 'ask' | 'deny') => void
  webSearchProvider: WebSearchProviderType
  setWebSearchProvider: React.Dispatch<React.SetStateAction<WebSearchProviderType>>
  webSearchApiKey: string
  setWebSearchApiKey: React.Dispatch<React.SetStateAction<string>>
}

export const useProviders = (): UseProvidersReturn => {
  const toast = useToast()
  // Settings state
  const [apiKey, setApiKey] = useState('')
  const [apiUrl, setApiUrl] = useState('https://opencode.ai/zen/v1')
  const [selectedModel, setSelectedModel] = useState('deepseek-v4-flash-free')
  const [modelsList, setModelsList] = useState<string[]>([
    'deepseek-v4-flash-free',
    'deepseek-v4-pro',
    'qwen3-coder-plus'
  ])
  const [modelContextWindows, setModelContextWindows] = useState<Record<string, number>>({})
  const [systemPrompt, setSystemPrompt] = useState('')
  const [autoHideOnBlur, setAutoHideOnBlur] = useState(true)
  const [contextRetentionMode, setContextRetentionMode] = useState<ContextRetentionMode>('default')
  const [reasoningDefaults, setReasoningDefaults] = useState<Record<string, ReasoningPreference>>(
    {}
  )
  const [appStorePath, setAppStorePath] = useState('')
  const [saveSuccess, setSaveSuccess] = useState(false)
  const [theme, setTheme] = useState<'dark' | 'light'>('dark')
  const [permissions, setPermissions] = useState<Record<string, 'allow' | 'ask' | 'deny'>>({})
  const [webSearchProvider, setWebSearchProvider] = useState<WebSearchProviderType>('auto')
  const [webSearchApiKey, setWebSearchApiKey] = useState('')

  // Providers list state
  const [providers, setProviders] = useState<ApiProvider[]>([])
  const [activeProviderId, setActiveProviderId] = useState<string>('')
  const [editingProviderId, setEditingProviderId] = useState<string>('')
  const [isEditingProviderDetail, setIsEditingProviderDetail] = useState(false)

  // API keys editing states
  const [apiKeys, setApiKeys] = useState<ApiKeyItem[]>([])
  const [activeApiKeyId, setActiveApiKeyId] = useState<string>('')
  const [providerAuthType, setProviderAuthType] = useState<ProviderAuthType>('bearer')
  const [providerAuthHeader, setProviderAuthHeader] = useState('X-API-Key')
  const [providerHeaders, setProviderHeaders] = useState<ProviderHeaderItem[]>([])

  // Add provider form states
  const [showAddForm, setShowAddForm] = useState(false)
  const [newProviderName, setNewProviderName] = useState('')
  const [newProviderType, setNewProviderType] = useState<ApiProvider['type']>('opencode')

  // Model Management inputs state
  const [manualModelInput, setManualModelInput] = useState('')
  const [fetchModelsUrl, setFetchModelsUrl] = useState('https://opencode.ai/zen/v1/models')
  const [isFetchingModels, setIsFetchingModels] = useState(false)
  const [isTestingProviderConnection, setIsTestingProviderConnection] = useState(false)
  const [providerConnectionTest, setProviderConnectionTest] =
    useState<ProviderConnectionTestResult>()
  const connectionTestRequestId = useRef(0)
  const [refreshingModelContextId, setRefreshingModelContextId] = useState<string | null>(null)
  const [fetchedModels, setFetchedModels] = useState<FetchedModelInfo[]>([])
  const [showModelsModal, setShowModelsModal] = useState(false)

  const applyProviderModelDiscoveryCache = (
    providerId: string,
    cache: ProviderModelDiscoveryCache,
    updateVisibleModels = true
  ): void => {
    setProviders((previous) =>
      previous.map((provider) =>
        provider.id === providerId ? { ...provider, modelDiscovery: cache } : provider
      )
    )
    if (updateVisibleModels) {
      setFetchedModels(getCachedProviderModels(cache, cache.sourceUrl))
    }
    void window.api
      .setProviderModelDiscoveryCache(providerId, cache)
      .then((saved) => {
        if (!saved)
          console.warn(`Provider account not found while saving model cache: ${providerId}`)
      })
      .catch((error: unknown) => {
        console.error('Failed to persist provider model discovery cache:', error)
      })
  }

  useEffect(() => {
    const provider = providers.find((item) => item.id === editingProviderId)
    if (!provider) {
      setFetchedModels([])
      return
    }
    const sourceUrl = fetchModelsUrl.trim() || getPreferredModelDiscoveryUrl(provider)
    setFetchedModels(getCachedProviderModels(provider.modelDiscovery, sourceUrl))
  }, [editingProviderId, fetchModelsUrl, providers])

  useEffect(() => {
    connectionTestRequestId.current += 1
    setIsTestingProviderConnection(false)
    setProviderConnectionTest(undefined)
  }, [
    apiKey,
    editingProviderId,
    fetchModelsUrl,
    providerAuthHeader,
    providerAuthType,
    providerHeaders
  ])

  // Load configuration and data on startup
  useEffect(() => {
    const initSettings = async (): Promise<void> => {
      // Settings
      const savedSettings = (await window.api.storeGet('settings')) as AppSettings
      if (savedSettings) {
        const { settings: upgradedSettings, changed } = ensureCoreProviderPresets(savedSettings)
        if (changed) {
          await window.api.storeSet('settings', upgradedSettings)
        }

        const loadedProviders = normalizeProvidersModelCatalog(
          upgradedSettings.providers || []
        ).map((p) => normalizeProviderApiKeys(p))
        const loadedActiveId = upgradedSettings.activeProviderId || ''
        setProviders(loadedProviders)
        setActiveProviderId(loadedActiveId)
        setEditingProviderId(loadedActiveId)

        // Find active provider
        const activeProv =
          loadedProviders.find((p) => p.id === loadedActiveId) || loadedProviders[0]
        if (activeProv) {
          setApiKey(getActiveProviderApiKey(activeProv))
          setApiUrl(activeProv.apiUrl || '')
          setProviderAuthType(activeProv.authType || getRegisteredProviderAuthType(activeProv.type))
          setProviderAuthHeader(activeProv.authHeader || 'X-API-Key')
          setProviderHeaders(providerHeadersToItems(activeProv.headers))
          setSelectedModel(activeProv.model || '')
          setModelsList(activeProv.modelsList || [])
          setModelContextWindows(activeProv.modelContextWindows || {})
          const discoveryRequest = createStoredProviderDiscoveryRequest(activeProv)
          setFetchModelsUrl(discoveryRequest.fetchUrl)
          setFetchedModels(
            getCachedProviderModels(activeProv.modelDiscovery, discoveryRequest.fetchUrl)
          )
          if (
            shouldRefreshProviderModels(activeProv.modelDiscovery, discoveryRequest.fetchUrl) &&
            canRefreshProviderModelsInBackground(discoveryRequest)
          ) {
            void window.api
              .fetchModels(discoveryRequest)
              .then(
                (models) => {
                  if (models.length === 0) {
                    throw new Error('Provider returned an empty model catalog')
                  }
                  applyProviderModelDiscoveryCache(
                    activeProv.id,
                    completeProviderModelDiscovery(discoveryRequest.fetchUrl, models),
                    false
                  )
                },
                (error: unknown) => {
                  applyProviderModelDiscoveryCache(
                    activeProv.id,
                    failProviderModelDiscovery(
                      activeProv.modelDiscovery,
                      discoveryRequest.fetchUrl,
                      error
                    ),
                    false
                  )
                }
              )
              .catch((error: unknown) => {
                applyProviderModelDiscoveryCache(
                  activeProv.id,
                  failProviderModelDiscovery(
                    activeProv.modelDiscovery,
                    discoveryRequest.fetchUrl,
                    error
                  ),
                  false
                )
              })
          }
        }

        setSystemPrompt(upgradedSettings.systemPrompt || '')
        setAutoHideOnBlur(upgradedSettings.autoHideOnBlur !== false)
        setContextRetentionMode(
          upgradedSettings.contextRetentionMode === 'cache-priority' ? 'cache-priority' : 'default'
        )
        setReasoningDefaults(upgradedSettings.reasoningDefaults || {})
        setTheme(upgradedSettings.theme || 'dark')
        setWebSearchProvider(upgradedSettings.webSearch?.provider || 'auto')
        setWebSearchApiKey(upgradedSettings.webSearch?.apiKey || '')
        setPermissions(
          upgradedSettings.permissions || {
            fetch_url: 'allow',
            click_link: 'allow',
            find_in_page: 'allow',
            web_search: 'allow',
            workspace_list_files: 'allow',
            workspace_search: 'ask',
            file_read: 'ask',
            file_write: 'ask',
            shell: 'deny'
          }
        )
      }

      // App metadata
      const info = await window.api.getAppInfo()
      setAppStorePath(info.storePath)
    }

    initSettings()
  }, [])

  const resetLocalSettings = (): void => {
    if (activeProviderId && providers.length > 0) {
      const activeProv = providers.find((p) => p.id === activeProviderId)
      if (activeProv) {
        const withKeys = normalizeProviderApiKeys(activeProv)
        setApiKeys(withKeys.apiKeys || [])
        setActiveApiKeyId(withKeys.activeApiKeyId || '')
        setApiKey(getActiveProviderApiKey(withKeys))
        setApiUrl(activeProv.apiUrl || '')
        setProviderAuthType(activeProv.authType || getRegisteredProviderAuthType(activeProv.type))
        setProviderAuthHeader(activeProv.authHeader || 'X-API-Key')
        setProviderHeaders(providerHeadersToItems(activeProv.headers))
        setSelectedModel(activeProv.model || '')
        setModelsList(activeProv.modelsList || [])
        setModelContextWindows(activeProv.modelContextWindows || {})
        setFetchModelsUrl(getPreferredModelDiscoveryUrl(activeProv))
        setEditingProviderId(activeProviderId)
      }
    }
  }

  // Update fetch models URL when API URL changes
  const handleApiUrlChange = (newUrl: string): void => {
    setApiUrl(newUrl)
    const providerType = providers.find((provider) => provider.id === editingProviderId)?.type
    setFetchModelsUrl(resolveProviderModelDiscoveryUrl(providerType || 'custom', newUrl))
  }

  const handleSaveGlobalSettings = async (): Promise<void> => {
    const savedSettings = (await window.api.storeGet('settings')) as AppSettings
    if (savedSettings) {
      savedSettings.systemPrompt = systemPrompt
      savedSettings.autoHideOnBlur = autoHideOnBlur
      savedSettings.contextRetentionMode = contextRetentionMode
      savedSettings.reasoningDefaults = reasoningDefaults
      savedSettings.theme = theme
      savedSettings.permissions = permissions
      savedSettings.webSearch = {
        provider: webSearchProvider,
        apiKey: webSearchApiKey.trim()
      }
      await window.api.storeSet('settings', savedSettings)
      setSaveSuccess(true)
      setTimeout(() => setSaveSuccess(false), 2000)
    }
  }

  const setReasoningDefault = async (key: string, value: ReasoningPreference): Promise<void> => {
    const next = { ...reasoningDefaults, [key]: value }
    setReasoningDefaults(next)
    const savedSettings = ((await window.api.storeGet('settings')) as AppSettings) || {}
    savedSettings.reasoningDefaults = next
    await window.api.storeSet('settings', savedSettings)
  }

  const onChangeToolPermission = (toolName: string, policy: 'allow' | 'ask' | 'deny'): void => {
    setPermissions((prev) => ({
      ...prev,
      [toolName]: policy
    }))
  }

  const handleSaveProviderDetails = async (): Promise<void> => {
    if (modelsList.length === 0) {
      toast.warning('模型列表不能为空，请至少添加一个模型！')
      return
    }
    if (!selectedModel) {
      toast.warning('未选择默认模型，请先选择一个默认模型！')
      return
    }
    const sanitizedContextWindows: Record<string, number> = {}
    for (const model of modelsList) {
      const value = modelContextWindows[model]
      if (value === undefined) continue
      const normalized = normalizeContextWindowTokens(value)
      if (!normalized) {
        toast.warning(`模型 ${model} 的上下文长度需要在 2,000 到 10,000,000 tokens 之间。`)
        return
      }
      sanitizedContextWindows[model] = normalized
    }
    const headerResult = providerHeaderItemsToRecord(providerHeaders)
    if (headerResult.error) {
      toast.warning(headerResult.error)
      return
    }
    const normalizedAuthHeader = providerAuthHeader.trim()
    if (providerAuthType === 'header' && !isValidProviderAuthHeader(normalizedAuthHeader)) {
      toast.warning('鉴权 Header 名称无效。')
      return
    }
    const savedSettings = (await window.api.storeGet('settings')) as AppSettings
    if (savedSettings) {
      // Find the active key value to sync legacy apiKey string
      const currentActiveKey = apiKeys.find((k) => k.id === activeApiKeyId)
      const activeKeyVal = currentActiveKey ? currentActiveKey.value : ''

      savedSettings.providers = providers.map((p) => {
        if (p.id === editingProviderId) {
          return mergeDiscoveredModelMetadata(
            {
              ...p,
              apiKey: activeKeyVal,
              apiKeys,
              activeApiKeyId,
              apiUrl,
              authType: providerAuthType,
              authHeader: providerAuthType === 'header' ? normalizedAuthHeader : undefined,
              headers: headerResult.headers,
              model: selectedModel,
              modelsList,
              modelContextWindows: sanitizedContextWindows
            },
            fetchedModels
          )
        }
        return p
      })
      await window.api.storeSet('settings', savedSettings)
      setProviders(savedSettings.providers)
      setModelContextWindows(sanitizedContextWindows)
      toast.success('服务商配置已保存！')
    }
  }

  const handleAddProvider = async (name: string, type: ApiProvider['type']): Promise<void> => {
    const registration = getProviderRegistration(type)
    const customName = name.trim() || registration?.definition.name || `${type.toUpperCase()}-配置`
    const newId = `provider-custom-${Date.now()}`
    const newProv: ApiProvider = registration
      ? createProviderFromRegistration(registration, { id: newId, name: customName })
      : normalizeProviderModelCatalog({
          id: newId,
          name: customName,
          type,
          apiKey: '',
          apiUrl: '',
          authType: 'bearer',
          model: '',
          modelsList: [],
          modelContextWindows: {}
        })
    const withKeys = normalizeProviderApiKeys(newProv)
    const updated = [...providers, withKeys]
    setProviders(updated)
    const savedSettings = (await window.api.storeGet('settings')) as AppSettings
    if (savedSettings) {
      savedSettings.providers = updated
      await window.api.storeSet('settings', savedSettings)
    }

    // Switch editing to the new provider and open the edit sub-page
    setEditingProviderId(newId)
    setApiKeys(withKeys.apiKeys || [])
    setActiveApiKeyId(withKeys.activeApiKeyId || '')
    setApiKey('')
    setApiUrl(registration?.accountDefaults.apiUrl || '')
    setProviderAuthType(registration?.accountDefaults.authType || 'bearer')
    setProviderAuthHeader(registration?.accountDefaults.authHeader || 'X-API-Key')
    setProviderHeaders(providerHeadersToItems(registration?.accountDefaults.headers))
    setSelectedModel(registration?.definition.defaultModel || '')
    setModelsList(registration ? [...registration.definition.models] : [])
    setModelContextWindows({})
    setFetchModelsUrl(
      resolveProviderModelDiscoveryUrl(type, registration?.accountDefaults.apiUrl || '')
    )
    setIsEditingProviderDetail(true)
  }

  const handleSetActiveProvider = async (id: string): Promise<void> => {
    setActiveProviderId(id)
    setEditingProviderId(id)
    const target = providers.find((p) => p.id === id)
    if (target) {
      const withKeys = normalizeProviderApiKeys(target)
      setApiKeys(withKeys.apiKeys || [])
      setActiveApiKeyId(withKeys.activeApiKeyId || '')
      setApiKey(getActiveProviderApiKey(withKeys))
      setApiUrl(target.apiUrl || '')
      setProviderAuthType(target.authType || getRegisteredProviderAuthType(target.type))
      setProviderAuthHeader(target.authHeader || 'X-API-Key')
      setProviderHeaders(providerHeadersToItems(target.headers))
      setSelectedModel(target.model || '')
      setModelsList(target.modelsList || [])
      setModelContextWindows(target.modelContextWindows || {})
      setFetchModelsUrl(getPreferredModelDiscoveryUrl(target))
    }
    const savedSettings = (await window.api.storeGet('settings')) as AppSettings
    if (savedSettings) {
      savedSettings.activeProviderId = id
      await window.api.storeSet('settings', savedSettings)
    }
  }

  const handleStartEditingProvider = (id: string): void => {
    setEditingProviderId(id)
    const target = providers.find((p) => p.id === id)
    if (target) {
      const withKeys = normalizeProviderApiKeys(target)
      setApiKeys(withKeys.apiKeys || [])
      setActiveApiKeyId(withKeys.activeApiKeyId || '')
      setApiKey(getActiveProviderApiKey(withKeys))
      setApiUrl(target.apiUrl || '')
      setProviderAuthType(target.authType || getRegisteredProviderAuthType(target.type))
      setProviderAuthHeader(target.authHeader || 'X-API-Key')
      setProviderHeaders(providerHeadersToItems(target.headers))
      setSelectedModel(target.model || '')
      setModelsList(target.modelsList || [])
      setModelContextWindows(target.modelContextWindows || {})
      setFetchModelsUrl(getPreferredModelDiscoveryUrl(target))
    }
    setIsEditingProviderDetail(true)
  }

  const handleDeleteProvider = async (id: string): Promise<void> => {
    if (providers.length <= 1) return
    const updated = providers.filter((p) => p.id !== id)
    setProviders(updated)

    let nextActiveId = activeProviderId
    if (activeProviderId === id) {
      nextActiveId = updated[0].id
      setActiveProviderId(nextActiveId)
      setEditingProviderId(nextActiveId)
      const target = updated[0]
      const withKeys = normalizeProviderApiKeys(target)
      setApiKeys(withKeys.apiKeys || [])
      setActiveApiKeyId(withKeys.activeApiKeyId || '')
      setApiKey(getActiveProviderApiKey(withKeys))
      setApiUrl(target.apiUrl || '')
      setProviderAuthType(target.authType || getRegisteredProviderAuthType(target.type))
      setProviderAuthHeader(target.authHeader || 'X-API-Key')
      setProviderHeaders(providerHeadersToItems(target.headers))
      setSelectedModel(target.model || '')
      setModelsList(target.modelsList || [])
      setModelContextWindows(target.modelContextWindows || {})
      setFetchModelsUrl(getPreferredModelDiscoveryUrl(target))
    }

    const savedSettings = (await window.api.storeGet('settings')) as AppSettings
    if (savedSettings) {
      savedSettings.providers = updated
      savedSettings.activeProviderId = nextActiveId
      await window.api.storeSet('settings', savedSettings)
    }
  }

  // API key management functions
  const handleSelectApiKey = (id: string): void => {
    setActiveApiKeyId(id)
    const selected = apiKeys.find((k) => k.id === id)
    if (selected) {
      setApiKey(selected.value)
    }
  }

  const handleChangeApiKeyItemName = (id: string, name: string): void => {
    setApiKeys((prev) => prev.map((k) => (k.id === id ? { ...k, name } : k)))
  }

  const handleChangeApiKeyValue = (id: string, value: string): void => {
    setApiKeys((prev) => {
      const updated = prev.map((k) => (k.id === id ? { ...k, value } : k))
      if (id === activeApiKeyId) {
        setApiKey(value)
      }
      return updated
    })
  }

  const handleAddApiKey = (): void => {
    const newId = `key-${Date.now()}`
    const newKeys = [...apiKeys, { id: newId, name: `Key ${apiKeys.length + 1}`, value: '' }]
    setApiKeys(newKeys)
    if (!activeApiKeyId || activeApiKeyId === '') {
      setActiveApiKeyId(newId)
    }
  }

  const handleDeleteApiKey = (id: string): void => {
    if (apiKeys.length <= 1) return
    const updated = apiKeys.filter((k) => k.id !== id)
    setApiKeys(updated)
    if (activeApiKeyId === id) {
      const nextActiveId = updated[0].id
      setActiveApiKeyId(nextActiveId)
      setApiKey(updated[0].value)
    }
  }

  const handleAddProviderHeader = (): void => {
    setProviderHeaders((previous) => [
      ...previous,
      { id: `header-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, name: '', value: '' }
    ])
  }

  const handleChangeProviderHeader = (id: string, field: 'name' | 'value', value: string): void => {
    setProviderHeaders((previous) =>
      previous.map((header) => (header.id === id ? { ...header, [field]: value } : header))
    )
  }

  const handleDeleteProviderHeader = (id: string): void => {
    setProviderHeaders((previous) => previous.filter((header) => header.id !== id))
  }

  const handleAddManualModel = (): void => {
    const val = manualModelInput.trim()
    if (!val) return
    if (!modelsList.includes(val)) {
      setModelsList((prev) => [...prev, val])
    }
    setManualModelInput('')
  }

  const getEditingProviderConnection = (): ResolvedProviderConnection => {
    const headerResult = providerHeaderItemsToRecord(providerHeaders)
    if (headerResult.error) throw new Error(headerResult.error)
    const normalizedAuthHeader = providerAuthHeader.trim()
    if (providerAuthType === 'header' && !isValidProviderAuthHeader(normalizedAuthHeader)) {
      throw new Error('鉴权 Header 名称无效。')
    }
    return {
      accountId: editingProviderId || 'provider',
      providerId: editingProviderId || 'provider',
      baseUrl: apiUrl,
      auth:
        providerAuthType === 'none'
          ? { type: 'none' }
          : providerAuthType === 'header'
            ? { type: 'header', name: normalizedAuthHeader, value: apiKey }
            : { type: 'bearer', token: apiKey },
      headers: headerResult.headers || {}
    }
  }

  const getEditingProviderType = (): ApiProvider['type'] =>
    providers.find((provider) => provider.id === editingProviderId)?.type || 'custom'

  const handleFetchModels = async (): Promise<void> => {
    const url = fetchModelsUrl.trim()
    if (!url) return
    setIsFetchingModels(true)
    const editingProvider = providers.find((provider) => provider.id === editingProviderId)
    try {
      const fetched = await window.api.fetchModels({
        fetchUrl: url,
        providerType: getEditingProviderType(),
        providerConnection: getEditingProviderConnection(),
        ...(editingProvider?.defaultReasoningControl
          ? { defaultReasoningControl: editingProvider.defaultReasoningControl }
          : {})
      })
      if (fetched && fetched.length > 0) {
        if (editingProvider) {
          applyProviderModelDiscoveryCache(
            editingProvider.id,
            completeProviderModelDiscovery(url, fetched)
          )
        }
        setFetchedModels(fetched)
        setModelContextWindows((prev) => {
          const next = { ...prev }
          for (const model of fetched) {
            if (modelsList.includes(model.id) && model.contextWindowTokens) {
              next[model.id] = model.contextWindowTokens
            }
          }
          return next
        })
        setShowModelsModal(true)
      } else {
        if (editingProvider) {
          applyProviderModelDiscoveryCache(
            editingProvider.id,
            failProviderModelDiscovery(
              editingProvider.modelDiscovery,
              url,
              'Provider returned an empty model catalog'
            )
          )
        }
        toast.warning('未能获取到有效的模型列表，请检查 Base URL 或 API Key。')
      }
    } catch (e) {
      const err = e as Error
      if (editingProvider) {
        applyProviderModelDiscoveryCache(
          editingProvider.id,
          failProviderModelDiscovery(editingProvider.modelDiscovery, url, err)
        )
      }
      console.error(err)
      toast.error(`获取模型列表失败: ${err.message || err}`)
    } finally {
      setIsFetchingModels(false)
    }
  }

  const handleTestProviderConnection = async (): Promise<void> => {
    const url = fetchModelsUrl.trim()
    if (!url) return
    const requestId = connectionTestRequestId.current + 1
    connectionTestRequestId.current = requestId
    setIsTestingProviderConnection(true)
    setProviderConnectionTest(undefined)
    try {
      const result = await window.api.testProviderConnection({
        fetchUrl: url,
        providerType: getEditingProviderType(),
        providerConnection: getEditingProviderConnection()
      })
      if (connectionTestRequestId.current === requestId) {
        setProviderConnectionTest(result)
      }
    } catch (error) {
      if (connectionTestRequestId.current === requestId) {
        const checkedAt = Date.now()
        setProviderConnectionTest({
          ok: false,
          code: 'network_error',
          message: error instanceof Error ? error.message : String(error || 'Connection failed'),
          endpoint: url,
          checkedAt,
          latencyMs: 0
        })
      }
    } finally {
      if (connectionTestRequestId.current === requestId) {
        setIsTestingProviderConnection(false)
      }
    }
  }

  const findFetchedModel = (
    fetched: FetchedModelInfo[],
    modelId: string
  ): FetchedModelInfo | undefined =>
    fetched.find((model) => model.id === modelId) ||
    fetched.find((model) => model.id.toLowerCase() === modelId.toLowerCase())

  const handleRefreshModelContext = async (modelId: string): Promise<void> => {
    const url = fetchModelsUrl.trim()
    if (!url) {
      toast.warning('请先填写模型列表接口。')
      return
    }

    setRefreshingModelContextId(modelId)
    const editingProvider = providers.find((provider) => provider.id === editingProviderId)
    try {
      const fetched = await window.api.fetchModels({
        fetchUrl: url,
        providerType: getEditingProviderType(),
        providerConnection: getEditingProviderConnection(),
        ...(editingProvider?.defaultReasoningControl
          ? { defaultReasoningControl: editingProvider.defaultReasoningControl }
          : {})
      })
      if (fetched.length === 0) {
        throw new Error('Provider returned an empty model catalog')
      }
      if (editingProvider) {
        applyProviderModelDiscoveryCache(
          editingProvider.id,
          completeProviderModelDiscovery(url, fetched)
        )
      }
      setFetchedModels(fetched)
      const matched = findFetchedModel(fetched, modelId)
      if (matched?.contextWindowTokens) {
        setModelContextWindows((prev) => ({
          ...prev,
          [modelId]: matched.contextWindowTokens as number
        }))
        return
      }

      if (!matched) {
        toast.warning(`远程模型列表中没有找到 ${modelId}。`)
      } else {
        toast.warning(`服务商没有返回 ${modelId} 的上下文长度。`)
      }
    } catch (e) {
      const err = e as Error
      if (editingProvider) {
        applyProviderModelDiscoveryCache(
          editingProvider.id,
          failProviderModelDiscovery(editingProvider.modelDiscovery, url, err)
        )
      }
      console.error(err)
      toast.error(`获取 ${modelId} 的上下文长度失败: ${err.message || err}`)
    } finally {
      setRefreshingModelContextId(null)
    }
  }

  const handleRemoveModelDirectly = (modelId: string): void => {
    if (modelsList.length <= 1) {
      toast.warning('必须保留至少一个可用模型！')
      return
    }
    const updated = modelsList.filter((m) => m !== modelId)
    setModelsList(updated)
    setModelContextWindows((prev) => {
      const next = { ...prev }
      delete next[modelId]
      return next
    })
    if (selectedModel === modelId) {
      setSelectedModel(updated[0] || '')
    }
  }

  const handleToggleModelSelection = (model: FetchedModelInfo): void => {
    const modelId = model.id
    if (modelsList.includes(modelId)) {
      if (modelsList.length <= 1) {
        toast.warning('必须保留至少一个可用模型！')
        return
      }
      const updated = modelsList.filter((m) => m !== modelId)
      setModelsList(updated)
      setModelContextWindows((prev) => {
        const next = { ...prev }
        delete next[modelId]
        return next
      })
      if (selectedModel === modelId) {
        setSelectedModel(updated[0] || '')
      }
    } else {
      setModelsList((prev) => [...prev, modelId])
      if (model.contextWindowTokens) {
        setModelContextWindows((prev) => ({
          ...prev,
          [modelId]: model.contextWindowTokens as number
        }))
      }
    }
  }

  const handleChangeModelContextWindow = (modelId: string, value: string): void => {
    const trimmed = value.trim()
    setModelContextWindows((prev) => {
      const next = { ...prev }
      if (!trimmed) {
        delete next[modelId]
        return next
      }

      const parsed = Number(trimmed)
      if (Number.isFinite(parsed)) {
        next[modelId] = Math.round(parsed)
      }
      return next
    })
  }

  const toggleTheme = (): void => {
    const nextTheme = theme === 'dark' ? 'light' : 'dark'
    setTheme(nextTheme)

    // Save to storage
    window.api.storeGet('settings').then((savedSettings) => {
      const settings = (savedSettings as AppSettings) || {}
      settings.theme = nextTheme
      window.api.storeSet('settings', settings)
    })
  }

  const handleChangeEditingProviderName = (name: string): void => {
    setProviders((prev) => prev.map((p) => (p.id === editingProviderId ? { ...p, name } : p)))
  }

  const handleChangeEditingProviderApiFormat = (format: ProviderApiFormat): void => {
    setProviders((prev) =>
      prev.map((p) => (p.id === editingProviderId ? { ...p, apiFormat: format } : p))
    )
  }

  const handleChangeEditingProviderPromptProfile = (profile?: ModelPromptProfile): void => {
    setProviders((prev) =>
      prev.map((p) => (p.id === editingProviderId ? { ...p, promptProfile: profile } : p))
    )
  }

  const handleChangeEditingProviderDefaultReasoningControl = (
    control: ModelReasoningControl | undefined
  ): void => {
    setProviders((prev) =>
      prev.map((p) => {
        if (p.id !== editingProviderId) return p
        if (!control) {
          const { defaultReasoningControl: _removed, ...rest } = p
          return rest
        }
        return { ...p, defaultReasoningControl: control }
      })
    )
  }

  const handleChangeEditingModelAdvancedConfig: UseProvidersReturn['handleChangeEditingModelAdvancedConfig'] =
    (modelId, config): void => {
      setProviders((previous) =>
        previous.map((provider) => {
          if (provider.id !== editingProviderId || provider.type !== 'custom') return provider

          const current =
            provider.models?.[modelId] ||
            createModelInfo(provider, modelId, modelContextWindows[modelId])
          const compatibility = { ...(current.compatibility || {}) }
          if ('reasoningResponseFormat' in config) {
            if (config.reasoningResponseFormat) {
              compatibility.reasoningResponseFormat = config.reasoningResponseFormat
            } else {
              delete compatibility.reasoningResponseFormat
            }
          }

          const nextModel: ModelInfo = { ...current, compatibility }
          if (Object.keys(compatibility).length === 0) delete nextModel.compatibility

          if ('reasoningControlOverride' in config) {
            if (config.reasoningControlOverride) {
              nextModel.reasoningControlOverride = config.reasoningControlOverride
            } else {
              delete nextModel.reasoningControlOverride
            }
          }

          if ('requestBodyOverrides' in config) {
            if (
              config.requestBodyOverrides &&
              Object.keys(config.requestBodyOverrides).length > 0
            ) {
              nextModel.requestBodyOverrides = { ...config.requestBodyOverrides }
            } else {
              delete nextModel.requestBodyOverrides
            }
          }

          return {
            ...provider,
            models: { ...(provider.models || {}), [modelId]: nextModel }
          }
        })
      )
    }

  return {
    apiKey,
    setApiKey,
    apiUrl,
    setApiUrl,
    selectedModel,
    setSelectedModel,
    modelsList,
    setModelsList,
    modelContextWindows,
    setModelContextWindows,
    systemPrompt,
    setSystemPrompt,
    autoHideOnBlur,
    setAutoHideOnBlur,
    contextRetentionMode,
    setContextRetentionMode,
    reasoningDefaults,
    setReasoningDefault,
    appStorePath,
    saveSuccess,
    theme,
    setTheme,
    toggleTheme,
    providers,
    setProviders,
    activeProviderId,
    setActiveProviderId,
    editingProviderId,
    setEditingProviderId,
    isEditingProviderDetail,
    setIsEditingProviderDetail,
    showAddForm,
    setShowAddForm,
    newProviderName,
    setNewProviderName,
    newProviderType,
    setNewProviderType,
    manualModelInput,
    setManualModelInput,
    fetchModelsUrl,
    setFetchModelsUrl,
    isFetchingModels,
    isTestingProviderConnection,
    providerConnectionTest,
    refreshingModelContextId,
    fetchedModels,
    showModelsModal,
    setShowModelsModal,
    apiKeys,
    setApiKeys,
    activeApiKeyId,
    setActiveApiKeyId,
    providerAuthType,
    setProviderAuthType,
    providerAuthHeader,
    setProviderAuthHeader,
    providerHeaders,
    handleAddProviderHeader,
    handleChangeProviderHeader,
    handleDeleteProviderHeader,
    handleSelectApiKey,
    handleChangeApiKeyItemName,
    handleChangeApiKeyValue,
    handleAddApiKey,
    handleDeleteApiKey,
    handleApiUrlChange,
    handleSaveGlobalSettings,
    handleSaveProviderDetails,
    handleAddProvider,
    handleSetActiveProvider,
    handleStartEditingProvider,
    handleDeleteProvider,
    handleChangeEditingProviderName,
    handleChangeEditingProviderApiFormat,
    handleChangeEditingProviderPromptProfile,
    handleChangeEditingProviderDefaultReasoningControl,
    handleChangeEditingModelAdvancedConfig,
    handleAddManualModel,
    handleFetchModels,
    handleTestProviderConnection,
    handleRefreshModelContext,
    handleRemoveModelDirectly,
    handleToggleModelSelection,
    handleChangeModelContextWindow,
    resetLocalSettings,
    permissions,
    onChangeToolPermission,
    webSearchProvider,
    setWebSearchProvider,
    webSearchApiKey,
    setWebSearchApiKey
  }
}
