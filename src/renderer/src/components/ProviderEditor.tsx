import React, { useState } from 'react'
import {
  ArrowLeft,
  Plus,
  RefreshCw,
  X,
  Eye,
  EyeOff,
  Trash2,
  ShieldCheck,
  Sliders,
  Server,
  Cpu
} from 'lucide-react'
import {
  ModelPromptProfile,
  ModelReasoningControl,
  ProviderApiFormat,
  ProviderAuthType,
  ProviderConnectionTestResult,
  ReasoningLevel
} from '../../../shared/types'
import { getContextWindowInfo } from '../../../shared/modelContext'
import { parseModelRequestBodyOverrides } from '../../../shared/modelRequestBody'
import {
  buildReasoningControlFromPreset,
  DEFAULT_EFFORT_LEVELS,
  getReasoningControlPresetId,
  getReasoningControlPresetLevels,
  ReasoningControlPresetId
} from '../../../shared/reasoningControlPresets'
import { useSettings } from '../contexts/SettingsContext'

const REASONING_LEVEL_OPTIONS: ReasoningLevel[] = [
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max'
]

const REASONING_LEVEL_LABELS: Record<ReasoningLevel, string> = {
  minimal: '极低',
  low: '低',
  medium: '中',
  high: '高',
  xhigh: '极高',
  max: '最大'
}

const formatContextTokens = (tokens: number): string => `${tokens.toLocaleString()} tokens`

const formatDiscoveryTime = (timestamp: number): string =>
  new Date(timestamp).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  })

const CONNECTION_FAILURE_LABELS: Record<
  Exclude<ProviderConnectionTestResult['code'], 'ok'>,
  string
> = {
  authentication: '鉴权失败，请检查 API Key',
  permission: '账号无权访问模型列表',
  not_found: '模型列表端点不存在',
  rate_limited: '请求被限流，请稍后重试',
  server_error: '服务商服务器异常',
  http_error: '服务商返回 HTTP 错误',
  timeout: '连接超时',
  invalid_response: '响应不是有效的模型列表 JSON',
  empty_catalog: '连接成功，但没有返回模型',
  network_error: '网络连接失败'
}

const formatConnectionDiagnostic = (result: ProviderConnectionTestResult): string =>
  result.ok
    ? `连接正常 · ${result.latencyMs} ms · ${result.modelCount || 0} 个模型`
    : `${CONNECTION_FAILURE_LABELS[result.code as Exclude<typeof result.code, 'ok'>]}：${result.message}`

