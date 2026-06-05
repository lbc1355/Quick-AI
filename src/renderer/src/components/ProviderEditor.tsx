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
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px' }}>
        <button
          className="header-action-btn"
          style={{
            background: 'rgba(255,255,255,0.05)',
            borderRadius: '6px',
            padding: '4px 8px',
            border: '1px solid var(--color-border)',
            color: 'var(--color-text)',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '4px'
          }}
          onClick={onCancel}
        >
          <ArrowLeft size={14} />
          <span>返回</span>
        </button>
        <div className="settings-header" style={{ margin: 0 }}>
          编辑服务商: {provider.name}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: '20px' }}>
        {/* Left side: Inputs */}
        <div>
          <div className="settings-group">
            <label className="settings-label">服务自定义名称 (Custom Config Name)</label>
            <input
              type="text"
              className="settings-input"
              placeholder="例如: DeepSeek 官方"
              value={provider.name}
              onChange={(e) => onChangeName(e.target.value)}
            />
          </div>

          <div className="settings-group">
            <label className="settings-label">API Key</label>
            <input
              type="password"
              className="settings-input"
              placeholder="输入您的 API Key"
              value={apiKey}
              onChange={(e) => onChangeApiKey(e.target.value)}
            />
          </div>

          <div className="settings-group">
            <label className="settings-label">API 基础网址 (URL Base)</label>
            <input
              type="text"
              className="settings-input"
              placeholder="https://api.deepseek.com/v1"
              value={apiUrl}
              onChange={(e) => onChangeApiUrl(e.target.value)}
            />
          </div>

          <div className="settings-group">
            <label className="settings-label">当前选用模型 (Model)</label>
            <select
              className="settings-select"
              value={selectedModel}
              onChange={(e) => onChangeSelectedModel(e.target.value)}
            >
              {modelsList.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Right side: Model Management */}
        <div>
          <div
            className="settings-group"
            style={{
              background: 'rgba(255,255,255,0.01)',
              border: '1px solid var(--color-border)',
              borderRadius: '8px',
              padding: '12px'
            }}
          >
            <label
              className="settings-label"
              style={{ display: 'flex', alignItems: 'center', gap: '4px', color: '#60a5fa' }}
            >
              模型列表管理
            </label>

            {/* Manual configuration mode */}
            <div style={{ display: 'flex', gap: '6px', marginTop: '6px' }}>
              <input
                type="text"
                className="settings-input"
                style={{ flex: 1, height: '30px', padding: '4px 8px', fontSize: '12px' }}
                placeholder="手动添加模型 ID (例: gpt-4o)"
                value={manualModelInput}
                onChange={(e) => onChangeManualModelInput(e.target.value)}
              />
              <button
                className="settings-save-btn"
                style={{ margin: 0, padding: '4px 10px', height: '30px', borderRadius: '6px' }}
                onClick={onAddManualModel}
              >
                <Plus size={14} />
              </button>
            </div>

            {/* Fetch from URL mode */}
            <div
              style={{
                display: 'flex',
                gap: '6px',
                marginTop: '8px',
                borderTop: '1px solid rgba(255,255,255,0.04)',
                paddingTop: '8px'
              }}
            >
              <input
                type="text"
                className="settings-input"
                style={{ flex: 1, height: '30px', padding: '4px 8px', fontSize: '11px' }}
                placeholder="从网址获取模型列表"
                value={fetchModelsUrl}
                onChange={(e) => onChangeFetchModelsUrl(e.target.value)}
              />
              <button
                className="settings-save-btn"
                style={{
                  margin: 0,
                  padding: '4px 8px',
                  height: '30px',
                  borderRadius: '6px',
                  fontSize: '11.5px',
                  whiteSpace: 'nowrap'
                }}
                onClick={onFetchModels}
                disabled={isFetchingModels}
              >
                {isFetchingModels ? '获取中..' : '获取模型'}
              </button>
            </div>

            {/* Current Models list with direct remove */}
            <div style={{ marginTop: '10px' }}>
              <span style={{ fontSize: '11px', color: '#9ca3af', fontWeight: 'bold' }}>
                已加入的候选模型：
              </span>
              <div
                style={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  gap: '4px',
                  marginTop: '6px',
                  maxHeight: '130px',
                  overflowY: 'auto'
                }}
              >
                {modelsList.map((m) => (
                  <div
                    key={m}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '4px',
                      background: 'rgba(255,255,255,0.05)',
                      border: '1px solid rgba(255,255,255,0.06)',
                      borderRadius: '4px',
                      padding: '2px 6px',
                      fontSize: '11px'
                    }}
                  >
                    <span>{m}</span>
                    <button
                      style={{
                        background: 'transparent',
                        border: 'none',
                        color: '#ef4444',
                        cursor: 'pointer',
                        padding: '0 2px',
                        display: 'flex',
                        alignItems: 'center'
                      }}
                      onClick={() => onRemoveModel(m)}
                      title="移出列表"
                    >
                      <X size={10} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
          marginTop: '20px',
          borderTop: '1px solid var(--color-border)',
          paddingTop: '12px'
        }}
      >
        <button className="settings-save-btn" onClick={onSave}>
          保存并返回
        </button>
        <button
          className="edit-btn cancel"
          style={{
            padding: '6px 16px',
            height: '32px',
            borderRadius: '6px',
            fontSize: '12px',
            display: 'flex',
            alignItems: 'center'
          }}
          onClick={onCancel}
        >
          取消
        </button>
      </div>
    </div>
  )
}
