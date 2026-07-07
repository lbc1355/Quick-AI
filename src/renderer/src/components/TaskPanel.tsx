import React, { useState, useMemo, useEffect } from 'react'
import {
  CheckCircle2,
  XCircle,
  X,
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
import { TaskItem, AgentEvent, Message } from '../../../shared/types'
import {
  parseAgentSteps,
  ParsedToolCall,
  ParsedAgentStep,
  ParsedAgentRun,
  renderMessageContent
} from '../utils/messageFormat'

interface TaskPanelProps {
  message: Message
  isOpen: boolean
  onClose: () => void
  isGenerating?: boolean
}

export const TaskPanel: React.FC<TaskPanelProps> = ({
  message,
  isOpen,
  onClose,
  isGenerating = false
}) => {
  const [activeTab, setActiveTab] = useState<'timeline' | 'tasks'>('timeline')

  // Parse high-level tasks checklist if present in agentEvents
  const tasks = useMemo<TaskItem[]>(() => {
    if (!message || !message.agentEvents) return []
    const taskEvent = message.agentEvents.reduce<Extract<
      AgentEvent,
      { type: 'task_update' }
    > | null>((last, e) => (e.type === 'task_update' ? e : last), null)
    return taskEvent ? taskEvent.tasks : []
  }, [message])

  const hasTasks = tasks.length > 0

  // Fallback to timeline if activeTab is 'tasks' but tasks are cleared
  const parsedRun = useMemo<ParsedAgentRun>(() => {
    return parseAgentSteps(message?.agentEvents, message?.content)
  }, [message?.agentEvents, message?.content])

  const [expandedSteps, setExpandedSteps] = useState<Record<string, boolean>>({})
  const [expandedTools, setExpandedTools] = useState<Record<string, boolean>>({})

  // Fallback to timeline if activeTab is 'tasks' but tasks are cleared
  useEffect(() => {
    if (!hasTasks && activeTab === 'tasks') {
      setActiveTab('timeline')
    }
  }, [hasTasks, activeTab])

  // Manage steps and tools auto-expansion states during active runs
  useEffect(() => {
    if (isGenerating && parsedRun.steps.length > 0) {
      const latestStep = parsedRun.steps[parsedRun.steps.length - 1]

      // Auto-expand the latest step
      setExpandedSteps({
        [latestStep.id]: true
      })

      // Auto-expand any running or pending tool calls
      const runningTools: Record<string, boolean> = {}
      latestStep.toolCalls.forEach((tc) => {
        if (tc.status === 'running' || tc.status === 'pending') {
          runningTools[tc.callId] = true
        }
      })
      setExpandedTools(runningTools)
    } else {
      setExpandedSteps({})
      setExpandedTools({})
    }
  }, [parsedRun.steps, isGenerating])

  const toggleStep = (stepId: string): void => {
    setExpandedSteps((prev) => ({
      ...prev,
      [stepId]: !prev[stepId]
    }))
  }

  const toggleTool = (toolId: string): void => {
    setExpandedTools((prev) => ({
      ...prev,
      [toolId]: !prev[toolId]
    }))
  }

  const getStepTitle = (step: ParsedAgentStep): string => {
    if (step.title) return step.title
    if (step.progressMessage) {
      const firstLine = step.progressMessage
        .trim()
        .split(/[。\n]/)[0]
        .trim()
      const clean = firstLine.replace(/[*#_`[\]]/g, '').trim()
      if (clean.length > 0) {
        return clean.length > 30 ? clean.substring(0, 30) + '...' : clean
      }
    }
    if (step.toolCalls.length > 0) {
      const uniqueTools = Array.from(new Set(step.toolCalls.map((tc) => tc.toolName)))
      return `执行 ${uniqueTools.join(', ')}`
    }
    return '思考分析中...'
  }

  const getArgsRecord = (args: unknown): Record<string, unknown> | null =>
    args && typeof args === 'object' && !Array.isArray(args)
      ? (args as Record<string, unknown>)
      : null

  const toText = (value: unknown): string => (typeof value === 'string' ? value : '')

  const getStepDescription = (toolName: string, args: unknown): string => {
    const argsObj = getArgsRecord(args)
    const name = toolName.toLowerCase()

    const truncate = (text: string, maxLen: number = 32): string => {
      if (typeof text !== 'string') return ''
      if (text.length <= maxLen) return text
      return text.substring(0, maxLen) + '...'
    }

    const getFileLabel = (val: unknown): string => {
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
      const cmd = toText(argsObj?.CommandLine || argsObj?.command || argsObj?.cmd)
      return `执行命令: ${cmd ? truncate(cmd) : ''}`
    }

    if (
      name.includes('search') ||
      name.includes('query') ||
      name.includes('web') ||
      name.includes('google')
    ) {
      const query = toText(argsObj?.query || argsObj?.q)
      return `网络搜索: ${query ? truncate(query) : ''}`
    }

    if (
      name.includes('url') ||
      name.includes('fetch') ||
      name.includes('browser') ||
      name.includes('http')
    ) {
      const url = argsObj?.url || argsObj?.Url || argsObj?.uri
      if (url && typeof url === 'string') {
        const displayUrl = url.replace(/^https?:\/\/(www\.)?/, '')
        return `网页抓取: ${truncate(displayUrl)}`
      }
    }

    if (name.includes('memory')) {
      const target = toText(argsObj?.target || argsObj?.group_name || argsObj?.groupName)
      if (name.includes('write')) return `写入记忆: ${target || ''}`
      if (name.includes('delete')) return `删除记忆: ${target || ''}`
      return `读取记忆: ${target || ''}`
    }

    return `调用工具: ${toolName}`
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
    if (
      name.includes('search') ||
      name.includes('query') ||
      name.includes('web') ||
      name.includes('google')
    ) {
      return <Search size={12} />
    }
    if (
      name.includes('url') ||
      name.includes('fetch') ||
      name.includes('browser') ||
      name.includes('http')
    ) {
      return <Globe size={12} />
    }
    if (name.includes('memory')) {
      return <Brain size={12} />
    }
    return <HelpCircle size={12} />
  }

  const getStatusStyles = (
    status: ParsedToolCall['status']
  ): { color: string; border: string; background: string } => {
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

  const getShellCommandArg = (toolName: string, args: unknown): string => {
    const argsObj = getArgsRecord(args)
    if (!argsObj) return ''
    const name = toolName.toLowerCase()
    if (!name.includes('command') && !name.includes('shell') && !name.includes('run')) return ''
    const cmd = argsObj.CommandLine || argsObj.command || argsObj.cmd
    return typeof cmd === 'string' ? cmd : ''
  }

  const renderArgs = (toolName: string, args: unknown): React.ReactNode => {
    const argsObj = getArgsRecord(args)
    if (!argsObj) return null
    const shellCommand = getShellCommandArg(toolName, args)
    return (
      <div className="timeline-args-section">
        <span className="timeline-section-title">
          <Code size={10} style={{ marginRight: '4px' }} />
          调用参数
        </span>
        <pre className="timeline-pre-code">
          <code>{shellCommand || JSON.stringify(argsObj, null, 2)}</code>
        </pre>
      </div>
    )
  }

  const renderResult = (node: ParsedToolCall): React.ReactNode => {
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
                  <a
                    href={item.url}
                    target="_blank"
                    rel="noreferrer"
                    className="timeline-result-item-link"
                  >
                    {item.title}
                  </a>
                  {item.source && (
                    <span className="timeline-result-item-source">{item.source}</span>
                  )}
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
          <X size={14} />
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
          <div
            className="steps-accordion-container"
            style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}
          >
            {parsedRun.steps.length === 0 ? (
              <div className="timeline-empty">
                <Loader2 size={14} className="animate-spin" />
                <span>等待执行步骤...</span>
              </div>
            ) : (
              parsedRun.steps.map((step, stepIdx) => {
                const isExpanded = !!expandedSteps[step.id]
                const stepTitle = getStepTitle(step)
                const failedCount = step.toolCalls.filter(
                  (tc) => tc.status === 'failed' || tc.status === 'denied'
                ).length

                return (
                  <div
                    key={step.id}
                    className={`step-accordion-item ${step.status} ${isExpanded ? 'open' : ''}`}
                  >
                    {/* Step Accordion Header */}
                    <div className="step-accordion-header" onClick={() => toggleStep(step.id)}>
                      <div className="step-accordion-status">
                        {step.status === 'running' ? (
                          <Loader2
                            size={13}
                            className="animate-spin"
                            style={{ color: 'var(--color-primary)' }}
                          />
                        ) : step.status === 'failed' ? (
                          <XCircle size={13} style={{ color: 'var(--color-danger)' }} />
                        ) : step.status === 'cancelled' ? (
                          <XCircle size={13} style={{ color: 'var(--color-warning)' }} />
                        ) : (
                          <CheckCircle2 size={13} style={{ color: 'var(--color-success)' }} />
                        )}
                      </div>
                      <div className="step-accordion-title">
                        <span className="step-num">{stepIdx + 1}.</span>
                        <span className="step-title-text">{stepTitle}</span>
                      </div>
                      <div className="step-accordion-meta">
                        {step.toolCalls.length > 0 && (
                          <span className="step-tools-count">
                            {step.toolCalls.length} tools
                            {failedCount > 0 ? ` · ${failedCount} failed` : ''}
                          </span>
                        )}
                      </div>
                      <ChevronDown
                        size={12}
                        className="step-accordion-chevron"
                        style={{
                          transform: isExpanded ? 'rotate(180deg)' : 'rotate(0)',
                          transition: 'transform 0.15s ease'
                        }}
                      />
                    </div>

                    {/* Step Accordion Content */}
                    {isExpanded && (
                      <div className="step-accordion-content" style={{ padding: '10px 12px 14px' }}>
                        {/* 1. Model Progress Message */}
                        {step.progressMessage && (
                          <div
                            className="step-model-progress"
                            style={{ marginBottom: step.toolCalls.length > 0 ? '14px' : '0' }}
                          >
                            <div
                              className="step-section-subtitle"
                              style={{
                                fontSize: '11px',
                                fontWeight: 'bold',
                                color: 'var(--color-text-faint)',
                                textTransform: 'uppercase',
                                letterSpacing: '0.5px',
                                marginBottom: '6px'
                              }}
                            >
                              模型进度
                            </div>
                            <div
                              className="step-progress-message-content"
                              style={{
                                fontSize: '12.5px',
                                color: 'var(--color-text)',
                                lineHeight: '1.6'
                              }}
                            >
                              {renderMessageContent(step.progressMessage)}
                            </div>
                          </div>
                        )}

                        {/* 2. Nested Tool Calls */}
                        {step.toolCalls.length > 0 && (
                          <div className="step-tool-calls">
                            <div
                              className="step-section-subtitle"
                              style={{
                                fontSize: '11px',
                                fontWeight: 'bold',
                                color: 'var(--color-text-faint)',
                                textTransform: 'uppercase',
                                letterSpacing: '0.5px',
                                marginBottom: '8px'
                              }}
                            >
                              工具调用
                            </div>
                            <div
                              className="timeline-container nested"
                              style={{
                                display: 'flex',
                                flexDirection: 'column',
                                gap: '12px',
                                paddingLeft: '4px',
                                position: 'relative'
                              }}
                            >
                              <div
                                className="timeline-thread"
                                style={{
                                  position: 'absolute',
                                  left: '12px',
                                  top: '10px',
                                  bottom: '10px',
                                  width: '2px',
                                  background: 'var(--color-border)',
                                  opacity: 0.5
                                }}
                              />
                              {step.toolCalls.map((tc) => {
                                const isToolExpanded = !!expandedTools[tc.callId]
                                const statusStyle = getStatusStyles(tc.status)
                                const icon = getToolIcon('tool', tc.toolName)
                                const toolTitle =
                                  tc.purpose || getStepDescription(tc.toolName, tc.args)

                                return (
                                  <div
                                    key={tc.callId}
                                    className={`timeline-step-item ${tc.status}`}
                                    style={{ display: 'flex', gap: '12px', position: 'relative' }}
                                  >
                                    <div
                                      className="timeline-node-circle"
                                      style={{
                                        ...statusStyle,
                                        width: '26px',
                                        height: '26px',
                                        borderRadius: '50%',
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        flexShrink: 0,
                                        zIndex: 1,
                                        background: 'var(--color-panel)'
                                      }}
                                    >
                                      {tc.status === 'running' ? (
                                        <Loader2 size={12} className="animate-spin" />
                                      ) : (
                                        icon
                                      )}
                                    </div>
                                    <div
                                      className="timeline-content-card"
                                      style={{ flex: 1, minWidth: 0 }}
                                    >
                                      <div
                                        className="timeline-header-row"
                                        onClick={() => toggleTool(tc.callId)}
                                        style={{
                                          display: 'flex',
                                          alignItems: 'center',
                                          justifyContent: 'space-between',
                                          cursor: 'pointer',
                                          padding: '4px 0'
                                        }}
                                      >
                                        <span
                                          className="timeline-step-title"
                                          style={{
                                            fontSize: '12px',
                                            fontWeight: 500,
                                            color: 'var(--color-text)',
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: '8px',
                                            flex: 1,
                                            minWidth: 0
                                          }}
                                        >
                                          <span
                                            style={{
                                              overflow: 'hidden',
                                              textOverflow: 'ellipsis',
                                              whiteSpace: 'nowrap'
                                            }}
                                          >
                                            {toolTitle}
                                          </span>
                                          {tc.toolName && (
                                            <span
                                              className="timeline-step-toolname-tag"
                                              style={{
                                                fontSize: '9.5px',
                                                background: 'var(--color-inline-code-bg)',
                                                border: '1px solid var(--color-border)',
                                                color: 'var(--color-text-muted)',
                                                padding: '1px 4px',
                                                borderRadius: '4px',
                                                flexShrink: 0
                                              }}
                                            >
                                              {tc.toolName}
                                            </span>
                                          )}
                                        </span>
                                        <ChevronDown
                                          size={12}
                                          style={{
                                            transform: isToolExpanded
                                              ? 'rotate(180deg)'
                                              : 'rotate(0)',
                                            transition: 'transform 0.15s ease',
                                            color: 'var(--color-text-faint)'
                                          }}
                                        />
                                      </div>
                                      {isToolExpanded && (
                                        <div
                                          className="timeline-detail-drawer"
                                          style={{
                                            borderLeft: '1px solid var(--color-border)',
                                            margin: '5px 0 4px 0',
                                            padding: '6px 0 8px 10px'
                                          }}
                                        >
                                          {renderArgs(tc.toolName, tc.args)}
                                          {renderResult(tc)}
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                )
                              })}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )
              })
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
