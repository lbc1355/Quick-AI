import React from 'react'
import type { ContextRetentionMode } from '../../../../shared/types'

interface GeneralSettingsSectionProps {
  systemPrompt: string
  autoHideOnBlur: boolean
  contextRetentionMode: ContextRetentionMode
  appStorePath: string
  onChangeSystemPrompt: (value: string) => void
  onChangeAutoHideOnBlur: (value: boolean) => void
  onChangeContextRetentionMode: (value: ContextRetentionMode) => void
}

export const GeneralSettingsSection: React.FC<GeneralSettingsSectionProps> = ({
  systemPrompt,
  autoHideOnBlur,
  contextRetentionMode,
  appStorePath,
  onChangeSystemPrompt,
  onChangeAutoHideOnBlur,
  onChangeContextRetentionMode
}) => {
  return (
    <section className="control-section">
      <header className="control-section-header">
        <div>
          <h2>通用</h2>
          <p>System Prompt / Window</p>
        </div>
      </header>

      <div className="setting-list">
        <label className="setting-row setting-row-block">
          <span className="setting-row-main">
            <strong>系统预设提示词</strong>
            <small>作为每次对话的基础行为说明，会影响 agent 的默认工作方式</small>
          </span>
          <textarea
            className="settings-input settings-textarea"
            value={systemPrompt}
            onChange={(event) => onChangeSystemPrompt(event.target.value)}
          />
        </label>

        <label className="setting-row">
          <span className="setting-row-main">
            <strong>失焦自动隐藏</strong>
            <small>窗口失去焦点时自动隐藏面板</small>
          </span>
          <span className="setting-row-control">
            <input
              type="checkbox"
              className="settings-checkbox settings-switch"
              checked={autoHideOnBlur}
              onChange={(event) => onChangeAutoHideOnBlur(event.target.checked)}
            />
          </span>
        </label>

        <label className="setting-row">
          <span className="setting-row-main">
            <strong>上下文策略</strong>
            <small>
              默认模式保持现有行为；缓存优先模式会将上一轮 agent
              工具请求和工具结果作为原生历史消息保留，下一轮用户消息直接追加在后面（暂不剪枝）。
            </small>
          </span>
          <span className="setting-row-control">
            <select
              className="settings-select"
              value={contextRetentionMode}
              onChange={(event) =>
                onChangeContextRetentionMode(event.target.value as ContextRetentionMode)
              }
            >
              <option value="default">默认</option>
              <option value="cache-priority">缓存优先</option>
            </select>
          </span>
        </label>

        <div className="setting-row">
          <span className="setting-row-main">
            <strong>本地数据存储路径</strong>
            <small>会话、配置和本地缓存的保存位置</small>
          </span>
          <span className="setting-row-control setting-row-control-wide">
            <input
              type="text"
              className="settings-input settings-path-input"
              value={appStorePath}
              readOnly
              disabled
            />
          </span>
        </div>
      </div>
    </section>
  )
}
