import React from 'react'
import {
  AppWindow,
  ArrowLeft,
  ArrowRight,
  Minimize2,
  Minus,
  Settings,
  Square,
  Terminal,
  Command,
  Trash2,
  Undo2,
  Sun,
  Moon,
  Pin,
  PinOff,
  X
} from 'lucide-react'
import { ApiProvider, WindowMode } from '../../../shared/types'

interface AppHeaderProps {
  theme: string
  toggleTheme: () => void
  isPanelPinned: boolean
  setIsPanelPinned: React.Dispatch<React.SetStateAction<boolean>>
  windowMode: WindowMode
  isWindowMaximized: boolean
  onToggleWindowMode: () => void
  onMinimizeWindow: () => void
  onToggleWindowMaximized: () => void
  onCloseWindow: () => void
  showSettings: boolean
  handleCloseSettings: () => void
  handleClearCurrentSession: () => Promise<void>
  setShowSettings: (value: boolean) => void
  isGenerating: boolean
  providers: ApiProvider[]
  activeProviderId: string
  selectedModel: string
}

export const AppHeader: React.FC<AppHeaderProps> = ({
  theme,
  toggleTheme,
  isPanelPinned,
  setIsPanelPinned,
  windowMode,
  isWindowMaximized,
  onToggleWindowMode,
  onMinimizeWindow,
  onToggleWindowMaximized,
  onCloseWindow,
  showSettings,
  handleCloseSettings,
  handleClearCurrentSession,
  setShowSettings,
  isGenerating,
  providers,
  activeProviderId,
  selectedModel
}) => {
  const isWindowMode = windowMode === 'window'
  const activeProviderName =
    providers.find((provider) => provider.id === activeProviderId)?.name || '未选择服务商'

  return (
    <div className="drag-header">
      <div className="drag-header-left">
        <span className="logo-icon" aria-hidden="true" />
        <button type="button" className="header-nav-btn" title="后退">
          <ArrowLeft size={14} />
        </button>
        <button type="button" className="header-nav-btn" title="前进">
          <ArrowRight size={14} />
        </button>
      </div>

      <div className="header-command-center">
        <Command size={13} />
        <span className="logo-text">QuickAI</span>
        <span className="header-command-separator">·</span>
        <div className="chat-model-info">
          <div className={`status-dot ${isGenerating ? 'loading' : ''}`} />
          <span className="model-name">
            {activeProviderName}: {selectedModel}
          </span>
        </div>
      </div>

      <div className="drag-header-right">
        <button
          type="button"
          className="header-action-btn"
          onClick={toggleTheme}
          title={theme === 'dark' ? '切换到浅色模式' : '切换到深色模式'}
        >
          {theme === 'dark' ? <Sun size={14} /> : <Moon size={14} />}
        </button>
        {!isWindowMode && (
          <button
            type="button"
            className={`header-action-btn ${isPanelPinned ? 'active' : ''}`}
            onClick={() => setIsPanelPinned((value) => !value)}
            title={isPanelPinned ? '取消固定' : '固定窗口'}
          >
            {isPanelPinned ? <PinOff size={14} /> : <Pin size={14} />}
          </button>
        )}
        <button
          type="button"
          className={`header-action-btn ${isWindowMode ? 'active' : ''}`}
          onClick={onToggleWindowMode}
          title={isWindowMode ? '切换到浮窗模式' : '切换到窗口模式'}
        >
          <AppWindow size={14} />
        </button>
        {showSettings ? (
          <button
            type="button"
            className="header-action-btn"
            onClick={handleCloseSettings}
            title="返回聊天"
          >
            <Undo2 size={14} />
          </button>
        ) : (
          <>
            <button
              type="button"
              className="header-action-btn"
              onClick={handleClearCurrentSession}
              title="清空历史"
            >
              <Trash2 size={14} />
            </button>
            <button
              type="button"
              className="header-action-btn"
              onClick={() => window.api.toggleDevTools()}
              title="开发者工具"
            >
              <Terminal size={14} />
            </button>
            <button
              type="button"
              className="header-action-btn"
              onClick={() => setShowSettings(true)}
              title="应用设置"
            >
              <Settings size={14} />
            </button>
          </>
        )}
        {isWindowMode && (
          <div className="window-control-group" aria-label="窗口控制">
            <button
              type="button"
              className="header-action-btn window-control-btn"
              onClick={onMinimizeWindow}
              title="最小化"
            >
              <Minus size={15} />
            </button>
            <button
              type="button"
              className="header-action-btn window-control-btn"
              onClick={onToggleWindowMaximized}
              title={isWindowMaximized ? '还原' : '最大化'}
            >
              {isWindowMaximized ? <Minimize2 size={14} /> : <Square size={13} />}
            </button>
            <button
              type="button"
              className="header-action-btn window-control-btn close"
              onClick={onCloseWindow}
              title="隐藏到托盘"
            >
              <X size={15} />
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
