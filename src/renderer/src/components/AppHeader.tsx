import React from 'react'
import { Settings, Terminal, Sparkles, Trash2, Undo2, Sun, Moon, Pin, PinOff } from 'lucide-react'
import { ApiProvider } from '../../../shared/types'

interface AppHeaderProps {
  theme: string
  toggleTheme: () => void
  isPanelPinned: boolean
  setIsPanelPinned: React.Dispatch<React.SetStateAction<boolean>>
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
  showSettings,
  handleCloseSettings,
  handleClearCurrentSession,
  setShowSettings,
  isGenerating,
  providers,
  activeProviderId,
  selectedModel
}) => {
  return (
    <div className="drag-header">
      <div className="drag-header-left">
        <Sparkles className="logo-icon" size={16} />
        <span className="logo-text">QuickAI</span>
        <div className="chat-model-info" style={{ marginLeft: '12px' }}>
          <div className={`status-dot ${isGenerating ? 'loading' : ''}`} />
          <span className="model-name" style={{ fontSize: '12px', color: '#9ca3af' }}>
            {providers.find((p) => p.id === activeProviderId)?.name || '未选服务商'}:{' '}
            {selectedModel}
          </span>
        </div>
      </div>
      <div className="drag-header-right">
        <button
          className="header-action-btn"
          onClick={toggleTheme}
          title={theme === 'dark' ? '切换到白天模式' : '切换到黑夜模式'}
        >
          {theme === 'dark' ? <Sun size={14} /> : <Moon size={14} />}
        </button>
        <button
          className={`header-action-btn ${isPanelPinned ? 'active' : ''}`}
          onClick={() => setIsPanelPinned((value) => !value)}
          title={isPanelPinned ? '取消固定' : '固定窗口'}
        >
          {isPanelPinned ? <PinOff size={14} /> : <Pin size={14} />}
        </button>
        {showSettings ? (
          <button className="header-action-btn" onClick={handleCloseSettings} title="返回聊天">
            <Undo2 size={14} />
          </button>
        ) : (
          <>
            <button
              className="header-action-btn"
              onClick={handleClearCurrentSession}
              title="清空历史"
            >
              <Trash2 size={14} />
            </button>
            <button
              className="header-action-btn"
              onClick={() => window.api.toggleDevTools()}
              title="开发者工具"
            >
              <Terminal size={14} />
            </button>
            <button
              className="header-action-btn"
              onClick={() => setShowSettings(true)}
              title="应用设置"
            >
              <Settings size={14} />
            </button>
          </>
        )}
      </div>
    </div>
  )
}
