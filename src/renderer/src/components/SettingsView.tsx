import React from 'react'
import { ApiProvider, Skill } from '../../../shared/types'
import { ProviderList } from './ProviderList'
import { ProviderEditor } from './ProviderEditor'
import { SkillManager } from './SkillManager'

interface SettingsViewProps {
  isEditingProviderDetail: boolean
  editingProviderId: string
  activeProviderId: string
  providers: ApiProvider[]
  apiKey: string
  apiUrl: string
  selectedModel: string
  modelsList: string[]
  manualModelInput: string
  fetchModelsUrl: string
  isFetchingModels: boolean
  showAddForm: boolean
  newProviderName: string
  newProviderType: 'deepseek' | 'kimi' | 'ollama' | 'custom'
  systemPrompt: string
  autoHideOnBlur: boolean
  appStorePath: string
  saveSuccess: boolean
  skills: Skill[]

  setIsEditingProviderDetail: (val: boolean) => void
  setApiKey: (val: string) => void
  setSelectedModel: (val: string) => void
  setManualModelInput: (val: string) => void
  setFetchModelsUrl: (val: string) => void
  setShowAddForm: (val: boolean) => void
  setNewProviderName: (val: string) => void
  setNewProviderType: (val: 'deepseek' | 'kimi' | 'ollama' | 'custom') => void
  setSystemPrompt: (val: string) => void
  setAutoHideOnBlur: (val: boolean) => void

  onSaveGlobalSettings: () => void
  onSaveProviderDetails: () => void
  onAddProvider: (name: string, type: 'deepseek' | 'kimi' | 'ollama' | 'custom') => void
  onSetActiveProvider: (id: string) => void
  onStartEditingProvider: (id: string) => void
  onDeleteProvider: (id: string) => void
  onAddManualModel: () => void
  onFetchModels: () => void
  onRemoveModel: (modelId: string) => void
  onInstallSkill: (fileName: string, markdown: string) => Promise<Skill>
  onRemoveSkill: (id: string) => Promise<void>
  onChangeEditingProviderName: (name: string) => void
  onChangeEditingProviderApiUrl: (url: string) => void
}

export const SettingsView: React.FC<SettingsViewProps> = ({
  isEditingProviderDetail,
  editingProviderId,
  activeProviderId,
  providers,
  apiKey,
  apiUrl,
  selectedModel,
  modelsList,
  manualModelInput,
  fetchModelsUrl,
  isFetchingModels,
  showAddForm,
  newProviderName,
  newProviderType,
  systemPrompt,
  autoHideOnBlur,
  appStorePath,
  saveSuccess,
  skills,

  setIsEditingProviderDetail,
  setApiKey,
  setSelectedModel,
  setManualModelInput,
  setFetchModelsUrl,
  setShowAddForm,
  setNewProviderName,
  setNewProviderType,
  setSystemPrompt,
  setAutoHideOnBlur,

  onSaveGlobalSettings,
  onSaveProviderDetails,
  onAddProvider,
  onSetActiveProvider,
  onStartEditingProvider,
  onDeleteProvider,
  onAddManualModel,
  onFetchModels,
  onRemoveModel,
  onInstallSkill,
  onRemoveSkill,
  onChangeEditingProviderName,
  onChangeEditingProviderApiUrl
}) => {
  const currentEditingProvider = providers.find((p) => p.id === editingProviderId)

  return (
    <div className="settings-container">
      {isEditingProviderDetail ? (
        /* Level 2: Provider Details Editor Sub-page */
        <ProviderEditor
          provider={currentEditingProvider}
          apiKey={apiKey}
          apiUrl={apiUrl}
          selectedModel={selectedModel}
          modelsList={modelsList}
          manualModelInput={manualModelInput}
          fetchModelsUrl={fetchModelsUrl}
          isFetchingModels={isFetchingModels}
          onSave={onSaveProviderDetails}
          onCancel={() => setIsEditingProviderDetail(false)}
          onChangeName={onChangeEditingProviderName}
          onChangeApiKey={setApiKey}
          onChangeApiUrl={onChangeEditingProviderApiUrl}
          onChangeSelectedModel={setSelectedModel}
          onChangeManualModelInput={setManualModelInput}
          onChangeFetchModelsUrl={setFetchModelsUrl}
          onAddManualModel={onAddManualModel}
          onFetchModels={onFetchModels}
          onRemoveModel={onRemoveModel}
        />
      ) : (
        /* Level 1: Main Settings Page */
        <div>
          <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: '20px' }}>
            {/* Left side: Configured Providers list */}
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

            {/* Right side: Global Settings */}
            <div>
              <span
                className="settings-label"
                style={{
                  fontSize: '13.5px',
                  color: 'var(--color-text-title)',
                  fontWeight: 'bold',
                  display: 'block',
                  marginBottom: '10px'
                }}
              >
                全局配置 (Global Settings)
              </span>

              <div className="settings-group">
                <label className="settings-label">系统预设提示词 (System Prompt)</label>
                <textarea
                  className="settings-input"
                  style={{
                    resize: 'vertical',
                    minHeight: '80px',
                    maxHeight: '160px',
                    fontSize: '12px'
                  }}
                  value={systemPrompt}
                  onChange={(e) => setSystemPrompt(e.target.value)}
                />
              </div>

              <div
                className="settings-group"
                style={{ flexDirection: 'row', alignItems: 'center', marginTop: '10px' }}
              >
                <label className="settings-checkbox-container">
                  <input
                    type="checkbox"
                    className="settings-checkbox"
                    checked={autoHideOnBlur}
                    onChange={(e) => setAutoHideOnBlur(e.target.checked)}
                  />
                  <span>失焦时自动隐藏聊天窗口 (Spotlight 模式)</span>
                </label>
              </div>

              <div className="settings-group" style={{ marginTop: '10px' }}>
                <label className="settings-label" style={{ fontSize: '11.5px' }}>
                  本地数据存储路径
                </label>
                <input
                  type="text"
                  className="settings-input"
                  style={{ opacity: 0.5, fontSize: '10.5px', padding: '6px' }}
                  value={appStorePath}
                  readOnly
                  disabled
                />
              </div>

              <SkillManager
                skills={skills}
                onInstallSkill={onInstallSkill}
                onRemoveSkill={onRemoveSkill}
              />
            </div>
          </div>

          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '12px',
              marginTop: '16px',
              borderTop: '1px solid var(--color-border)',
              paddingTop: '12px'
            }}
          >
            <button className="settings-save-btn" onClick={onSaveGlobalSettings}>
              保存全局配置
            </button>
            {saveSuccess && (
              <div className="settings-save-msg" style={{ margin: 0 }}>
                ✓ 配置保存成功！
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
