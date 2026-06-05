import { useState, useEffect } from 'react'
import { ApiProvider, AppSettings } from '../../../shared/types'
import { PROVIDER_PRESETS } from '../utils/providerPresets'

export const useProviders = (showSettings: boolean) => {
  // Settings state
  const [apiKey, setApiKey] = useState('')
  const [apiUrl, setApiUrl] = useState('https://api.deepseek.com/v1')
  const [selectedModel, setSelectedModel] = useState('deepseek-chat')
  const [modelsList, setModelsList] = useState<string[]>(['deepseek-chat', 'deepseek-reasoner'])
  const [systemPrompt, setSystemPrompt] = useState('')
  const [autoHideOnBlur, setAutoHideOnBlur] = useState(true)
  const [appStorePath, setAppStorePath] = useState('')
  const [saveSuccess, setSaveSuccess] = useState(false)
  const [theme, setTheme] = useState<'dark' | 'light'>('dark')

  // Providers list state
  const [providers, setProviders] = useState<ApiProvider[]>([])
  const [activeProviderId, setActiveProviderId] = useState<string>('')
  const [editingProviderId, setEditingProviderId] = useState<string>('')
  const [isEditingProviderDetail, setIsEditingProviderDetail] = useState(false)

  // Add provider form states
  const [showAddForm, setShowAddForm] = useState(false)
  const [newProviderName, setNewProviderName] = useState('')
  const [newProviderType, setNewProviderType] = useState<ApiProvider['type']>('deepseek')

  // Model Management inputs state
  const [manualModelInput, setManualModelInput] = useState('')
  const [fetchModelsUrl, setFetchModelsUrl] = useState('https://api.deepseek.com/v1/models')
  const [isFetchingModels, setIsFetchingModels] = useState(false)
  const [fetchedModels, setFetchedModels] = useState<string[]>([])
  const [showModelsModal, setShowModelsModal] = useState(false)

  // Load configuration and data on startup
  useEffect(() => {
    const initSettings = async () => {
      // Settings
      const savedSettings = (await window.api.storeGet('settings')) as AppSettings
      if (savedSettings) {
        const loadedProviders = savedSettings.providers || []
        const loadedActiveId = savedSettings.activeProviderId || ''
        setProviders(loadedProviders)
        setActiveProviderId(loadedActiveId)
        setEditingProviderId(loadedActiveId)

        // Find active provider
        const activeProv = loadedProviders.find((p) => p.id === loadedActiveId) || loadedProviders[0]
        if (activeProv) {
          setApiKey(activeProv.apiKey || '')
          setApiUrl(activeProv.apiUrl || '')
          setSelectedModel(activeProv.model || '')
          setModelsList(activeProv.modelsList || [])
          setFetchModelsUrl(`${(activeProv.apiUrl || '').replace(/\/$/, '')}/models`)
        }

        setSystemPrompt(savedSettings.systemPrompt || '')
        setAutoHideOnBlur(savedSettings.autoHideOnBlur !== false)
        setTheme(savedSettings.theme || 'dark')
      }

      // App metadata
      const info = await window.api.getAppInfo()
      setAppStorePath(info.storePath)
    }

    initSettings()
  }, [])

  // Restore local editor states to active provider settings when settings panel is closed without saving
  useEffect(() => {
    if (!showSettings && activeProviderId && providers.length > 0) {
      const activeProv = providers.find((p) => p.id === activeProviderId)
      if (activeProv) {
        setApiKey(activeProv.apiKey || '')
        setApiUrl(activeProv.apiUrl || '')
        setSelectedModel(activeProv.model || '')
        setModelsList(activeProv.modelsList || [])
        setFetchModelsUrl(`${(activeProv.apiUrl || '').replace(/\/$/, '')}/models`)
        setEditingProviderId(activeProviderId)
      }
    }
  }, [showSettings, activeProviderId, providers])

  // Update fetch models URL when API URL changes
  const handleApiUrlChange = (newUrl: string) => {
    setApiUrl(newUrl)
    setFetchModelsUrl(`${newUrl.replace(/\/$/, '')}/models`)
  }

  const handleSaveGlobalSettings = async () => {
    const savedSettings = (await window.api.storeGet('settings')) as AppSettings
    if (savedSettings) {
      savedSettings.systemPrompt = systemPrompt
      savedSettings.autoHideOnBlur = autoHideOnBlur
      savedSettings.theme = theme
      await window.api.storeSet('settings', savedSettings)
      setSaveSuccess(true)
      setTimeout(() => setSaveSuccess(false), 2000)
    }
  }

  const handleSaveProviderDetails = async () => {
    const savedSettings = (await window.api.storeGet('settings')) as AppSettings
    if (savedSettings) {
      savedSettings.providers = providers.map((p) => {
        if (p.id === editingProviderId) {
          return {
            ...p,
            apiKey,
            apiUrl,
            model: selectedModel,
            modelsList
          }
        }
        return p
      })
      await window.api.storeSet('settings', savedSettings)
      setProviders(savedSettings.providers)
      setIsEditingProviderDetail(false)
    }
  }

  const handleAddProvider = async (name: string, type: ApiProvider['type']) => {
    const customName = name.trim() || `${type.toUpperCase()}-配置`
    const preset = PROVIDER_PRESETS.find((p) => p.type === type)
    const newProv: ApiProvider = {
      id: `provider-${Date.now()}`,
      name: customName,
      type,
      apiKey: '',
      apiUrl: preset ? preset.apiUrl : '',
      model: preset ? preset.defaultModel : '',
      modelsList: preset ? preset.modelsList : []
    }
    const updated = [...providers, newProv]
    setProviders(updated)
    const savedSettings = (await window.api.storeGet('settings')) as AppSettings
    if (savedSettings) {
      savedSettings.providers = updated
      await window.api.storeSet('settings', savedSettings)
    }
  }

  const handleSetActiveProvider = async (id: string) => {
    setActiveProviderId(id)
    setEditingProviderId(id)
    const target = providers.find((p) => p.id === id)
    if (target) {
      setApiKey(target.apiKey || '')
      setApiUrl(target.apiUrl || '')
      setSelectedModel(target.model || '')
      setModelsList(target.modelsList || [])
      setFetchModelsUrl(`${(target.apiUrl || '').replace(/\/$/, '')}/models`)
    }
    const savedSettings = (await window.api.storeGet('settings')) as AppSettings
    if (savedSettings) {
      savedSettings.activeProviderId = id
      await window.api.storeSet('settings', savedSettings)
    }
  }

  const handleStartEditingProvider = (id: string) => {
    setEditingProviderId(id)
    const target = providers.find((p) => p.id === id)
    if (target) {
      setApiKey(target.apiKey || '')
      setApiUrl(target.apiUrl || '')
      setSelectedModel(target.model || '')
      setModelsList(target.modelsList || [])
      setFetchModelsUrl(`${(target.apiUrl || '').replace(/\/$/, '')}/models`)
    }
    setIsEditingProviderDetail(true)
  }

  const handleDeleteProvider = async (id: string) => {
    if (providers.length <= 1) return
    const updated = providers.filter((p) => p.id !== id)
    setProviders(updated)

    let nextActiveId = activeProviderId
    if (activeProviderId === id) {
      nextActiveId = updated[0].id
      setActiveProviderId(nextActiveId)
      setEditingProviderId(nextActiveId)
      const target = updated[0]
      setApiKey(target.apiKey || '')
      setApiUrl(target.apiUrl || '')
      setSelectedModel(target.model || '')
      setModelsList(target.modelsList || [])
      setFetchModelsUrl(`${(target.apiUrl || '').replace(/\/$/, '')}/models`)
    }

    const savedSettings = (await window.api.storeGet('settings')) as AppSettings
    if (savedSettings) {
      savedSettings.providers = updated
      savedSettings.activeProviderId = nextActiveId
      await window.api.storeSet('settings', savedSettings)
    }
  }

  const handleAddManualModel = () => {
    const val = manualModelInput.trim()
    if (!val) return
    if (!modelsList.includes(val)) {
      setModelsList((prev) => [...prev, val])
    }
    setManualModelInput('')
  }

  const handleFetchModels = async () => {
    if (!fetchModelsUrl.trim()) return
    setIsFetchingModels(true)
    try {
      const headers: any = { 'Content-Type': 'application/json' }
      if (apiKey) {
        headers['Authorization'] = `Bearer ${apiKey}`
      }
      const response = await fetch(fetchModelsUrl, { method: 'GET', headers })
      const data = await response.json()
      let modelIds: string[] = []
      if (data && Array.isArray(data.data)) {
        modelIds = data.data.map((m: any) => m.id)
      } else if (data && Array.isArray(data)) {
        modelIds = data.map((m: any) => m.id || m)
      }
      if (modelIds.length > 0) {
        setFetchedModels(modelIds)
        setShowModelsModal(true)
      } else {
        alert('未能获取到有效的模型列表，请检查 Base URL 或 API Key。')
      }
    } catch (e) {
      console.error(e)
      alert(`获取模型列表失败: ${e}`)
    } finally {
      setIsFetchingModels(false)
    }
  }

  const handleRemoveModelDirectly = (modelId: string) => {
    const updated = modelsList.filter((m) => m !== modelId)
    setModelsList(updated)
    if (selectedModel === modelId) {
      setSelectedModel(updated[0] || '')
    }
  }

  const handleToggleModelSelection = (modelId: string) => {
    if (modelsList.includes(modelId)) {
      const updated = modelsList.filter((m) => m !== modelId)
      setModelsList(updated)
      if (selectedModel === modelId) {
        setSelectedModel(updated[0] || '')
      }
    } else {
      setModelsList((prev) => [...prev, modelId])
    }
  }

  const toggleTheme = () => {
    const nextTheme = theme === 'dark' ? 'light' : 'dark'
    setTheme(nextTheme)

    // Save to storage
    window.api.storeGet('settings').then((savedSettings) => {
      const settings = (savedSettings as AppSettings) || {}
      settings.theme = nextTheme
      window.api.storeSet('settings', settings)
    })
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
    systemPrompt,
    setSystemPrompt,
    autoHideOnBlur,
    setAutoHideOnBlur,
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
    fetchedModels,
    showModelsModal,
    setShowModelsModal,
    handleApiUrlChange,
    handleSaveGlobalSettings,
    handleSaveProviderDetails,
    handleAddProvider,
    handleSetActiveProvider,
    handleStartEditingProvider,
    handleDeleteProvider,
    handleAddManualModel,
    handleFetchModels,
    handleRemoveModelDirectly,
    handleToggleModelSelection
  }
}
