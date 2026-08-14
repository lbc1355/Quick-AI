import React, { useMemo, useState } from 'react'
import {
  Boxes,
  Code2,
  Filter,
  RefreshCw,
  Search,
  Server,
  ShieldAlert,
  ShieldCheck,
  ShieldQuestion,
  Wrench,
  X
} from 'lucide-react'
import type { AgentToolInfo, McpServerStatus } from '../../../../shared/types'
import type { ToolDisplayLanguage } from '../settings/toolDisplay'

type ToolPermission = 'allow' | 'ask' | 'deny'
type RiskFilter = 'all' | 'low' | 'medium' | 'high'
type PermissionFilter = 'all' | ToolPermission

interface McpServerDrawerProps {
  server: McpServerStatus
  agentTools: AgentToolInfo[]
  permissions: Record<string, ToolPermission>
  isReloading: boolean
  toolDisplayLanguage: ToolDisplayLanguage
  onToolDisplayLanguageChange: (language: ToolDisplayLanguage) => void
  getToolDisplay: (
    tool: AgentToolInfo,
    language: ToolDisplayLanguage
  ) => { title: string; description: string }
  onChangeToolPermission: (toolName: string, policy: ToolPermission) => void
  onReloadServer: (name: string) => void
  onClose: () => void
}

const riskLabels: Record<AgentToolInfo['risk'], string> = {
  low: '低',
  medium: '中',
  high: '高'
}

const riskDescriptions: Record<AgentToolInfo['risk'], string> = {
  low: '只读或低影响操作',
  medium: '可能访问本地/网络资源',
  high: '可能修改文件、执行命令或影响系统状态'
}

const permissionLabels: Record<ToolPermission, string> = {
  allow: '允许',
  ask: '询问',
  deny: '拒绝'
}

const permissionDescriptions: Record<ToolPermission, string> = {
  allow: '模型可直接调用',
  ask: '调用前弹出授权',
  deny: '执行层会拒绝调用'
}

function getPermission(
  toolName: string,
  permissions: Record<string, ToolPermission>
): ToolPermission {
  return permissions[toolName] || 'allow'
}

function getParameterRows(tool: AgentToolInfo): Array<{
  name: string
  type: string
  required: boolean
  description?: string
  enum?: string[]
}> {
  const properties = tool.parameters?.properties || {}
  const required = new Set(tool.parameters?.required || [])
  return Object.entries(properties)
    .filter(([name]) => name !== 'purpose')
    .map(([name, schema]) => ({
      name,
      type: schema.type || 'unknown',
      required: required.has(name),
      description: schema.description,
      enum: schema.enum
    }))
}

