import React from 'react'
import {
  Bot,
  Brain,
  Boxes,
  FolderCog,
  ServerCog,
  SlidersHorizontal,
  type LucideIcon
} from 'lucide-react'
import { useSettings } from '../../contexts/SettingsContext'

export type SettingsSection = 'providers' | 'general' | 'agent' | 'skills' | 'memory' | 'mcp'

type SettingsGroup = 'desktop' | 'services' | 'resources'

const settingsGroups: Array<{ id: SettingsGroup; label: string }> = [
  { id: 'desktop', label: '桌面' },
  { id: 'services', label: '服务' },
  { id: 'resources', label: '资源' }
]

const settingsSections: Array<{
  id: SettingsSection
  group: SettingsGroup
  label: string
  detail: string
  icon: LucideIcon
}> = [
  {
    id: 'general',
    group: 'desktop',
    label: '通用',
    detail: '提示词与窗口',
    icon: SlidersHorizontal
  },
  { id: 'agent', group: 'desktop', label: 'Agent', detail: '工具执行策略', icon: Bot },
  { id: 'providers', group: 'services', label: '服务商', detail: 'API 与模型', icon: ServerCog },
  { id: 'mcp', group: 'services', label: 'MCP', detail: '外部工具服务', icon: FolderCog },
  { id: 'skills', group: 'resources', label: 'Skills', detail: '技能与文件夹', icon: Boxes },
  { id: 'memory', group: 'resources', label: '记忆', detail: '长期与按需记忆', icon: Brain }
]

interface SettingsSidebarProps {
  activeSection: SettingsSection
  onChangeSection: (section: SettingsSection) => void
}

export const SettingsSidebar: React.FC<SettingsSidebarProps> = ({
  activeSection,
  onChangeSection
}) => {
  const { saveSuccess, handleSaveGlobalSettings: onSaveGlobalSettings } = useSettings()

  return (
    <aside className="control-panel-sidebar">
      <div className="control-panel-title-block">
        <span className="control-panel-kicker">QuickAI Desktop</span>
        <span className="control-panel-title">设置</span>
      </div>

      <nav className="control-panel-nav" aria-label="Settings sections">
        {settingsGroups.map((group) => {
          const groupSections = settingsSections.filter((section) => section.group === group.id)
          return (
            <div key={group.id} className="control-panel-nav-group">
              <span className="control-panel-nav-group-label">{group.label}</span>
              {groupSections.map((section) => {
                const SectionIcon = section.icon
                return (
                  <button
                    key={section.id}
                    type="button"
                    className={`control-panel-nav-item ${
                      activeSection === section.id ? 'active' : ''
                    }`}
                    onClick={() => onChangeSection(section.id)}
                  >
                    <SectionIcon size={15} />
                    <span className="control-panel-nav-text">
                      <span>{section.label}</span>
                      <small>{section.detail}</small>
                    </span>
                  </button>
                )
              })}
            </div>
          )
        })}
      </nav>

      <div className="control-panel-sidebar-footer">
        <div className="control-panel-product">
          <span>QuickAI Desktop</span>
          <small>v1.0.0</small>
        </div>
        <button
          type="button"
          className={`settings-save-btn control-save-btn ${saveSuccess ? 'saved' : ''}`}
          onClick={onSaveGlobalSettings}
        >
          {saveSuccess ? '已保存' : '保存设置'}
        </button>
      </div>
    </aside>
  )
}
