import React, { useEffect, useState } from 'react'
import {
  AgentToolInfo,
  ApiProvider,
  ContextRetentionMode,
  Skill,
  SkillInstallPayload,
  WebSearchProviderType,
  ApiKeyItem,
  ProviderApiFormat
} from '../../../shared/types'
import { ProviderList } from './ProviderList'
import { ProviderEditor } from './ProviderEditor'
import { SkillManager } from './SkillManager'
import { MemoryManager } from './MemoryManager'
import { McpManagerView } from './McpManagerView'
import { AgentSettingsSection } from './settings/AgentSettingsSection'
import { GeneralSettingsSection } from './settings/GeneralSettingsSection'
import { SettingsSidebar, type SettingsSection } from './settings/SettingsSidebar'
import {
  getInitialToolLanguage,
  getToolDisplay,
  type ToolDisplayLanguage
} from './settings/toolDisplay'

interface SettingsViewProps {
  isEditingProviderDetail: boolean
  editingProviderId: string
  activeProviderId: string
  providers: ApiProvider[]
  apiUrl: string
  selectedModel: string
  modelsList: string[]
  modelContextWindows: Record<string, number>
  manualModelInput: string
  fetchModelsUrl: string
  isFetchingModels: boolean
  refreshingModelContextId: string | null
  showAddForm: boolean
  newProviderName: string
  newProviderType: ApiProvider['type']
  systemPrompt: string
  autoHideOnBlur: boolean
  contextRetentionMode: ContextRetentionMode
  appStorePath: string
  saveSuccess: boolean
  skills: Skill[]
  activeSessionId: string | null

  setIsEditingProviderDetail: (val: boolean) => void
  setSelectedModel: (val: string) => void
  setManualModelInput: (val: string) => void
  setFetchModelsUrl: (val: string) => void
  setShowAddForm: (val: boolean) => void
  setNewProviderName: (val: string) => void
  setNewProviderType: (val: ApiProvider['type']) => void
  setSystemPrompt: (val: string) => void
  setAutoHideOnBlur: (val: boolean) => void
  setContextRetentionMode: (val: ContextRetentionMode) => void

  onSaveGlobalSettings: () => void
  onSaveProviderDetails: () => void
  onAddProvider: (name: string, type: ApiProvider['type']) => void
  onSetActiveProvider: (id: string) => void
  onStartEditingProvider: (id: string) => void
  onDeleteProvider: (id: string) => void
  onAddManualModel: () => void
  onFetchModels: () => void
  onRefreshModelContext: (modelId: string) => void
  onRemoveModel: (modelId: string) => void
  onChangeModelContextWindow: (modelId: string, value: string) => void
  onInstallSkill: (payload: SkillInstallPayload) => Promise<Skill>
  onRemoveSkill: (id: string) => Promise<void>
  onChangeEditingProviderName: (name: string) => void
  onChangeEditingProviderApiUrl: (url: string) => void
  permissions: Record<string, 'allow' | 'ask' | 'deny'>
  onChangeToolPermission: (toolName: string, policy: 'allow' | 'ask' | 'deny') => void
  webSearchProvider: WebSearchProviderType
  setWebSearchProvider: (val: WebSearchProviderType) => void
  webSearchApiKey: string
  setWebSearchApiKey: (val: string) => void
  apiKeys: ApiKeyItem[]
  activeApiKeyId: string
  onSelectApiKey: (id: string) => void
  onChangeApiKeyItemName: (id: string, name: string) => void
  onChangeApiKeyValue: (id: string, value: string) => void
  onAddApiKey: () => void
  onDeleteApiKey: (id: string) => void
  onChangeEditingProviderApiFormat: (format: ProviderApiFormat) => void
}

