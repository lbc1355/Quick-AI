import React, { useState } from 'react'
import { ArrowLeft, Plus, RefreshCw, X, Eye, EyeOff, Trash2 } from 'lucide-react'
import { ApiProvider, ApiKeyItem, ProviderApiFormat } from '../../../shared/types'
import { getContextWindowInfo } from '../../../shared/modelContext'

interface ProviderEditorProps {
  provider: ApiProvider | undefined
  apiUrl: string
  selectedModel: string
  modelsList: string[]
  modelContextWindows: Record<string, number>
  manualModelInput: string
  fetchModelsUrl: string
  isFetchingModels: boolean
  refreshingModelContextId: string | null
  onSave: () => void
  onCancel: () => void
  onChangeName: (name: string) => void
  onChangeApiUrl: (apiUrl: string) => void
  onChangeSelectedModel: (model: string) => void
  onChangeManualModelInput: (val: string) => void
  onChangeFetchModelsUrl: (val: string) => void
  onAddManualModel: () => void
  onFetchModels: () => void
  onRefreshModelContext: (modelId: string) => void
  onRemoveModel: (modelId: string) => void
  onChangeModelContextWindow: (modelId: string, value: string) => void
  apiKeys: ApiKeyItem[]
  activeApiKeyId: string
  onSelectApiKey: (id: string) => void
  onChangeApiKeyItemName: (id: string, name: string) => void
  onChangeApiKeyValue: (id: string, value: string) => void
  onAddApiKey: () => void
  onDeleteApiKey: (id: string) => void
  onChangeApiFormat?: (format: ProviderApiFormat) => void
}

const formatContextTokens = (tokens: number): string => `${tokens.toLocaleString()} tokens`

