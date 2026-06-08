import React from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { ApiProvider } from '../../../shared/types'

interface ProviderListProps {
  providers: ApiProvider[]
  activeProviderId: string
  showAddForm: boolean
  newProviderName: string
  newProviderType: 'deepseek' | 'kimi' | 'ollama' | 'custom'
  setShowAddForm: (show: boolean) => void
  setNewProviderName: (name: string) => void
  setNewProviderType: (type: 'deepseek' | 'kimi' | 'ollama' | 'custom') => void
  onAddProvider: (name: string, type: 'deepseek' | 'kimi' | 'ollama' | 'custom') => void
  onSetActiveProvider: (id: string) => void
  onStartEditingProvider: (id: string) => void
  onDeleteProvider: (id: string) => void
}

export const ProviderList: React.FC<ProviderListProps> = ({
  providers,
  activeProviderId,
  showAddForm,
  newProviderName,
  newProviderType,
  setShowAddForm,
  setNewProviderName,
  setNewProviderType,
  onAddProvider,
  onSetActiveProvider,
  onStartEditingProvider,
  onDeleteProvider
}) => {
  const handleAddProvider = (): void => {
    onAddProvider(newProviderName, newProviderType)
    setShowAddForm(false)
    setNewProviderName('')
  }

  return (
    <div className="provider-panel">
      <div className="provider-panel-toolbar">
        <span className="settings-label">已配置服务商</span>
        <button
          type="button"
          className="settings-save-btn provider-add-btn"
          onClick={() => setShowAddForm(true)}
        >
          <Plus size={12} />
          <span>新增</span>
        </button>
      </div>

      {showAddForm && (
        <div className="provider-add-form">
          <label className="settings-field">
            <span className="settings-label">类型</span>
            <select
              className="settings-select"
              value={newProviderType}
              onChange={(e) => setNewProviderType(e.target.value as ApiProvider['type'])}
            >
              <option value="deepseek">DeepSeek</option>
              <option value="kimi">Kimi</option>
              <option value="ollama">Ollama</option>
              <option value="custom">Custom</option>
            </select>
          </label>
          <label className="settings-field provider-name-field">
            <span className="settings-label">名称</span>
            <input
              type="text"
              className="settings-input"
              placeholder="例如 DeepSeek"
              value={newProviderName}
              onChange={(e) => setNewProviderName(e.target.value)}
            />
          </label>
          <div className="provider-add-actions">
            <button
              type="button"
              className="settings-secondary-btn"
              onClick={() => setShowAddForm(false)}
            >
              取消
            </button>
            <button type="button" className="settings-save-btn" onClick={handleAddProvider}>
              添加
            </button>
          </div>
        </div>
      )}

      <div className="provider-list-container">
        {providers.map((provider) => {
          const isActive = provider.id === activeProviderId
          return (
            <div key={provider.id} className={`provider-card ${isActive ? 'active' : ''}`}>
              <div className="provider-card-main">
                <div className="provider-card-title-row">
                  <span className="provider-name">{provider.name}</span>
                  <span className="provider-type">{provider.type}</span>
                  {isActive && <span className="provider-active-badge">当前</span>}
                </div>
                <div className="provider-url">{provider.apiUrl || '未设置 API 地址'}</div>
              </div>

              <div className="provider-actions">
                {!isActive && (
                  <button
                    type="button"
                    className="provider-text-btn"
                    onClick={() => onSetActiveProvider(provider.id)}
                  >
                    设为当前
                  </button>
                )}
                <button
                  type="button"
                  className="provider-text-btn"
                  onClick={() => onStartEditingProvider(provider.id)}
                >
                  编辑
                </button>
                <button
                  type="button"
                  className="provider-delete-btn"
                  onClick={() => onDeleteProvider(provider.id)}
                  disabled={providers.length <= 1}
                  title="删除配置"
                >
                  <Trash2 size={12} />
                </button>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