export const ProviderEditor: React.FC = () => {
  const {
    editingProviderId,
    providers,
    apiUrl,
    selectedModel,
    modelsList,
    modelContextWindows,
    manualModelInput,
    fetchModelsUrl,
    isFetchingModels,
    isTestingProviderConnection,
    providerConnectionTest,
    refreshingModelContextId,
    apiKeys,
    activeApiKeyId,
    providerAuthType,
    setProviderAuthType,
    providerAuthHeader,
    setProviderAuthHeader,
    providerHeaders,
    setIsEditingProviderDetail,
    setSelectedModel,
    setManualModelInput,
    setFetchModelsUrl,
    handleSaveProviderDetails: onSave,
    handleChangeEditingProviderName: onChangeName,
    handleApiUrlChange: onChangeApiUrl,
    handleAddManualModel: onAddManualModel,
    handleFetchModels: onFetchModels,
    handleTestProviderConnection: onTestProviderConnection,
    handleRefreshModelContext: onRefreshModelContext,
    handleRemoveModelDirectly: onRemoveModel,
    handleChangeModelContextWindow: onChangeModelContextWindow,
    handleSelectApiKey: onSelectApiKey,
    handleChangeApiKeyItemName: onChangeApiKeyItemName,
    handleChangeApiKeyValue: onChangeApiKeyValue,
    handleAddApiKey: onAddApiKey,
    handleDeleteApiKey: onDeleteApiKey,
    handleAddProviderHeader: onAddProviderHeader,
    handleChangeProviderHeader: onChangeProviderHeader,
    handleDeleteProviderHeader: onDeleteProviderHeader,
    handleChangeEditingProviderApiFormat: onChangeApiFormat,
    handleChangeEditingProviderPromptProfile: onChangePromptProfile,
    handleChangeEditingProviderDefaultReasoningControl: onChangeDefaultReasoningControl,
    handleChangeEditingModelAdvancedConfig: onChangeModelAdvancedConfig
  } = useSettings()
  const [visibleKeyIds, setVisibleKeyIds] = useState<Record<string, boolean>>({})
  const [expandedModelId, setExpandedModelId] = useState<string | null>(null)
  const [requestBodyDrafts, setRequestBodyDrafts] = useState<Record<string, string>>({})
  const [requestBodyErrors, setRequestBodyErrors] = useState<Record<string, string | undefined>>({})

  const provider = providers.find((p) => p.id === editingProviderId)
  const onCancel = (): void => setIsEditingProviderDetail(false)
  const onChangeSelectedModel = setSelectedModel
  const onChangeManualModelInput = setManualModelInput
  const onChangeFetchModelsUrl = setFetchModelsUrl

  const updateModelAdvancedConfig = (
    modelId: string,
    patch: {
      requestBodyOverrides?: Record<string, unknown>
      reasoningControlOverride?: ModelReasoningControl
      reasoningResponseFormat?: 'closing-think-tag'
    }
  ): void => {
    onChangeModelAdvancedConfig(modelId, patch)
  }

  const handleRequestBodyDraftChange = (modelId: string, text: string): void => {
    const draftKey = `${editingProviderId}\u0000${modelId}`
    setRequestBodyDrafts((previous) => ({ ...previous, [draftKey]: text }))
    try {
      const overrides = parseModelRequestBodyOverrides(text)
      setRequestBodyErrors((previous) => ({ ...previous, [draftKey]: undefined }))
      updateModelAdvancedConfig(modelId, { requestBodyOverrides: overrides })
    } catch (error) {
      setRequestBodyErrors((previous) => ({
        ...previous,
        [draftKey]: error instanceof Error ? error.message : '请求体 JSON 无效。'
      }))
    }
  }

  const toggleKeyVisibility = (id: string): void => {
    setVisibleKeyIds((prev) => ({
      ...prev,
      [id]: !prev[id]
    }))
  }
  if (!provider) return null
  const modelDiscovery =
    provider.modelDiscovery?.sourceUrl === fetchModelsUrl.trim()
      ? provider.modelDiscovery
      : undefined
  const requestBodyDraftPrefix = `${provider.id}\u0000`
  const hasRequestBodyErrors = Object.entries(requestBodyErrors).some(
    ([key, error]) =>
      key.startsWith(requestBodyDraftPrefix) &&
      modelsList.includes(key.slice(requestBodyDraftPrefix.length)) &&
      Boolean(error)
  )

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
        {/* 左侧栏 */}
        <section className="provider-editor-section">
          {/* 卡片 1: 基础配置与鉴权 */}
          <div className="settings-card">
            <div className="settings-card-header">
              <span className="settings-card-title">
                <ShieldCheck size={14} /> 基础与鉴权配置
              </span>
            </div>

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
              <span className="settings-label">鉴权方式</span>
              <select
                className="settings-select"
                value={providerAuthType}
                onChange={(event) => setProviderAuthType(event.target.value as ProviderAuthType)}
              >
                <option value="bearer">Bearer Token (默认推荐)</option>
                <option value="header">指定 Header (自定义名称)</option>
                <option value="none">无需鉴权 (本地免密服务)</option>
              </select>
            </label>

            {providerAuthType === 'header' && (
              <label className="settings-field">
                <span className="settings-label">鉴权 Header 名称</span>
                <input
                  type="text"
                  className="settings-input"
                  placeholder="X-API-Key"
                  value={providerAuthHeader}
                  onChange={(event) => setProviderAuthHeader(event.target.value)}
                />
              </label>
            )}

            {providerAuthType !== 'none' && (
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
            )}
          </div>

          {/* 卡片 2: 高级与协议 */}
          <div className="settings-card">
            <div className="settings-card-header">
              <span className="settings-card-title">
                <Sliders size={14} /> 协议与高级参数
              </span>
            </div>

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

            {provider.type === 'custom' && (
              <>
                <label className="settings-field">
                  <span className="settings-label">推理控制协议</span>
                  <select
                    className="settings-select"
                    value={getReasoningControlPresetId(provider.defaultReasoningControl)}
                    onChange={(e) => {
                      const preset = e.target.value as ReasoningControlPresetId
                      const levels = getReasoningControlPresetLevels(
                        provider.defaultReasoningControl
                      )
                      onChangeDefaultReasoningControl(
                        buildReasoningControlFromPreset(preset, levels)
                      )
                    }}
                  >
                    <option value="none">无</option>
                    <option value="fixed">固定推理</option>
                    <option value="openai-effort">OpenAI effort</option>
                    <option value="openrouter-reasoning">OpenRouter reasoning effort</option>
                    <option value="openrouter-budget">OpenRouter budget</option>
                    <option value="qwen-enable-thinking">Qwen enable_thinking</option>
                    <option value="deepseek-thinking-toggle">DeepSeek thinking toggle</option>
                  </select>
                  <small>许多 /models 接口不会完整返回推理控制能力，可在此手动声明协议。</small>
                </label>
                {(provider.defaultReasoningControl?.mode === 'effort' ||
                  provider.defaultReasoningControl?.mode === 'budget') && (
                  <div className="settings-field">
                    <span className="settings-label">支持的思考强度等级</span>
                    <div className="reasoning-level-checklist">
                      {REASONING_LEVEL_OPTIONS.map((level) => {
                        const selected = new Set(
                          getReasoningControlPresetLevels(provider.defaultReasoningControl)
                        )
                        const checked = selected.has(level)
                        return (
                          <label key={level} className="reasoning-level-check">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => {
                                const next = new Set(selected)
                                if (checked) next.delete(level)
                                else next.add(level)
                                const levels =
                                  next.size > 0
                                    ? REASONING_LEVEL_OPTIONS.filter((item) => next.has(item))
                                    : DEFAULT_EFFORT_LEVELS
                                const preset = getReasoningControlPresetId(
                                  provider.defaultReasoningControl
                                )
                                onChangeDefaultReasoningControl(
                                  buildReasoningControlFromPreset(preset, levels)
                                )
                              }}
                            />
                            <span>{REASONING_LEVEL_LABELS[level]}</span>
                          </label>
                        )
                      })}
                    </div>
                  </div>
                )}
              </>
            )}

            <label className="settings-field">
              <span className="settings-label">Prompt 适配</span>
              <select
                className="settings-select"
                value={provider.promptProfile || 'auto'}
                onChange={(e) =>
                  onChangePromptProfile(
                    e.target.value === 'auto' ? undefined : (e.target.value as ModelPromptProfile)
                  )
                }
              >
                <option value="auto">自动识别模型家族</option>
                <option value="default">通用</option>
                <option value="gpt">GPT / Codex</option>
                <option value="claude">Claude</option>
                <option value="gemini">Gemini</option>
                <option value="reasoning">推理模型 (DeepSeek R1 / o1)</option>
              </select>
              <small>针对模型特点注入针对性行为提示，不影响 API 协议或模型 ID。</small>
            </label>

            <div className="settings-field provider-headers-field">
              <div className="api-keys-management-header">
                <span className="settings-label">附加 Headers</span>
                <button
                  type="button"
                  className="settings-secondary-btn icon-left add-key-btn"
                  onClick={onAddProviderHeader}
                >
                  <Plus size={12} />
                  <span>添加 Header</span>
                </button>
              </div>
              {providerHeaders.length === 0 ? (
                <small>无附加 Header。标准鉴权 Header 不需要在此重复填写。</small>
              ) : (
                <div className="provider-headers-list">
                  {providerHeaders.map((header) => (
                    <div key={header.id} className="provider-header-row">
                      <input
                        type="text"
                        className="settings-input"
                        placeholder="Header 名称"
                        value={header.name}
                        onChange={(event) =>
                          onChangeProviderHeader(header.id, 'name', event.target.value)
                        }
                      />
                      <div className="api-key-value-wrapper provider-header-value-input">
                        <input
                          type={visibleKeyIds[header.id] ? 'text' : 'password'}
                          className="settings-input api-key-value-input"
                          placeholder="Header 值"
                          value={header.value}
                          onChange={(event) =>
                            onChangeProviderHeader(header.id, 'value', event.target.value)
                          }
                        />
                        <button
                          type="button"
                          className="api-key-action-btn toggle-visibility-btn"
                          onClick={() => toggleKeyVisibility(header.id)}
                          title={visibleKeyIds[header.id] ? '隐藏' : '显示'}
                        >
                          {visibleKeyIds[header.id] ? <EyeOff size={14} /> : <Eye size={14} />}
                        </button>
                      </div>
                      <button
                        type="button"
                        className="api-key-action-btn delete-key-btn"
                        onClick={() => onDeleteProviderHeader(header.id)}
                        title="删除 Header"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </section>

        {/* 右侧栏 */}
        <section className="provider-editor-section">
          {/* 卡片 3: 模型拉取与配置 */}
          <div className="settings-card">
            <div className="settings-card-header">
              <span className="settings-card-title">
                <Server size={14} /> 远程模型获取与发现
              </span>
            </div>

            <div className="settings-field">
              <span className="settings-label">模型列表获取端点</span>
              <div className="settings-inline-row">
                <input
                  type="text"
                  className="settings-input"
                  placeholder="https://api.example.com/v1/models"
                  value={fetchModelsUrl}
                  onChange={(e) => onChangeFetchModelsUrl(e.target.value)}
                />
                <button
                  type="button"
                  className="settings-secondary-btn connection-test-btn"
                  onClick={onTestProviderConnection}
                  disabled={isTestingProviderConnection || isFetchingModels}
                >
                  {isTestingProviderConnection ? '测试中' : '测试连接'}
                </button>
                <button
                  type="button"
                  className="settings-save-btn fetch-models-btn"
                  onClick={onFetchModels}
                  disabled={isFetchingModels || isTestingProviderConnection}
                >
                  {isFetchingModels ? '获取中' : '获取列表'}
                </button>
              </div>
              {providerConnectionTest && (
                <small
                  className={`provider-connection-diagnostic ${providerConnectionTest.ok ? 'success' : 'error'}`}
                  title={providerConnectionTest.endpoint}
                >
                  {formatConnectionDiagnostic(providerConnectionTest)}
                </small>
              )}
              {modelDiscovery && (
                <small
                  className={`provider-model-discovery-status ${modelDiscovery.error ? 'error' : ''}`}
                  title={modelDiscovery.error}
                >
                  {modelDiscovery.error
                    ? `上次检查失败，继续使用已缓存的 ${modelDiscovery.models.length} 个模型：${modelDiscovery.error}`
                    : `已缓存 ${modelDiscovery.models.length} 个模型${
                        modelDiscovery.refreshedAt
                          ? ` · 更新于 ${formatDiscoveryTime(modelDiscovery.refreshedAt)}`
                          : ''
                      }`}
                </small>
              )}
            </div>

            {/* 模型列表项 */}
            <div className="settings-field">
              <span className="settings-label">已知模型列表 (点击模型记录设为默认模型)</span>
              <div className="model-context-list">
                {modelsList.map((model) => {
                  const isDefault = selectedModel === model
                  const automaticContext = getContextWindowInfo(model).tokens
                  const configuredContext = modelContextWindows[model]
                  const modelInfo = provider.models?.[model]
                  const modelReasoningControl = modelInfo?.reasoningControlOverride
                  const requestBodyDraftKey = `${provider.id}\u0000${model}`
                  const requestBodyDraft =
                    requestBodyDrafts[requestBodyDraftKey] ??
                    JSON.stringify(modelInfo?.requestBodyOverrides || {}, null, 2)
                  const requestBodyError = requestBodyErrors[requestBodyDraftKey]
                  const isAdvancedOpen = provider.type === 'custom' && expandedModelId === model

                  return (
                    <React.Fragment key={model}>
                      <div
                        className={`model-context-row ${isDefault ? 'is-default' : ''} ${isAdvancedOpen ? 'advanced-open' : ''}`}
                      >
                        <div
                          className="model-context-main"
                          onClick={() => onChangeSelectedModel(model)}
                          title={isDefault ? '当前默认模型' : '点击设为默认模型'}
                        >
                          <div className="model-context-name-row">
                            <span className="model-context-name" title={model}>
                              {model}
                            </span>
                            {isDefault && <span className="default-model-badge">默认</span>}
                            <button
                              type="button"
                              className="model-context-refresh-btn"
                              onClick={(e) => {
                                e.stopPropagation()
                                onRefreshModelContext(model)
                              }}
                              disabled={refreshingModelContextId === model}
                              title="刷新上下文长度"
                            >
                              <RefreshCw
                                size={11}
                                className={refreshingModelContextId === model ? 'spin' : undefined}
                              />
                            </button>
                          </div>
                          <small>Auto {formatContextTokens(automaticContext)}</small>
                        </div>

                        <div className="model-context-field-group">
                          <label className="model-context-field">
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
                          <div className="context-preset-chips">
                            {[8000, 32000, 128000, 200000, 1000000].map((preset) => (
                              <button
                                key={preset}
                                type="button"
                                className="context-chip"
                                onClick={() => onChangeModelContextWindow(model, String(preset))}
                                title={`填入 ${preset.toLocaleString()} tokens`}
                              >
                                {preset >= 1000000 ? `${preset / 1000000}M` : `${preset / 1000}k`}
                              </button>
                            ))}
                          </div>
                        </div>

                        <div className="model-context-actions">
                          {provider.type === 'custom' && (
                            <button
                              type="button"
                              className={`model-advanced-btn ${isAdvancedOpen ? 'active' : ''}`}
                              onClick={() => setExpandedModelId(isAdvancedOpen ? null : model)}
                              title="模型高级请求配置"
                            >
                              <Sliders size={13} />
                            </button>
                          )}
                          <button
                            type="button"
                            className="remove-model-btn"
                            onClick={() => onRemoveModel(model)}
                            title="移出列表"
                          >
                            <X size={13} />
                          </button>
                        </div>
                      </div>

                      {isAdvancedOpen && (
                        <div className="custom-model-advanced-panel">
                          <div className="custom-model-advanced-header">
                            <div>
                              <strong>{model}</strong>
                              <small>仅作用于这个自定义模型</small>
                            </div>
                          </div>

                          <label className="settings-field">
                            <span className="settings-label">模型级推理控制</span>
                            <select
                              className="settings-select"
                              value={getReasoningControlPresetId(modelReasoningControl)}
                              onChange={(event) => {
                                const preset = event.target.value as ReasoningControlPresetId
                                updateModelAdvancedConfig(model, {
                                  reasoningControlOverride: buildReasoningControlFromPreset(
                                    preset,
                                    getReasoningControlPresetLevels(modelReasoningControl)
                                  )
                                })
                              }}
                            >
                              <option value="none">继承服务商</option>
                              <option value="fixed">固定推理</option>
                              <option value="openai-effort">OpenAI effort</option>
                              <option value="openrouter-reasoning">
                                OpenRouter reasoning effort
                              </option>
                              <option value="openrouter-budget">OpenRouter budget</option>
                              <option value="qwen-enable-thinking">Qwen enable_thinking</option>
                              <option value="deepseek-thinking-toggle">
                                DeepSeek thinking toggle
                              </option>
                            </select>
                          </label>

                          {(modelReasoningControl?.mode === 'effort' ||
                            modelReasoningControl?.mode === 'budget') && (
                            <div className="settings-field">
                              <span className="settings-label">模型支持的思考强度</span>
                              <div className="reasoning-level-checklist">
                                {REASONING_LEVEL_OPTIONS.map((level) => {
                                  const selected = new Set(
                                    getReasoningControlPresetLevels(modelReasoningControl)
                                  )
                                  const checked = selected.has(level)
                                  return (
                                    <label key={level} className="reasoning-level-check">
                                      <input
                                        type="checkbox"
                                        checked={checked}
                                        onChange={() => {
                                          const next = new Set(selected)
                                          if (checked) next.delete(level)
                                          else next.add(level)
                                          const levels =
                                            next.size > 0
                                              ? REASONING_LEVEL_OPTIONS.filter((item) =>
                                                  next.has(item)
                                                )
                                              : DEFAULT_EFFORT_LEVELS
                                          updateModelAdvancedConfig(model, {
                                            reasoningControlOverride:
                                              buildReasoningControlFromPreset(
                                                getReasoningControlPresetId(modelReasoningControl),
                                                levels
                                              )
                                          })
                                        }}
                                      />
                                      <span>{REASONING_LEVEL_LABELS[level]}</span>
                                    </label>
                                  )
                                })}
                              </div>
                            </div>
                          )}

                          <label className="settings-field">
                            <span className="settings-label">思维链响应格式</span>
                            <select
                              className="settings-select"
                              value={
                                modelInfo?.compatibility?.reasoningResponseFormat || 'standard'
                              }
                              onChange={(event) =>
                                updateModelAdvancedConfig(model, {
                                  reasoningResponseFormat:
                                    event.target.value === 'closing-think-tag'
                                      ? 'closing-think-tag'
                                      : undefined
                                })
                              }
                            >
                              <option value="standard">标准 reasoning_content / think 标签</option>
                              <option value="closing-think-tag">
                                仅结束标签 &lt;/think&gt;（微信 Coding Plan）
                              </option>
                            </select>
                          </label>

                          <label className="settings-field custom-model-request-body-field">
                            <span className="settings-label">附加请求体 JSON</span>
                            <textarea
                              className={`settings-textarea custom-model-request-body ${requestBodyError ? 'error' : ''}`}
                              spellCheck={false}
                              value={requestBodyDraft}
                              onChange={(event) =>
                                handleRequestBodyDraftChange(model, event.target.value)
                              }
                              placeholder={'{\n  "thinking": { "type": "enabled" }\n}'}
                            />
                            {requestBodyError ? (
                              <small className="custom-model-request-error">
                                {requestBodyError}
                              </small>
                            ) : (
                              <small>
                                深度合并到该模型请求；model、messages、tools、stream
                                等核心字段不可覆盖。
                              </small>
                            )}
                          </label>
                        </div>
                      )}
                    </React.Fragment>
                  )
                })}
              </div>
            </div>
          </div>

          {/* 卡片 4: 手动添加模型 */}
          <div className="settings-card">
            <div className="settings-card-header">
              <span className="settings-card-title">
                <Cpu size={14} /> 手动添加模型
              </span>
            </div>

            <div className="settings-field">
              <div className="settings-inline-row">
                <input
                  type="text"
                  className="settings-input"
                  placeholder="例如 custom-gpt-4o-mini"
                  value={manualModelInput}
                  onChange={(e) => onChangeManualModelInput(e.target.value)}
                />
                <button
                  type="button"
                  className="settings-save-btn icon-left"
                  onClick={onAddManualModel}
                  title="添加模型"
                >
                  <Plus size={14} />
                  <span>添加</span>
                </button>
              </div>
            </div>
          </div>
        </section>
      </div>

      <footer className="provider-editor-footer">
        <button
          type="button"
          className="settings-save-btn"
          onClick={onSave}
          disabled={hasRequestBodyErrors}
          title={hasRequestBodyErrors ? '请先修正模型请求体 JSON' : undefined}
        >
          保存
        </button>
        <button type="button" className="settings-secondary-btn" onClick={onCancel}>
          取消
        </button>
      </footer>
    </div>
  )
}
