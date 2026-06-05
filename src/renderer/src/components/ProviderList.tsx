import React from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { ApiProvider } from '../../../shared/types'

interface ProviderListProps {
  providers: ApiProvider[]
  activeProviderId: string
  showAddForm: boolean
  newProviderName: string
  newProviderType: 'deepseek' | 'kimi' | 'ollama' | 'custom'
  setShowAddForm: (show: boolean) => void
  setNewProviderName: (name: string) => void
  setNewProviderType: (type: 'deepseek' | 'kimi' | 'ollama' | 'custom') => void
  onAddProvider: (name: string, type: 'deepseek' | 'kimi' | 'ollama' | 'custom') => void
  onSetActiveProvider: (id: string) => void
  onStartEditingProvider: (id: string) => void
  onDeleteProvider: (id: string) => void
}

export const ProviderList: React.FC<ProviderListProps> = ({
  providers,
  activeProviderId,
  showAddForm,
  newProviderName,
  newProviderType,
  setShowAddForm,
  setNewProviderName,
  setNewProviderType,
  onAddProvider,
  onSetActiveProvider,
  onStartEditingProvider,
  onDeleteProvider
}) => {
  return (
    <div>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '10px'
        }}
      >
        <span
          className="settings-label"
          style={{ fontSize: '13.5px', color: 'var(--color-text-title)', fontWeight: 'bold' }}
        >
          已配置服务商 (Configured API Services)
        </span>
        <button
          className="settings-save-btn"
          style={{
            margin: 0,
            padding: '4px 10px',
            height: '28px',
            borderRadius: '6px',
            fontSize: '11.5px',
            display: 'flex',
            alignItems: 'center',
            gap: '4px'
          }}
          onClick={() => setShowAddForm(true)}
        >
          <Plus size={12} />
          <span>新增配置</span>
        </button>
      </div>

      {/* Add Provider form overlay/inline card */}
      {showAddForm && (
        <div
          style={{
            background: 'rgba(255,255,255,0.02)',
            border: '1px dashed var(--color-primary)',
            borderRadius: '8px',
            padding: '12px',
            marginBottom: '12px',
            display: 'flex',
            flexDirection: 'column',
            gap: '8px'
          }}
        >
          <div style={{ fontSize: '12px', fontWeight: 'bold', color: 'var(--color-primary)' }}>
            新增服务商配置
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <div style={{ flex: 1 }}>
              <label style={{ fontSize: '10px', color: '#9ca3af', display: 'block', marginBottom: '3px' }}>
                服务商类型 (Preset Type)
              </label>
              <select
                className="settings-select"
                style={{ width: '100%', height: '30px', padding: '0 8px', fontSize: '11.5px' }}
                value={newProviderType}
                onChange={(e) => setNewProviderType(e.target.value as any)}
              >
                <option value="deepseek">DeepSeek</option>
                <option value="kimi">Kimi (Moonshot)</option>
                <option value="ollama">Local Ollama</option>
                <option value="custom">Custom (自定义)</option>
              </select>
            </div>
            <div style={{ flex: 1.5 }}>
              <label style={{ fontSize: '10px', color: '#9ca3af', display: 'block', marginBottom: '3px' }}>
                配置名称 (Custom Name)
              </label>
              <input
                type="text"
                className="settings-input"
                style={{ width: '100%', height: '30px', padding: '4px 8px', fontSize: '11.5px' }}
                placeholder="例如: DeepSeek-官方, 硅基流动"
                value={newProviderName}
                onChange={(e) => setNewProviderName(e.target.value)}
              />
            </div>
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '4px' }}>
            <button
              className="edit-btn cancel"
              style={{
                padding: '4px 10px',
                height: '24px',
                fontSize: '11px',
                display: 'flex',
                alignItems: 'center'
              }}
              onClick={() => setShowAddForm(false)}
            >
              取消
            </button>
            <button
              className="settings-save-btn"
              style={{
                margin: 0,
                padding: '4px 12px',
                height: '24px',
                fontSize: '11px',
                display: 'flex',
                alignItems: 'center'
              }}
              onClick={() => {
                onAddProvider(newProviderName, newProviderType)
                setShowAddForm(false)
                setNewProviderName('')
              }}
            >
              确认添加
            </button>
          </div>
        </div>
      )}

      {/* Scrollable list of configured providers */}
      <div className="provider-list-container" style={{ maxHeight: '280px', overflowY: 'auto' }}>
        {providers.map((p) => {
          const isActive = p.id === activeProviderId
          return (
            <div
              key={p.id}
              className={`provider-card ${isActive ? 'active-border' : ''}`}
              style={{
                marginBottom: '8px',
                padding: '10px',
                background: 'rgba(255,255,255,0.02)',
                border: '1px solid var(--color-border)',
                borderRadius: '8px'
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ fontSize: '12px', fontWeight: '600', color: 'var(--color-text-title)' }}>
                    {p.name}
                  </span>
                  <span
                    style={{
                      fontSize: '10px',
                      padding: '1px 6px',
                      background: 'rgba(255,255,255,0.06)',
                      border: '1px solid rgba(255,255,255,0.08)',
                      borderRadius: '10px',
                      color: '#9ca3af',
                      textTransform: 'capitalize'
                    }}
                  >
                    {p.type}
                  </span>
                  {isActive && (
                    <span
                      style={{
                        fontSize: '10px',
                        padding: '1px 6px',
                        background: 'rgba(16, 185, 129, 0.15)',
                        border: '1px solid rgba(16, 185, 129, 0.25)',
                        borderRadius: '4px',
                        color: '#10b981',
                        fontWeight: 'bold'
                      }}
                    >
                      默认激活
                    </span>
                  )}
                </div>
                <div style={{ display: 'flex', gap: '6px' }}>
                  {!isActive && (
                    <button
                      className="settings-save-btn"
                      style={{
                        margin: 0,
                        padding: '2px 8px',
                        height: '22px',
                        fontSize: '10.5px',
                        borderRadius: '4px',
                        background: 'transparent',
                        border: '1px solid rgba(16, 185, 129, 0.4)',
                        color: '#10b981'
                      }}
                      onClick={() => onSetActiveProvider(p.id)}
                    >
                      设为默认
                    </button>
                  )}
                  <button
                    className="settings-save-btn"
                    style={{
                      margin: 0,
                      padding: '2px 8px',
                      height: '22px',
                      fontSize: '10.5px',
                      borderRadius: '4px',
                      background: 'rgba(255,255,255,0.05)',
                      border: '1px solid var(--color-border)',
                      color: 'var(--color-text)'
                    }}
                    onClick={() => onStartEditingProvider(p.id)}
                  >
                    编辑
                  </button>
                  <button
                    style={{
                      background: 'transparent',
                      border: 'none',
                      color: '#ef4444',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      opacity: providers.length <= 1 ? 0.3 : 1
                    }}
                    onClick={() => onDeleteProvider(p.id)}
                    disabled={providers.length <= 1}
                    title="删除此配置"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              </div>
              <div
                style={{
                  fontSize: '11px',
                  color: '#6b7280',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  marginTop: '4px'
                }}
              >
                {p.apiUrl || '未设置接口网址'}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