export const ProviderEditor: React.FC<ProviderEditorProps> = ({
  provider,
  apiUrl,
  selectedModel,
  modelsList,
  modelContextWindows,
  manualModelInput,
  fetchModelsUrl,
  isFetchingModels,
  refreshingModelContextId,
  onSave,
  onCancel,
  onChangeName,
  onChangeApiUrl,
  onChangeSelectedModel,
  onChangeManualModelInput,
  onChangeFetchModelsUrl,
  onAddManualModel,
  onFetchModels,
  onRefreshModelContext,
  onRemoveModel,
  onChangeModelContextWindow,
  apiKeys,
  activeApiKeyId,
  onSelectApiKey,
  onChangeApiKeyItemName,
  onChangeApiKeyValue,
  onAddApiKey,
  onDeleteApiKey,
  onChangeApiFormat
}) => {
  const [visibleKeyIds, setVisibleKeyIds] = useState<Record<string, boolean>>({})

  const toggleKeyVisibility = (id: string) => {
    setVisibleKeyIds((prev) => ({
      ...prev,
      [id]: !prev[id]
    }))
  }
  if (!provider) return null

  return (
    <div className="provider-editor">
      <header className="provider-editor-header">
        <button type="button" className="settings-secondary-btn icon-left" onClick={onCancel}>
          <ArrowLeft size={14} />
          <span>返回</span>
        </button>
        <div>
          <h2>{provider.name}</h2>
          <p>{provider.type}</p>
        </div>
      </header>

      <div className="provider-editor-layout">
        <section className="provider-editor-section">
          <label className="settings-field">
            <span className="settings-label">配置名称</span>
            <input
              type="text"
              className="settings-input"
              placeholder="例如 DeepSeek"
              value={provider.name}
              onChange={(e) => onChangeName(e.target.value)}
            />
          </label>

          <div className="settings-field api-keys-management-field">
            <div className="api-keys-management-header">
              <span className="settings-label">API Key 管理</span>
              <button
                type="button"
                className="settings-secondary-btn icon-left add-key-btn"
                onClick={onAddApiKey}
              >
                <Plus size={12} />
                <span>添加 Key</span>
              </button>
            </div>

            <div className="api-keys-list">
              {apiKeys.map((keyItem) => {
                const isSelected = activeApiKeyId === keyItem.id
                const isVisible = visibleKeyIds[keyItem.id] || false

                return (
                  <div key={keyItem.id} className={`api-key-row ${isSelected ? 'active' : ''}`}>
                    <div className="api-key-select" title="启用该 Key">
                      <input
                        type="radio"
                        name="activeProviderKey"
                        checked={isSelected}
                        onChange={() => onSelectApiKey(keyItem.id)}
                      />
                    </div>

                    <input
                      type="text"
                      className="settings-input api-key-name-input"
                      placeholder="Key 名称"
                      value={keyItem.name}
                      onChange={(e) => onChangeApiKeyItemName(keyItem.id, e.target.value)}
                    />

                    <div className="api-key-value-wrapper">
                      <input
                        type={isVisible ? 'text' : 'password'}
                        className="settings-input api-key-value-input"
                        placeholder="sk-..."
                        value={keyItem.value}
                        onChange={(e) => onChangeApiKeyValue(keyItem.id, e.target.value)}
                      />
                      <button
                        type="button"
                        className="api-key-action-btn toggle-visibility-btn"
                        onClick={() => toggleKeyVisibility(keyItem.id)}
                        title={isVisible ? '隐藏' : '显示'}
                      >
                        {isVisible ? <EyeOff size={14} /> : <Eye size={14} />}
                      </button>
                    </div>

                    <button
                      type="button"
                      className="api-key-action-btn delete-key-btn"
                      onClick={() => onDeleteApiKey(keyItem.id)}
                      disabled={apiKeys.length <= 1}
                      title="删除该 Key"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                )
              })}
            </div>
          </div>

          <label className="settings-field">
            <span className="settings-label">API Base URL</span>
            <input
              type="text"
              className="settings-input"
              placeholder="https://api.deepseek.com/v1"
              value={apiUrl}
              onChange={(e) => onChangeApiUrl(e.target.value)}
            />
          </label>

          {provider.type === 'custom' && (
            <label className="settings-field">
              <span className="settings-label">接口格式</span>
              <select
                className="settings-select"
                value={provider.apiFormat || 'chat-completions'}
                onChange={(e) => onChangeApiFormat?.(e.target.value as ProviderApiFormat)}
              >
                <option value="chat-completions">Chat Completions / OpenAI Compatible</option>
                <option value="responses">Responses API</option>
              </select>
            </label>
          )}

          <label className="settings-field">
            <span className="settings-label">当前模型</span>
            <select
              className="settings-select"
              value={selectedModel}
              onChange={(e) => onChangeSelectedModel(e.target.value)}
            >
              {modelsList.map((model) => (
                <option key={model} value={model}>
                  {model}
                </option>
              ))}
            </select>
          </label>
        </section>

        <section className="provider-editor-section">
          <div className="settings-field">
            <span className="settings-label">模型列表</span>
            <div className="settings-inline-row">
              <input
                type="text"
                className="settings-input"
                placeholder="手动添加模型 ID"
                value={manualModelInput}
                onChange={(e) => onChangeManualModelInput(e.target.value)}
              />
              <button
                type="button"
                className="settings-icon-btn"
                onClick={onAddManualModel}
                title="添加模型"
              >
                <Plus size={14} />
              </button>
            </div>
          </div>

          <div className="settings-field">
            <span className="settings-label">远程获取</span>
            <div className="settings-inline-row">
              <input
                type="text"
                className="settings-input"
                placeholder="模型列表接口"
                value={fetchModelsUrl}
                onChange={(e) => onChangeFetchModelsUrl(e.target.value)}
              />
              <button
                type="button"
                className="settings-save-btn fetch-models-btn"
                onClick={onFetchModels}
                disabled={isFetchingModels}
              >
                {isFetchingModels ? '获取中' : '获取'}
              </button>
            </div>
          </div>

          <div className="model-context-list">
            {modelsList.map((model) => {
              const automaticContext = getContextWindowInfo(model).tokens
              const configuredContext = modelContextWindows[model]
              return (
                <div key={model} className="model-context-row">
                  <div className="model-context-main">
                    <div className="model-context-name-row">
                      <span className="model-context-name">{model}</span>
                      <button
                        type="button"
                        className="model-context-refresh-btn"
                        onClick={() => onRefreshModelContext(model)}
                        disabled={refreshingModelContextId === model}
                        title="刷新上下文长度"
                      >
                        <RefreshCw
                          size={12}
                          className={refreshingModelContextId === model ? 'spin' : undefined}
                        />
                      </button>
                    </div>
                    <small>Auto {formatContextTokens(automaticContext)}</small>
                  </div>
                  <label className="model-context-field">
                    <span>Context</span>
                    <input
                      type="number"
                      className="settings-input model-context-input"
                      min={2000}
                      max={10000000}
                      step={1000}
                      placeholder={String(automaticContext)}
                      value={configuredContext ?? ''}
                      onChange={(e) => onChangeModelContextWindow(model, e.target.value)}
                    />
                  </label>
                  <button type="button" onClick={() => onRemoveModel(model)} title="移出列表">
                    <X size={12} />
                  </button>
                </div>
              )
            })}
          </div>
        </section>
      </div>

      <footer className="provider-editor-footer">
        <button type="button" className="settings-save-btn" onClick={onSave}>
          保存并返回
        </button>
        <button type="button" className="settings-secondary-btn" onClick={onCancel}>
          取消
        </button>
      </footer>
    </div>
  )
}
