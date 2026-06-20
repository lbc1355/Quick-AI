import React from 'react'
import { Check, Pencil, Plus, Server, Trash2 } from 'lucide-react'
import { ApiProvider } from '../../../shared/types'
import { getProviderTypeLabel, PROVIDER_PRESETS } from '../utils/providerPresets'

interface ProviderListProps {
  providers: ApiProvider[]
  activeProviderId: string
  showAddForm: boolean
  newProviderName: string
  newProviderType: ApiProvider['type']
  setShowAddForm: (show: boolean) => void
  setNewProviderName: (name: string) => void
  setNewProviderType: (type: ApiProvider['type']) => void
  onAddProvider: (name: string, type: ApiProvider['type']) => void
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
        <span className="provider-count">{providers.length} 个服务商</span>
      </div>

      <div className="provider-list-container">
        {!showAddForm && (
          <button
            type="button"
            className="provider-card provider-add-card"
            onClick={() => setShowAddForm(true)}
          >
            <span className="provider-add-icon">
              <Plus size={18} />
            </span>
            <span className="provider-add-title">新增服务商</span>
            <span className="provider-add-description">添加 OpenAI 兼容接口或本地模型服务</span>
          </button>
        )}

        {showAddForm && (
          <div className="provider-card provider-add-form-card">
            <div className="provider-add-form-header">
              <span className="provider-add-icon">
                <Plus size={16} />
              </span>
              <div>
                <strong>新增服务商</strong>
                <small>创建后进入编辑页配置 Key、地址和模型。</small>
              </div>
            </div>

            <label className="settings-field">
              <span className="settings-label">类型</span>
              <select
                className="settings-select"
                value={newProviderType}
                onChange={(e) => setNewProviderType(e.target.value as ApiProvider['type'])}
              >
                {PROVIDER_PRESETS.map((preset) => (
                  <option key={preset.type} value={preset.type}>
                    {preset.name}
                  </option>
                ))}
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
              <button
                type="button"
                className="settings-save-btn"
                onClick={handleAddProvider}
                disabled={!newProviderName.trim()}
              >
                添加
              </button>
            </div>
          </div>
        )}

        {providers.map((provider) => {
          const isActive = provider.id === activeProviderId
          const configuredModels = provider.modelsList?.length || 0
          return (
            <div key={provider.id} className={`provider-card ${isActive ? 'active' : ''}`}>
              <div className="provider-card-main">
                <div className="provider-card-head">
                  <span className="provider-icon">
                    <Server size={16} />
                  </span>
                  <div className="provider-card-title-row">
                    <span className="provider-name" title={provider.name}>
                      {provider.name}
                    </span>
                    <span className="provider-type">{getProviderTypeLabel(provider.type)}</span>
                  </div>
                </div>
                <div className="provider-url" title={provider.apiUrl || '未设置 API 地址'}>
                  {provider.apiUrl || '未设置 API 地址'}
                </div>
                <div className="provider-meta-row">
                  <span>{provider.model || '未选择模型'}</span>
                  <span>{configuredModels} models</span>
                </div>
              </div>

              <div className="provider-actions">
                {isActive ? (
                  <span className="provider-active-badge">
                    <Check size={12} />
                    当前
                  </span>
                ) : (
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
                  className="provider-icon-action"
                  onClick={() => onStartEditingProvider(provider.id)}
                  title="编辑"
                >
                  <Pencil size={13} />
                </button>
                <button
                  type="button"
                  className="provider-icon-action danger"
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