export const McpServerDrawer: React.FC<McpServerDrawerProps> = ({
  server,
  agentTools,
  permissions,
  isReloading,
  toolDisplayLanguage,
  onToolDisplayLanguageChange,
  getToolDisplay,
  onChangeToolPermission,
  onReloadServer,
  onClose
}) => {
  const [query, setQuery] = useState('')
  const [riskFilter, setRiskFilter] = useState<RiskFilter>('all')
  const [permissionFilter, setPermissionFilter] = useState<PermissionFilter>('all')
  const [selectedToolName, setSelectedToolName] = useState<string | null>(null)

  // Map server.tools into rich AgentToolInfo instances
  const mcpTools = useMemo<AgentToolInfo[]>(() => {
    return server.tools.map((st) => {
      const matched = agentTools.find(
        (at) =>
          at.name === st.name ||
          (at.source === 'mcp' &&
            (at.title === st.name || at.name.endsWith(`_${st.name}`) || at.name.includes(st.name)))
      )

      if (matched) return matched

      const fallbackName = `mcp_${server.name.replace(/[^a-zA-Z0-9_-]/g, '_')}_${st.name.replace(/[^a-zA-Z0-9_-]/g, '_')}`
      return {
        name: fallbackName,
        title: st.name,
        description: st.description || '',
        category: 'system',
        risk: 'medium' as const,
        source: 'mcp' as const
      }
    })
  }, [agentTools, server])

  const filteredTools = useMemo(() => {
    const cleanQuery = query.trim().toLowerCase()
    return mcpTools.filter((tool) => {
      const permission = getPermission(tool.name, permissions)
      const display = getToolDisplay(tool, toolDisplayLanguage)
      if (riskFilter !== 'all' && tool.risk !== riskFilter) return false
      if (permissionFilter !== 'all' && permission !== permissionFilter) return false
      if (!cleanQuery) return true

      const searchText = [
        tool.name,
        tool.title,
        tool.description,
        tool.category,
        tool.risk,
        display.title,
        display.description
      ]
        .join(' ')
        .toLowerCase()

      return searchText.includes(cleanQuery)
    })
  }, [
    getToolDisplay,
    mcpTools,
    permissionFilter,
    permissions,
    query,
    riskFilter,
    toolDisplayLanguage
  ])

  const stats = useMemo(() => {
    const allow = mcpTools.filter((t) => getPermission(t.name, permissions) === 'allow').length
    const ask = mcpTools.filter((t) => getPermission(t.name, permissions) === 'ask').length
    const deny = mcpTools.filter((t) => getPermission(t.name, permissions) === 'deny').length
    const high = mcpTools.filter((t) => t.risk === 'high').length
    return { total: mcpTools.length, allow, ask, deny, high }
  }, [mcpTools, permissions])

  const selectedTool = selectedToolName
    ? mcpTools.find((t) => t.name === selectedToolName) || null
    : null
  const selectedToolPermission = selectedTool
    ? getPermission(selectedTool.name, permissions)
    : 'allow'
  const selectedToolDisplay = selectedTool
    ? getToolDisplay(selectedTool, toolDisplayLanguage)
    : null
  const selectedToolParams = selectedTool ? getParameterRows(selectedTool) : []

  return (
    <div className="mcp-drawer-backdrop" onClick={onClose}>
      <aside
        className="mcp-drawer-panel"
        role="dialog"
        aria-modal="true"
        aria-label={`${server.name} MCP 服务详情`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* 抽屉头部 */}
        <header className="mcp-drawer-header">
          <div className="mcp-drawer-title-block">
            <div className="mcp-drawer-title-row">
              <Server size={18} className="mcp-drawer-icon" />
              <h2 className="mcp-drawer-title">{server.name}</h2>
              <div className={`mcp-status-pill ${server.status}`}>
                <span>
                  {server.status === 'connected'
                    ? '已连接'
                    : server.status === 'failed'
                      ? '连接失败'
                      : server.status === 'connecting'
                        ? '正在连接'
                        : '已禁用'}
                </span>
              </div>
              <span className="mcp-drawer-tool-badge">{mcpTools.length} 个工具</span>
            </div>
            <p className="mcp-drawer-subtitle">
              来自外部 MCP 服务的工具集合，配置后可供 ReAct 智能体在推理循环中调用
            </p>
          </div>

          <div className="mcp-drawer-actions">
            {server.status !== 'disabled' && (
              <button
                type="button"
                className="secondary-btn mcp-drawer-reload-btn"
                disabled={isReloading}
                onClick={() => onReloadServer(server.name)}
                title="重新连接并刷新工具"
              >
                <RefreshCw size={13} className={isReloading ? 'spin' : undefined} />
                <span>{isReloading ? '连接中...' : '重新连接'}</span>
              </button>
            )}
            <button
              type="button"
              className="header-action-btn mcp-drawer-close-btn"
              onClick={onClose}
              title="关闭抽屉"
            >
              <X size={18} />
            </button>
          </div>
        </header>

        {/* 失败日志提示 */}
        {server.status === 'failed' && server.error && (
          <div className="mcp-drawer-error-banner">
            <strong>连接错误：</strong>
            <span>{server.error}</span>
          </div>
        )}

        {/* 抽屉主体内容 */}
        <div className="mcp-drawer-body">
          {/* 工具栏与筛选 */}
          <div className="capabilities-toolbar mcp-drawer-toolbar">
            <div className="capabilities-search">
              <Search size={14} />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="搜索工具名称、描述、参数..."
              />
            </div>

            <div className="capabilities-filters" aria-label="工具筛选">
              <label>
                <Filter size={13} />
                <select
                  value={riskFilter}
                  onChange={(event) => setRiskFilter(event.target.value as RiskFilter)}
                >
                  <option value="all">全部风险</option>
                  <option value="low">低风险</option>
                  <option value="medium">中风险</option>
                  <option value="high">高风险</option>
                </select>
              </label>
              <label>
                <ShieldQuestion size={13} />
                <select
                  value={permissionFilter}
                  onChange={(event) => setPermissionFilter(event.target.value as PermissionFilter)}
                >
                  <option value="all">全部权限</option>
                  <option value="allow">允许</option>
                  <option value="ask">询问</option>
                  <option value="deny">拒绝</option>
                </select>
              </label>
            </div>

            <div className="tool-language-options capabilities-language">
              <button
                type="button"
                className={toolDisplayLanguage === 'zh' ? 'active' : ''}
                onClick={() => onToolDisplayLanguageChange('zh')}
              >
                中文
              </button>
              <button
                type="button"
                className={toolDisplayLanguage === 'en' ? 'active' : ''}
                onClick={() => onToolDisplayLanguageChange('en')}
              >
                EN
              </button>
            </div>
          </div>

          {/* 统计胶囊条 */}
          <div className="capabilities-stats mcp-drawer-stats">
            <span>
              <Boxes size={13} />
              {stats.total} 个工具
            </span>
            <span>
              <ShieldCheck size={13} />
              允许 {stats.allow}
            </span>
            <span>
              <ShieldQuestion size={13} />
              询问 {stats.ask}
            </span>
            <span>
              <ShieldAlert size={13} />
              拒绝 {stats.deny}
            </span>
            <span>
              <Wrench size={13} />
              高风险 {stats.high}
            </span>
          </div>

          {/* 工具列表为空状态 */}
          {mcpTools.length === 0 && (
            <div className="capabilities-empty mcp-drawer-empty">
              <strong>暂无可用工具</strong>
              <span>
                {server.status === 'connected'
                  ? '该 MCP 服务已连接，但未声明任何工具。'
                  : '服务未连接或连接中，请检查配置或点击右上角重新连接。'}
              </span>
            </div>
          )}

          {mcpTools.length > 0 && filteredTools.length === 0 && (
            <div className="capabilities-empty mcp-drawer-empty">
              <strong>没有匹配的工具</strong>
              <span>调整搜索关键词或筛选条件后再试。</span>
            </div>
          )}

          {/* 工具卡片网格（与 Agent 页面能力卡片完全一致） */}
          <div className="mcp-drawer-tools-grid">
            {filteredTools.map((tool) => {
              const display = getToolDisplay(tool, toolDisplayLanguage)
              const permission = getPermission(tool.name, permissions)

              return (
                <article key={tool.name} className={`capability-card ${permission}`}>
                  <button
                    type="button"
                    className="capability-main"
                    onClick={() => setSelectedToolName(tool.name)}
                  >
                    <span className="capability-title-block">
                      <span className="capability-title-row">
                        <strong>{display.title}</strong>
                        <code>{tool.name}</code>
                      </span>
                      <span className="capability-description">
                        {display.description || '无详细功能描述'}
                      </span>
                    </span>
                    <span className="capability-meta">
                      <span className="capability-source">MCP</span>
                      <span
                        className={`capability-risk ${tool.risk}`}
                        title={riskDescriptions[tool.risk]}
                      >
                        {riskLabels[tool.risk]}
                      </span>
                      <Code2 size={14} className="capability-detail-icon" />
                    </span>
                  </button>

                  <div className="capability-permission-row">
                    <span>
                      当前策略：<strong>{permissionLabels[permission]}</strong>
                      <small>{permissionDescriptions[permission]}</small>
                    </span>
                    <select
                      className="settings-select capability-permission-select"
                      value={permission}
                      onChange={(event) =>
                        onChangeToolPermission(tool.name, event.target.value as ToolPermission)
                      }
                    >
                      <option value="allow">允许</option>
                      <option value="ask">询问</option>
                      <option value="deny">拒绝</option>
                    </select>
                  </div>
                </article>
              )
            })}
          </div>
        </div>

        {/* 工具参数 Schema 详情弹窗 */}
        {selectedTool && selectedToolDisplay && (
          <div
            className="modal-backdrop capability-modal-backdrop"
            onMouseDown={() => setSelectedToolName(null)}
          >
            <section
              className="modal-card capability-modal"
              role="dialog"
              aria-modal="true"
              aria-label={`${selectedToolDisplay.title} 工具详情`}
              onMouseDown={(event) => event.stopPropagation()}
            >
              <header className="modal-header capability-modal-header">
                <div className="capability-modal-title-block">
                  <span className="modal-title">{selectedToolDisplay.title}</span>
                  <code>{selectedTool.name}</code>
                </div>
                <button
                  type="button"
                  className="header-action-btn"
                  onClick={() => setSelectedToolName(null)}
                  title="关闭"
                >
                  <X size={16} />
                </button>
              </header>

              <div className="modal-body capability-modal-body">
                <section className="capability-modal-section">
                  <p className="capability-modal-description">
                    {selectedToolDisplay.description || '无详细功能描述'}
                  </p>
                  <div className="capability-modal-badges">
                    <span className="capability-source">MCP</span>
                    <span
                      className={`capability-risk ${selectedTool.risk}`}
                      title={riskDescriptions[selectedTool.risk]}
                    >
                      {riskLabels[selectedTool.risk]}
                    </span>
                    <span>{server.name}</span>
                  </div>
                </section>

                <section className="capability-modal-section capability-modal-policy">
                  <div>
                    <h4>当前策略</h4>
                    <p>
                      <strong>{permissionLabels[selectedToolPermission]}</strong>
                      <span>{permissionDescriptions[selectedToolPermission]}</span>
                    </p>
                  </div>
                  <select
                    className="settings-select capability-permission-select"
                    value={selectedToolPermission}
                    onChange={(event) =>
                      onChangeToolPermission(
                        selectedTool.name,
                        event.target.value as ToolPermission
                      )
                    }
                  >
                    <option value="allow">允许</option>
                    <option value="ask">询问</option>
                    <option value="deny">拒绝</option>
                  </select>
                </section>

                <section className="capability-modal-section">
                  <div className="capability-detail-title">
                    <Code2 size={13} />
                    <span>参数 schema</span>
                  </div>
                  {selectedToolParams.length === 0 ? (
                    <div className="capability-no-params">无必填业务参数。</div>
                  ) : (
                    <div className="capability-param-list">
                      {selectedToolParams.map((param) => (
                        <div key={param.name} className="capability-param">
                          <div className="capability-param-head">
                            <code>{param.name}</code>
                            <span>{param.type}</span>
                            {param.required && <strong>required</strong>}
                          </div>
                          {param.description && <p>{param.description}</p>}
                          {param.enum && param.enum.length > 0 && (
                            <small>可选值：{param.enum.join(', ')}</small>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </section>
              </div>
            </section>
          </div>
        )}
      </aside>
    </div>
  )
}
