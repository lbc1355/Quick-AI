import React, { useMemo, useState } from 'react'
import {
  Boxes,
  Code2,
  Filter,
  Search,
  ShieldAlert,
  ShieldCheck,
  ShieldQuestion,
  Wrench,
  X
} from 'lucide-react'
import { AgentToolInfo } from '../../../shared/types'

type ToolPermission = 'allow' | 'ask' | 'deny'
type ToolDisplayLanguage = 'zh' | 'en'
type RiskFilter = 'all' | 'low' | 'medium' | 'high'
type PermissionFilter = 'all' | ToolPermission

interface CapabilitiesPanelProps {
  tools: AgentToolInfo[]
  permissions: Record<string, ToolPermission>
  toolDisplayLanguage: ToolDisplayLanguage
  onToolDisplayLanguageChange: (language: ToolDisplayLanguage) => void
  getToolDisplay: (
    tool: AgentToolInfo,
    language: ToolDisplayLanguage
  ) => { title: string; description: string }
  onChangeToolPermission: (toolName: string, policy: ToolPermission) => void
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

const sourceLabels: Record<NonNullable<AgentToolInfo['source']>, string> = {
  builtin: '内置',
  mcp: 'MCP',
  skill: 'Skill',
  plugin: 'Plugin',
  external: '外部'
}

const categoryLabels: Record<string, string> = {
  file: '文件',
  shell: 'Shell',
  web: '网络',
  memory: '记忆',
  system: '系统'
}

function getPermission(
  toolName: string,
  permissions: Record<string, ToolPermission>
): ToolPermission {
  return permissions[toolName] || 'allow'
}

function getToolSearchText(
  tool: AgentToolInfo,
  display: { title: string; description: string }
): string {
  return [
    tool.name,
    tool.title,
    tool.description,
    tool.category,
    tool.risk,
    tool.source || 'builtin',
    display.title,
    display.description
  ]
    .join(' ')
    .toLowerCase()
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

export const CapabilitiesPanel: React.FC<CapabilitiesPanelProps> = ({
  tools,
  permissions,
  toolDisplayLanguage,
  onToolDisplayLanguageChange,
  getToolDisplay,
  onChangeToolPermission
}) => {
  const [query, setQuery] = useState('')
  const [riskFilter, setRiskFilter] = useState<RiskFilter>('all')
  const [permissionFilter, setPermissionFilter] = useState<PermissionFilter>('all')
  const [selectedToolName, setSelectedToolName] = useState<string | null>(null)

  const filteredTools = useMemo(() => {
    const cleanQuery = query.trim().toLowerCase()
    return tools.filter((tool) => {
      const permission = getPermission(tool.name, permissions)
      const display = getToolDisplay(tool, toolDisplayLanguage)
      if (riskFilter !== 'all' && tool.risk !== riskFilter) return false
      if (permissionFilter !== 'all' && permission !== permissionFilter) return false
      if (!cleanQuery) return true
      return getToolSearchText(tool, display).includes(cleanQuery)
    })
  }, [getToolDisplay, permissionFilter, permissions, query, riskFilter, toolDisplayLanguage, tools])

  const groupedTools = useMemo(() => {
    const groups = new Map<string, AgentToolInfo[]>()
    for (const tool of filteredTools) {
      const key = tool.category || 'other'
      const list = groups.get(key) || []
      list.push(tool)
      groups.set(key, list)
    }
    return Array.from(groups.entries()).sort(([a], [b]) => a.localeCompare(b))
  }, [filteredTools])

  const stats = useMemo(() => {
    const allow = tools.filter((tool) => getPermission(tool.name, permissions) === 'allow').length
    const ask = tools.filter((tool) => getPermission(tool.name, permissions) === 'ask').length
    const deny = tools.filter((tool) => getPermission(tool.name, permissions) === 'deny').length
    const high = tools.filter((tool) => tool.risk === 'high').length
    return { total: tools.length, allow, ask, deny, high }
  }, [permissions, tools])

  const selectedTool = selectedToolName
    ? tools.find((tool) => tool.name === selectedToolName) || null
    : null
  const selectedToolPermission = selectedTool
    ? getPermission(selectedTool.name, permissions)
    : 'allow'
  const selectedToolDisplay = selectedTool
    ? getToolDisplay(selectedTool, toolDisplayLanguage)
    : null
  const selectedToolParams = selectedTool ? getParameterRows(selectedTool) : []

  return (
    <div className="capabilities-panel">
      <div className="capabilities-toolbar">
        <div className="capabilities-search">
          <Search size={14} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索工具名称、描述、分类..."
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

      <div className="capabilities-stats">
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

      {tools.length === 0 && (
        <div className="capabilities-empty">
          <strong>工具列表加载中</strong>
          <span>正在从 ToolRegistry 读取可发现工具。</span>
        </div>
      )}

      {tools.length > 0 && filteredTools.length === 0 && (
        <div className="capabilities-empty">
          <strong>没有匹配的工具</strong>
          <span>调整搜索关键词或筛选条件后再试。</span>
        </div>
      )}

      <div className="capabilities-groups">
        {groupedTools.map(([category, categoryTools]) => (
          <section key={category} className="capability-category">
            <div className="capability-category-header">
              <span>{categoryLabels[category] || category}</span>
              <small>{categoryTools.length}</small>
            </div>

            <div className="capability-list">
              {categoryTools.map((tool) => {
                const display = getToolDisplay(tool, toolDisplayLanguage)
                const permission = getPermission(tool.name, permissions)
                const source = tool.source || 'builtin'

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
                        <span className="capability-description">{display.description}</span>
                      </span>
                      <span className="capability-meta">
                        <span className="capability-source">{sourceLabels[source]}</span>
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
          </section>
        ))}
      </div>

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
                <p className="capability-modal-description">{selectedToolDisplay.description}</p>
                <div className="capability-modal-badges">
                  <span className="capability-source">
                    {sourceLabels[selectedTool.source || 'builtin']}
                  </span>
                  <span
                    className={`capability-risk ${selectedTool.risk}`}
                    title={riskDescriptions[selectedTool.risk]}
                  >
                    {riskLabels[selectedTool.risk]}
                  </span>
                  <span>{categoryLabels[selectedTool.category] || selectedTool.category}</span>
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
                    onChangeToolPermission(selectedTool.name, event.target.value as ToolPermission)
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
    </div>
  )
}
