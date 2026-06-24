import React from 'react'
import type { AgentToolInfo, WebSearchProviderType } from '../../../../shared/types'
import { CapabilitiesPanel } from '../CapabilitiesPanel'
import type { ToolDisplayLanguage } from './toolDisplay'

type ToolPermission = 'allow' | 'ask' | 'deny'

interface AgentSettingsSectionProps {
  agentTools: AgentToolInfo[]
  permissions: Record<string, ToolPermission>
  toolDisplayLanguage: ToolDisplayLanguage
  webSearchProvider: WebSearchProviderType
  webSearchApiKey: string
  onToolDisplayLanguageChange: (language: ToolDisplayLanguage) => void
  getToolDisplay: (
    tool: AgentToolInfo,
    language: ToolDisplayLanguage
  ) => { title: string; description: string }
  onChangeToolPermission: (toolName: string, policy: ToolPermission) => void
  onChangeWebSearchProvider: (value: WebSearchProviderType) => void
  onChangeWebSearchApiKey: (value: string) => void
}

export const AgentSettingsSection: React.FC<AgentSettingsSectionProps> = ({
  agentTools,
  permissions,
  toolDisplayLanguage,
  webSearchProvider,
  webSearchApiKey,
  onToolDisplayLanguageChange,
  getToolDisplay,
  onChangeToolPermission,
  onChangeWebSearchProvider,
  onChangeWebSearchApiKey
}) => {
  return (
    <section className="control-section">
      <header className="control-section-header">
        <div>
          <h2>Agent 权限</h2>
          <p>Allow / Ask / Deny</p>
        </div>
      </header>

      <div className="setting-list setting-list-spaced">
        <div className="setting-row">
          <span className="setting-row-main">
            <strong>网络搜索引擎</strong>
            <small>配置 API 后可获得更稳定的结果；无 Key 时回退到内置抓取</small>
          </span>
          <span className="setting-row-control">
            <select
              className="settings-select"
              value={webSearchProvider}
              onChange={(event) =>
                onChangeWebSearchProvider(event.target.value as WebSearchProviderType)
              }
            >
              <option value="auto">自动</option>
              <option value="html">内置抓取</option>
              <option value="tavily">Tavily API</option>
              <option value="brave">Brave Search API</option>
            </select>
          </span>
        </div>

        {webSearchProvider !== 'html' && (
          <label className="setting-row">
            <span className="setting-row-main">
              <strong>搜索 API Key</strong>
              <small>
                {webSearchProvider === 'brave'
                  ? 'Brave Search 订阅令牌'
                  : webSearchProvider === 'tavily'
                    ? 'Tavily API 密钥'
                    : 'Auto 模式下默认作为 Tavily Key 使用'}
              </small>
            </span>
            <span className="setting-row-control setting-row-control-wide">
              <input
                type="password"
                className="settings-input"
                placeholder={
                  webSearchProvider === 'brave'
                    ? 'Brave Search 订阅令牌'
                    : webSearchProvider === 'tavily'
                      ? 'tvly-...'
                      : 'API Key'
                }
                value={webSearchApiKey}
                onChange={(event) => onChangeWebSearchApiKey(event.target.value)}
              />
            </span>
          </label>
        )}
      </div>

      <CapabilitiesPanel
        tools={agentTools}
        permissions={permissions}
        toolDisplayLanguage={toolDisplayLanguage}
        onToolDisplayLanguageChange={onToolDisplayLanguageChange}
        getToolDisplay={getToolDisplay}
        onChangeToolPermission={onChangeToolPermission}
      />
    </section>
  )
}
