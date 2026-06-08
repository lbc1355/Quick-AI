import React from 'react'
import { ArrowLeft, Plus, X } from 'lucide-react'
import { ApiProvider } from '../../../shared/types'

interface ProviderEditorProps {
  provider: ApiProvider | undefined
  apiKey: string
  apiUrl: string
  selectedModel: string
  modelsList: string[]
  manualModelInput: string
  fetchModelsUrl: string
  isFetchingModels: boolean
  onSave: () => void
  onCancel: () => void
  onChangeName: (name: string) => void
  onChangeApiKey: (apiKey: string) => void
  onChangeApiUrl: (apiUrl: string) => void
  onChangeSelectedModel: (model: string) => void
  onChangeManualModelInput: (val: string) => void
  onChangeFetchModelsUrl: (val: string) => void
  onAddManualModel: () => void
  onFetchModels: () => void
  onRemoveModel: (modelId: string) => void
}

export const ProviderEditor: React.FC<ProviderEditorProps> = ({
  provider,
  apiKey,
  apiUrl,
  selectedModel,
  modelsList,
  manualModelInput,
  fetchModelsUrl,
  isFetchingModels,
  onSave,
  onCancel,
  onChangeName,
  onChangeApiKey,
  onChangeApiUrl,
  onChangeSelectedModel,
  onChangeManualModelInput,
  onChangeFetchModelsUrl,
  onAddManualModel,
  onFetchModels,
  onRemoveModel
}) => {
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

          <label className="settings-field">
            <span className="settings-label">API Key</span>
            <input
              type="password"
              className="settings-input"
              placeholder="sk-..."
              value={apiKey}
              onChange={(e) => onChangeApiKey(e.target.value)}
            />
          </label>

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

          <div className="model-pill-list">
            {modelsList.map((model) => (
              <span key={model} className="model-pill">
                <span>{model}</span>
                <button type="button" onClick={() => onRemoveModel(model)} title="移出列表">
                  <X size={10} />
                </button>
              </span>
            ))}
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
