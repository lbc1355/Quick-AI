import React, { useEffect, useState } from 'react'
import { AgentToolInfo } from '../../../shared/types'
import { useSettings } from '../contexts/SettingsContext'
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
  activeSessionId: string | null
}

export const SettingsView: React.FC<SettingsViewProps> = ({ activeSessionId }) => {
  // SettingsView is now just layout + local UI state; the panels below read their own settings
  // slices from SettingsContext. Only the fields used directly here (section headers + the
  // editing-detail branch) are pulled from the context.
  const { isEditingProviderDetail, activeProviderId, providers, selectedModel, skills } =
    useSettings()

  const [activeSection, setActiveSection] = useState<SettingsSection>('providers')
  const [agentTools, setAgentTools] = useState<AgentToolInfo[]>([])
  const [toolDisplayLanguage, setToolDisplayLanguage] =
    useState<ToolDisplayLanguage>(getInitialToolLanguage)
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
        <ProviderEditor />
      </div>
    )
  }

  return (
    <div className="settings-container">
      <div className="control-panel">
        <SettingsSidebar activeSection={activeSection} onChangeSection={setActiveSection} />
        <main className="control-panel-content">
          {activeSection === 'providers' && (
            <section className="control-section">
              <header className="control-section-header">
                <div>
                  <h2>服务商</h2>
                  <p>{activeProvider ? `${activeProvider.name} / ${selectedModel}` : '未选择'}</p>
                </div>
              </header>
              <ProviderList />
            </section>
          )}

          {activeSection === 'general' && <GeneralSettingsSection />}

          {activeSection === 'agent' && (
            <AgentSettingsSection
              agentTools={agentTools}
              toolDisplayLanguage={toolDisplayLanguage}
              onToolDisplayLanguageChange={setToolLanguage}
              getToolDisplay={getToolDisplay}
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
              <SkillManager />
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