export const SettingsView: React.FC<SettingsViewProps> = ({
  isEditingProviderDetail,
  editingProviderId,
  activeProviderId,
  providers,
  apiUrl,
  selectedModel,
  modelsList,
  modelContextWindows,
  manualModelInput,
  fetchModelsUrl,
  isFetchingModels,
  refreshingModelContextId,
  showAddForm,
  newProviderName,
  newProviderType,
  systemPrompt,
  autoHideOnBlur,
  contextRetentionMode,
  appStorePath,
  saveSuccess,
  skills,
  activeSessionId,

  setIsEditingProviderDetail,
  setSelectedModel,
  setManualModelInput,
  setFetchModelsUrl,
  setShowAddForm,
  setNewProviderName,
  setNewProviderType,
  setSystemPrompt,
  setAutoHideOnBlur,
  setContextRetentionMode,

  onSaveGlobalSettings,
  onSaveProviderDetails,
  onAddProvider,
  onSetActiveProvider,
  onStartEditingProvider,
  onDeleteProvider,
  onAddManualModel,
  onFetchModels,
  onRefreshModelContext,
  onRemoveModel,
  onChangeModelContextWindow,
  onInstallSkill,
  onRemoveSkill,
  onChangeEditingProviderName,
  onChangeEditingProviderApiUrl,
  permissions,
  onChangeToolPermission,
  webSearchProvider,
  setWebSearchProvider,
  webSearchApiKey,
  setWebSearchApiKey,
  apiKeys,
  activeApiKeyId,
  onSelectApiKey,
  onChangeApiKeyItemName,
  onChangeApiKeyValue,
  onAddApiKey,
  onDeleteApiKey,
  onChangeEditingProviderApiFormat
}) => {
  const [activeSection, setActiveSection] = useState<SettingsSection>('providers')
  const [agentTools, setAgentTools] = useState<AgentToolInfo[]>([])
  const [toolDisplayLanguage, setToolDisplayLanguage] =
    useState<ToolDisplayLanguage>(getInitialToolLanguage)
  const currentEditingProvider = providers.find((p) => p.id === editingProviderId)
  const activeProvider = providers.find((p) => p.id === activeProviderId)

  const setToolLanguage = (language: ToolDisplayLanguage): void => {
    setToolDisplayLanguage(language)
    try {
      window.localStorage.setItem('quickai.agentToolLanguage', language)
    } catch {
      // Display preference only; ignore storage failures.
    }
  }

  useEffect(() => {
    if (activeSection !== 'agent') return
    let cancelled = false
    window.api
      .listAgentTools()
      .then((tools) => {
        if (!cancelled) setAgentTools(tools)
      })
      .catch((error) => {
        console.error('Failed to load agent tools:', error)
        if (!cancelled) setAgentTools([])
      })
    return () => {
      cancelled = true
    }
  }, [activeSection])

  if (isEditingProviderDetail) {
    return (
      <div className="settings-container">
        <ProviderEditor
          provider={currentEditingProvider}
          apiUrl={apiUrl}
          selectedModel={selectedModel}
          modelsList={modelsList}
          modelContextWindows={modelContextWindows}
          manualModelInput={manualModelInput}
          fetchModelsUrl={fetchModelsUrl}
          isFetchingModels={isFetchingModels}
          refreshingModelContextId={refreshingModelContextId}
          onSave={onSaveProviderDetails}
          onCancel={() => setIsEditingProviderDetail(false)}
          onChangeName={onChangeEditingProviderName}
          onChangeApiUrl={onChangeEditingProviderApiUrl}
          onChangeSelectedModel={setSelectedModel}
          onChangeManualModelInput={setManualModelInput}
          onChangeFetchModelsUrl={setFetchModelsUrl}
          onAddManualModel={onAddManualModel}
          onFetchModels={onFetchModels}
          onRefreshModelContext={onRefreshModelContext}
          onRemoveModel={onRemoveModel}
          onChangeModelContextWindow={onChangeModelContextWindow}
          apiKeys={apiKeys}
          activeApiKeyId={activeApiKeyId}
          onSelectApiKey={onSelectApiKey}
          onChangeApiKeyItemName={onChangeApiKeyItemName}
          onChangeApiKeyValue={onChangeApiKeyValue}
          onAddApiKey={onAddApiKey}
          onDeleteApiKey={onDeleteApiKey}
          onChangeApiFormat={onChangeEditingProviderApiFormat}
        />
      </div>
    )
  }

  return (
    <div className="settings-container">
      <div className="control-panel">
        <SettingsSidebar
          activeSection={activeSection}
          saveSuccess={saveSuccess}
          onChangeSection={setActiveSection}
          onSaveGlobalSettings={onSaveGlobalSettings}
        />
        <main className="control-panel-content">
          {activeSection === 'providers' && (
            <section className="control-section">
              <header className="control-section-header">
                <div>
                  <h2>服务商</h2>
                  <p>{activeProvider ? `${activeProvider.name} / ${selectedModel}` : '未选择'}</p>
                </div>
              </header>
              <ProviderList
                providers={providers}
                activeProviderId={activeProviderId}
                showAddForm={showAddForm}
                newProviderName={newProviderName}
                newProviderType={newProviderType}
                setShowAddForm={setShowAddForm}
                setNewProviderName={setNewProviderName}
                setNewProviderType={setNewProviderType}
                onAddProvider={onAddProvider}
                onSetActiveProvider={onSetActiveProvider}
                onStartEditingProvider={onStartEditingProvider}
                onDeleteProvider={onDeleteProvider}
              />
            </section>
          )}

          {activeSection === 'general' && (
            <GeneralSettingsSection
              systemPrompt={systemPrompt}
              autoHideOnBlur={autoHideOnBlur}
              contextRetentionMode={contextRetentionMode}
              appStorePath={appStorePath}
              onChangeSystemPrompt={setSystemPrompt}
              onChangeAutoHideOnBlur={setAutoHideOnBlur}
              onChangeContextRetentionMode={setContextRetentionMode}
            />
          )}

          {activeSection === 'agent' && (
            <AgentSettingsSection
              agentTools={agentTools}
              permissions={permissions}
              toolDisplayLanguage={toolDisplayLanguage}
              webSearchProvider={webSearchProvider}
              webSearchApiKey={webSearchApiKey}
              onToolDisplayLanguageChange={setToolLanguage}
              getToolDisplay={getToolDisplay}
              onChangeToolPermission={onChangeToolPermission}
              onChangeWebSearchProvider={setWebSearchProvider}
              onChangeWebSearchApiKey={setWebSearchApiKey}
            />
          )}

          {activeSection === 'skills' && (
            <section className="control-section">
              <header className="control-section-header">
                <div>
                  <h2>Skills</h2>
                  <p>{skills.length} installed</p>
                </div>
              </header>
              <SkillManager
                skills={skills}
                onInstallSkill={onInstallSkill}
                onRemoveSkill={onRemoveSkill}
              />
            </section>
          )}

          {activeSection === 'memory' && (
            <section
              className="control-section"
              style={{
                height: '100%',
                display: 'flex',
                flexDirection: 'column',
                overflow: 'hidden'
              }}
            >
              <header className="control-section-header" style={{ flexShrink: 0 }}>
                <div>
                  <h2>记忆管理</h2>
                  <p>管理全局及单会话的常态和按需记忆分类</p>
                </div>
              </header>
              <div style={{ flex: 1, overflow: 'hidden', minHeight: 0 }}>
                <MemoryManager sessionId={activeSessionId} />
              </div>
            </section>
          )}

          {activeSection === 'mcp' && (
            <section
              className="control-section"
              style={{
                height: '100%',
                display: 'flex',
                flexDirection: 'column',
                overflow: 'hidden'
              }}
            >
              <header className="control-section-header" style={{ flexShrink: 0 }}>
                <div>
                  <h2>MCP 外部工具</h2>
                  <p>通过 Model Context Protocol 协议配置外部工具服务器</p>
                </div>
              </header>
              <div style={{ flex: 1, overflow: 'hidden', minHeight: 0 }}>
                <McpManagerView />
              </div>
            </section>
          )}
        </main>
      </div>
    </div>
  )
}
