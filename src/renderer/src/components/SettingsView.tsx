import React, { useMemo, useState } from 'react'
import { ApiProvider, Skill, SkillInstallPayload } from '../../../shared/types'
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
  newProviderType: ApiProvider['type']
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
  setNewProviderType: (val: ApiProvider['type']) => void
  setSystemPrompt: (val: string) => void
  setAutoHideOnBlur: (val: boolean) => void

  onSaveGlobalSettings: () => void
  onSaveProviderDetails: () => void
  onAddProvider: (name: string, type: ApiProvider['type']) => void
  onSetActiveProvider: (id: string) => void
  onStartEditingProvider: (id: string) => void
  onDeleteProvider: (id: string) => void
  onAddManualModel: () => void
  onFetchModels: () => void
  onRemoveModel: (modelId: string) => void
  onInstallSkill: (payload: SkillInstallPayload) => Promise<Skill>
  onRemoveSkill: (id: string) => Promise<void>
  onChangeEditingProviderName: (name: string) => void
  onChangeEditingProviderApiUrl: (url: string) => void
  permissions: Record<string, 'allow' | 'ask' | 'deny'>
  onChangeToolPermission: (toolName: string, policy: 'allow' | 'ask' | 'deny') => void
}

type SettingsSection = 'providers' | 'general' | 'agent' | 'skills'

const settingsSections: Array<{ id: SettingsSection; label: string; detail: string }> = [
  { id: 'providers', label: '服务商', detail: 'API 与模型' },
  { id: 'general', label: '通用', detail: '提示词与窗口' },
  { id: 'agent', label: 'Agent', detail: '工具权限' },
  { id: 'skills', label: 'Skills', detail: 'Markdown / 文件夹' }
]

const agentTools: Array<{
  name: string
  label: string
  risk: 'low' | 'medium' | 'high'
}> = [
  { name: 'fetch_url', label: '抓取网页', risk: 'low' },
  { name: 'read_cached_resource', label: '读取资源缓存', risk: 'low' },
  { name: 'search_cached_resource', label: '检索资源缓存', risk: 'low' },
  { name: 'web_search', label: '网络搜索', risk: 'low' },
  { name: 'workspace_list_files', label: '列出工作区文件', risk: 'low' },
  { name: 'workspace_search', label: '搜索工作区', risk: 'low' },
  { name: 'file_read', label: '读取本地文件', risk: 'low' },
  { name: 'file_write', label: '写入本地文件', risk: 'medium' },
  { name: 'shell', label: '执行系统命令', risk: 'high' }
]

const riskLabels: Record<'low' | 'medium' | 'high', string> = {
  low: '低',
  medium: '中',
  high: '高'
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
  onChangeEditingProviderApiUrl,
  permissions,
  onChangeToolPermission
}) => {
  const [activeSection, setActiveSection] = useState<SettingsSection>('providers')
  const currentEditingProvider = providers.find((p) => p.id === editingProviderId)
  const activeProvider = providers.find((p) => p.id === activeProviderId)

  const panelStats = useMemo(
    () => [
      { label: '服务商', value: providers.length.toString() },
      { label: '模型', value: modelsList.length.toString() },
      { label: 'Skills', value: skills.length.toString() }
    ],
    [modelsList.length, providers.length, skills.length]
  )

  if (isEditingProviderDetail) {
    return (
      <div className="settings-container">
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
      </div>
    )
  }

  return (
    <div className="settings-container">
      <div className="control-panel">
        <aside className="control-panel-sidebar">
          <div className="control-panel-title-block">
            <span className="control-panel-kicker">Control Panel</span>
            <span className="control-panel-title">设置</span>
          </div>

          <div className="control-panel-stats">
            {panelStats.map((item) => (
              <div key={item.label} className="control-panel-stat">
                <span>{item.value}</span>
                <small>{item.label}</small>
              </div>
            ))}
          </div>

          <nav className="control-panel-nav" aria-label="Settings sections">
            {settingsSections.map((section) => (
              <button
                key={section.id}
                type="button"
                className={`control-panel-nav-item ${activeSection === section.id ? 'active' : ''}`}
                onClick={() => setActiveSection(section.id)}
              >
                <span>{section.label}</span>
                <small>{section.detail}</small>
              </button>
            ))}
          </nav>

          <div className="control-panel-sidebar-footer">
            <button
              type="button"
              className="settings-save-btn control-save-btn"
              onClick={onSaveGlobalSettings}
            >
              保存设置
            </button>
            {saveSuccess && <span className="settings-save-msg">已保存</span>}
          </div>
        </aside>

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
            <section className="control-section">
              <header className="control-section-header">
                <div>
                  <h2>通用</h2>
                  <p>System Prompt / Window</p>
                </div>
              </header>

              <div className="settings-form-grid">
                <label className="settings-field settings-field-wide">
                  <span className="settings-label">系统预设提示词</span>
                  <textarea
                    className="settings-input settings-textarea"
                    value={systemPrompt}
                    onChange={(e) => setSystemPrompt(e.target.value)}
                  />
                </label>

                <label className="settings-toggle-row">
                  <input
                    type="checkbox"
                    className="settings-checkbox"
                    checked={autoHideOnBlur}
                    onChange={(e) => setAutoHideOnBlur(e.target.checked)}
                  />
                  <span>失焦自动隐藏</span>
                </label>

                <label className="settings-field settings-field-wide">
                  <span className="settings-label">本地数据存储路径</span>
                  <input
                    type="text"
                    className="settings-input settings-path-input"
                    value={appStorePath}
                    readOnly
                    disabled
                  />
                </label>
              </div>
            </section>
          )}

          {activeSection === 'agent' && (
            <section className="control-section">
              <header className="control-section-header">
                <div>
                  <h2>Agent 权限</h2>
                  <p>Allow / Ask / Deny</p>
                </div>
              </header>

              <div className="permission-table">
                {agentTools.map((tool) => (
                  <div key={tool.name} className="permission-row">
                    <div className="permission-tool">
                      <span>{tool.label}</span>
                      <code>{tool.name}</code>
                    </div>
                    <span className={`permission-risk ${tool.risk}`}>{riskLabels[tool.risk]}</span>
                    <select
                      className="settings-select permission-select"
                      value={permissions[tool.name] || 'allow'}
                      onChange={(e) =>
                        onChangeToolPermission(
                          tool.name,
                          e.target.value as 'allow' | 'ask' | 'deny'
                        )
                      }
                    >
                      <option value="allow">允许</option>
                      <option value="ask">询问</option>
                      <option value="deny">拒绝</option>
                    </select>
                  </div>
                ))}
              </div>
            </section>
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
        </main>
      </div>
    </div>
  )
}
