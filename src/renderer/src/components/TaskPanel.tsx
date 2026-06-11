import React, { useState, useMemo, useEffect } from 'react'
import {
  ChevronRight,
  CheckCircle2,
  XCircle,
  Circle,
  Loader2,
  FileText,
  Terminal,
  Globe,
  Search,
  Brain,
  AlertCircle,
  HelpCircle,
  ChevronDown,
  Clock,
  ExternalLink,
  Code
} from 'lucide-react'
import { TaskItem, AgentEvent, ToolResultUi, Message } from '../../../shared/types'
import { parseAgentLogs } from '../utils/messageFormat'

interface TaskPanelProps {
  message: Message
  isOpen: boolean
  onClose: () => void
  isGenerating?: boolean
}

interface TimelineNode {
  id: string
  type: 'thought' | 'tool'
  title: string
  toolName?: string
  purpose?: string
  args?: any
  status: 'pending' | 'running' | 'completed' | 'failed' | 'denied'
  thought?: string
  result?: ToolResultUi
  error?: string
}

export const TaskPanel: React.FC<TaskPanelProps> = ({ message, isOpen, onClose, isGenerating = false }) => {
  const [activeTab, setActiveTab] = useState<'timeline' | 'tasks'>('timeline')
  const [expandedNodes, setExpandedNodes] = useState<Record<string, boolean>>({})

  // Parse high-level tasks checklist if present in agentEvents
  const tasks = useMemo<TaskItem[]>(() => {
    if (!message || !message.agentEvents) return []
    const taskEvent = message.agentEvents.reduce<Extract<AgentEvent, { type: 'task_update' }> | null>(
      (last, e) => (e.type === 'task_update' ? e : last),
      null
    )
    return taskEvent ? taskEvent.tasks : []
  }, [message])

  const hasTasks = tasks.length > 0

  // Fallback to timeline if activeTab is 'tasks' but tasks are cleared
  useEffect(() => {
    if (!hasTasks && activeTab === 'tasks') {
      setActiveTab('timeline')
    }
  }, [hasTasks, activeTab])

  // Parse low-level timeline nodes (tools + reasoning)
  const timelineNodes = useMemo<TimelineNode[]>(() => {
    if (!message) return []
    const nodes: TimelineNode[] = []

    const getStepDescription = (toolName: string, args: any): string => {
      const argsObj = args && typeof args === 'object' ? args : null
      const name = toolName.toLowerCase()

      const truncate = (text: string, maxLen: number = 32): string => {
        if (typeof text !== 'string') return ''
        if (text.length <= maxLen) return text
        return text.substring(0, maxLen) + '...'
      }

      const getFileLabel = (val: any): string => {
        if (typeof val !== 'string') return ''
        const parts = val.replace(/\\/g, '/').split('/')
        if (parts.length > 2) {
          return '.../' + parts.slice(-2).join('/')
        }
        return val
      }

      if (
        name.includes('file') ||
        name.includes('view') ||
        name.includes('read_file') ||
        name.includes('write_file')
      ) {
        const path =
          argsObj?.path ||
          argsObj?.TargetFile ||
          argsObj?.AbsolutePath ||
          argsObj?.Target ||
          argsObj?.file ||
          argsObj?.filePath
        const filename = path ? getFileLabel(path) : ''
        if (name.includes('write') || name.includes('create')) {
          return `写入文件 ${filename}`
        }
        if (name.includes('replace') || name.includes('edit')) {
          return `修改文件 ${filename}`
        }
        return `读取文件 ${filename}`
      }

      if (name.includes('command') || name.includes('shell') || name.includes('run')) {
        const cmd = argsObj?.CommandLine || argsObj?.command || argsObj?.cmd
        return `执行命令: ${cmd ? truncate(cmd) : ''}`
      }

      if (name.includes('search') || name.includes('query') || name.includes('web') || name.includes('google')) {
        const query = argsObj?.query || argsObj?.q
        return `网络搜索: ${query ? truncate(query) : ''}`
      }

      if (name.includes('url') || name.includes('fetch') || name.includes('browser') || name.includes('http')) {
        const url = argsObj?.url || argsObj?.Url || argsObj?.uri
        if (url && typeof url === 'string') {
          const displayUrl = url.replace(/^https?:\/\/(www\.)?/, '')
          return `网页抓取: ${truncate(displayUrl)}`
        }
      }

      if (name.includes('memory')) {
        const target = argsObj?.target || argsObj?.group_name || argsObj?.groupName
        if (name.includes('write')) return `写入记忆: ${target || ''}`
        if (name.includes('delete')) return `删除记忆: ${target || ''}`
        return `读取记忆: ${target || ''}`
      }

      return `调用工具: ${toolName}`
    }

    if (message.agentEvents && message.agentEvents.length > 0) {
      const events = message.agentEvents
      events.forEach((event, idx) => {
        if (event.type === 'reasoning') {
          nodes.push({
            id: `thought-${idx}`,
            type: 'thought',
            title: '思考分析',
            status: 'completed',
            thought: event.content
          })
        } else if (event.type === 'tool_call') {
          const resultEvent = events.find(
            (e): e is Extract<AgentEvent, { type: 'tool_result' }> =>
              e.type === 'tool_result' && e.callId === event.callId
          )
          const errorEvent = events.find(
            (e): e is Extract<AgentEvent, { type: 'tool_error' }> =>
              e.type === 'tool_error' && e.callId === event.callId
          )

          let status: TimelineNode['status'] = 'running'
          if (event.permissionState === 'pending') status = 'pending'
          else if (event.permissionState === 'denied') status = 'denied'
          else if (errorEvent) status = 'failed'
          else if (resultEvent) status = 'completed'

          nodes.push({
            id: event.callId,
            type: 'tool',
            title: event.purpose || getStepDescription(event.toolName, event.args),
            toolName: event.toolName,
            purpose: event.purpose,
            args: event.args,
            status,
            result: resultEvent?.result,
            error: errorEvent?.error
          })
        }
      })
    } else {
      // Fallback: Parse legacy string logs
      const parsed = parseAgentLogs(message.content)
      parsed.logs.forEach((log, idx) => {
        if (log.type === 'think') {
          nodes.push({
            id: `legacy-thought-${idx}`,
            type: 'thought',
            title: log.step > 0 ? `思考步骤 (${log.step}/${log.maxSteps})` : '思考分析',
            status: 'completed',
            thought: log.thought
          })
        } else if (log.type === 'tool') {
          const resultLog = parsed.logs.find(
            (l) => l.step === log.step && l.type === 'result' && l.url === log.url
          )
          const errorLog = parsed.logs.find((l) => l.step === log.step && l.type === 'error')

          let status: TimelineNode['status'] = 'running'
          if (errorLog) status = 'failed'
          else if (resultLog) status = 'completed'

          nodes.push({
            id: `legacy-tool-${idx}`,
            type: 'tool',
            title: log.toolName ? getStepDescription(log.toolName, { url: log.url }) : '使用工具',
            toolName: log.toolName || 'tool',
            args: { url: log.url },
            status,
            result: resultLog ? { title: resultLog.title, url: resultLog.url } : undefined,
            error: errorLog?.error
          })
        }
      })
    }
    return nodes
  }, [message])

  // Manage node expansion states:
  // - During active run execution (isGenerating is true): Only expand the currently running tool, collapse all others.
  // - Once complete (isGenerating is false): Collapse all nodes.
  useEffect(() => {
    if (isGenerating) {
      const newExpanded: Record<string, boolean> = {}
      timelineNodes.forEach((node) => {
        newExpanded[node.id] = node.status === 'running'
      })
      setExpandedNodes(newExpanded)
    } else {
      setExpandedNodes({})
    }
  }, [timelineNodes, isGenerating])

  const toggleNode = (id: string): void => {
    setExpandedNodes((prev) => ({
      ...prev,
      [id]: !prev[id]
    }))
  }

  const getToolIcon = (type: 'thought' | 'tool', toolName?: string): React.ReactNode => {
    if (type === 'thought') return <Brain size={12} />
    if (!toolName) return <HelpCircle size={12} />

    const name = toolName.toLowerCase()
    if (
      name.includes('file') ||
      name.includes('view') ||
      name.includes('read_file') ||
      name.includes('write_file')
    ) {
      return <FileText size={12} />
    }
    if (name.includes('command') || name.includes('shell') || name.includes('run')) {
      return <Terminal size={12} />
    }
    if (name.includes('search') || name.includes('query') || name.includes('web') || name.includes('google')) {
      return <Search size={12} />
    }
    if (name.includes('url') || name.includes('fetch') || name.includes('browser') || name.includes('http')) {
      return <Globe size={12} />
    }
    if (name.includes('memory')) {
      return <Brain size={12} />
    }
    return <HelpCircle size={12} />
  }

  const getStatusStyles = (status: TimelineNode['status']) => {
    switch (status) {
      case 'completed':
        return {
          color: 'var(--color-text-muted)',
          border: '1px solid var(--color-border)',
          background: 'transparent'
        }
      case 'running':
        return {
          color: 'var(--color-primary)',
          border: '1px solid var(--color-primary)',
          background: 'transparent'
        }
      case 'pending':
        return {
          color: 'var(--color-warning)',
          border: '1px solid var(--color-warning)',
          background: 'transparent'
        }
      case 'denied':
      case 'failed':
        return {
          color: 'var(--color-danger)',
          border: '1px solid var(--color-danger)',
          background: 'transparent'
        }
      default:
        return {
          color: 'var(--color-text-faint)',
          border: '1px solid var(--color-border)',
          background: 'transparent'
        }
    }
  }

  const renderArgs = (args: any) => {
    if (!args || typeof args !== 'object') return null
    return (
      <div className="timeline-args-section">
        <span className="timeline-section-title">
          <Code size={10} style={{ marginRight: '4px' }} />
          调用参数
        </span>
        <pre className="timeline-pre-code">
          <code>{JSON.stringify(args, null, 2)}</code>
        </pre>
      </div>
    )
  }

  const renderResult = (node: TimelineNode) => {
    if (node.error) {
      return (
        <div className="timeline-error-section">
          <span className="timeline-section-title" style={{ color: 'var(--color-danger)' }}>
            <AlertCircle size={10} style={{ marginRight: '4px' }} />
            执行报错
          </span>
          <div className="timeline-error-box">{node.error}</div>
        </div>
      )
    }

    const res = node.result
    if (!res) return null

    return (
      <div className="timeline-result-section">
        {res.title && <div className="timeline-result-title">{res.title}</div>}
        {res.summary && <div className="timeline-result-summary">{res.summary}</div>}
        {res.url && (
          <div className="timeline-result-url">
            <Globe size={10} />
            <a href={res.url} target="_blank" rel="noreferrer">
              {res.url}
            </a>
            <ExternalLink size={8} />
          </div>
        )}
        {res.items && res.items.length > 0 && (
          <div className="timeline-result-items">
            {res.items.map((item, itemIdx) => (
              <div key={itemIdx} className="timeline-result-item-card">
                <div className="timeline-result-item-card-header">
                  <span className="timeline-result-item-idx">#{itemIdx + 1}</span>
                  <a href={item.url} target="_blank" rel="noreferrer" className="timeline-result-item-link">
                    {item.title}
                  </a>
                  {item.source && <span className="timeline-result-item-source">{item.source}</span>}
                </div>
                {item.snippet && <div className="timeline-result-item-snippet">{item.snippet}</div>}
              </div>
            ))}
          </div>
        )}
      </div>
    )
  }

  return (
    <aside className={`task-panel ${isOpen ? 'open' : ''}`}>
      {/* 1. Header Area */}
      <div className="task-panel-header">
        <div className="task-panel-title">
          <Clock size={14} style={{ color: 'var(--color-text-title)' }} />
          <span>运行分析</span>
        </div>
        <button type="button" className="sidebar-icon-btn" onClick={onClose} title="收起面板">
          <ChevronRight size={14} />
        </button>
      </div>

      {/* 2. Tabs Switcher if tasks are present */}
      {hasTasks && (
        <div className="timeline-tab-header">
          <button
            type="button"
            className={`timeline-tab-btn ${activeTab === 'timeline' ? 'active' : ''}`}
            onClick={() => setActiveTab('timeline')}
          >
            执行步骤
          </button>
          <button
            type="button"
            className={`timeline-tab-btn ${activeTab === 'tasks' ? 'active' : ''}`}
            onClick={() => setActiveTab('tasks')}
          >
            任务进度
          </button>
        </div>
      )}

      {/* 3. Panel Content */}
      <div className="task-panel-content">
        {/* Tab 1: Execution steps timeline */}
        {activeTab === 'timeline' && (
          <div className="timeline-container">
            {timelineNodes.length === 0 ? (
              <div className="timeline-empty">
                <Loader2 size={14} className="animate-spin" />
                <span>等待执行步骤...</span>
              </div>
            ) : (
              <>
                <div className="timeline-thread" />
                {timelineNodes.map((node) => {
                  const isExpanded = !!expandedNodes[node.id]
                  const statusStyle = getStatusStyles(node.status)
                  const icon = getToolIcon(node.type, node.toolName)

                  return (
                    <div key={node.id} className={`timeline-step-item ${node.status}`}>
                      {/* Left circular node with clean border & status color */}
                      <div className="timeline-node-circle" style={statusStyle}>
                        {node.status === 'running' && node.type === 'tool' ? (
                          <Loader2 size={12} className="animate-spin" />
                        ) : (
                          icon
                        )}
                      </div>

                      {/* Right content card (transparent & flat in minimalist theme) */}
                      <div className="timeline-content-card">
                        <div className="timeline-header-row" onClick={() => toggleNode(node.id)}>
                          <span
                            className="timeline-step-title"
                            style={
                              node.type === 'thought'
                                ? { fontStyle: 'italic', color: 'var(--color-text-faint)' }
                                : node.status === 'running'
                                  ? { color: 'var(--color-primary)' }
                                  : node.status === 'failed' || node.status === 'denied'
                                    ? { color: 'var(--color-danger)' }
                                    : {}
                            }
                          >
                            {node.title}
                            {node.purpose && node.toolName && (
                              <span className="timeline-step-toolname-tag">
                                {node.toolName}
                              </span>
                            )}
                          </span>
                          <span className="timeline-expand-btn">
                            <ChevronDown
                              size={12}
                              style={{
                                transform: isExpanded ? 'rotate(180deg)' : 'rotate(0)',
                                transition: 'transform 0.15s ease'
                              }}
                            />
                          </span>
                        </div>

                        {/* Collapsible details drawer */}
                        {isExpanded && (
                          <div className="timeline-detail-drawer">
                            {node.type === 'thought' && node.thought && (
                              <div className="timeline-thought-box">{node.thought}</div>
                            )}
                            {node.type === 'tool' && (
                              <>
                                {renderArgs(node.args)}
                                {renderResult(node)}
                              </>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  )
                })}
              </>
            )}
          </div>
        )}

        {/* Tab 2: High level tasks list */}
        {activeTab === 'tasks' && (
          <div className="task-items-list">
            {tasks.map((t) => {
              let statusIcon = (
                <Circle size={13} style={{ color: 'var(--color-text-muted)', opacity: 0.6 }} />
              )
              if (t.status === 'in_progress') {
                statusIcon = (
                  <Loader2
                    size={13}
                    className="animate-spin"
                    style={{ color: 'var(--color-primary)' }}
                  />
                )
              } else if (t.status === 'completed') {
                statusIcon = <CheckCircle2 size={13} style={{ color: '#10b981' }} />
              } else if (t.status === 'cancelled') {
                statusIcon = <XCircle size={13} style={{ color: '#ef4444', opacity: 0.8 }} />
              }

              return (
                <div key={t.id} className={`task-item-row ${t.status}`}>
                  <span className="task-item-status-icon">{statusIcon}</span>
                  <span className="task-item-title">{t.title}</span>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </aside>
  )
}
