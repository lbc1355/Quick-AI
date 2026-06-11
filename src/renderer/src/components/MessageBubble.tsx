/* eslint-disable react/display-name, react/prop-types */
import React, { useState, useEffect } from 'react'
import { Message, AgentEvent } from '../../../shared/types'
import {
  Edit,
  RefreshCw,
  Paperclip,
  Sparkles,
  Play,
  Copy,
  Check,
  ChevronDown,
  ChevronRight,
  SquareTerminal,
  Brain,
  AlertCircle,
  GitBranch,
  ListTodo,
  Loader2
} from 'lucide-react'
import {
  parseThinkTags,
  renderMessageContent,
  parseAgentLogs,
  AgentLogStep
} from '../utils/messageFormat'
import { shortBranchRunId, type BranchChildInfo } from '../utils/branchDisplay'

interface LogStepRowProps {
  log: AgentLogStep
  resultLog?: AgentLogStep
  errorLog?: AgentLogStep
  parentExpanded: boolean
}

const LogStepRow: React.FC<LogStepRowProps> = ({ log, resultLog, errorLog, parentExpanded }) => {
  const [isExpanded, setIsExpanded] = useState(false)

  useEffect(() => {
    if (!resultLog && !errorLog) {
      setIsExpanded(true)
    } else {
      setIsExpanded(false)
    }
  }, [resultLog, errorLog])

  const displayUrl = log.url ? log.url.replace(/^https?:\/\/(www\.)?/, '') : ''
  const truncatedUrl = displayUrl.length > 55 ? displayUrl.substring(0, 55) + '...' : displayUrl
  const statusText = errorLog ? 'Failed' : resultLog ? 'Ran' : 'Running'

  return (
    <div className="agent-flow-step">
      <button
        type="button"
        className={`agent-flow-row ${errorLog ? 'failed' : resultLog ? 'done' : 'running'}`}
        onClick={() => setIsExpanded(!isExpanded)}
      >
        {errorLog ? <AlertCircle size={13} /> : <SquareTerminal size={13} />}
        <span className="agent-flow-label">
          {statusText} {log.toolName}
        </span>
        {truncatedUrl && <span className="agent-flow-meta">{truncatedUrl}</span>}
        <span className="agent-flow-toggle">
          {isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </span>
      </button>

      <div
        className="agent-flow-detail"
        style={{ display: parentExpanded && isExpanded ? 'flex' : 'none' }}
      >
        {log.url && (
          <div style={{ wordBreak: 'break-all' }}>
            URL:{' '}
            <a
              href={log.url}
              target="_blank"
              rel="noreferrer"
              style={{ color: 'var(--color-primary)', textDecoration: 'none' }}
            >
              {log.url}
            </a>
          </div>
        )}
        {resultLog && (
          <div style={{ textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>
            Title: {resultLog.title || 'No Title'}
          </div>
        )}
        {errorLog && <div style={{ color: '#f87171' }}>Error: {errorLog.error}</div>}
      </div>
    </div>
  )
}

const LogThinkRow: React.FC<{
  log: AgentLogStep
  parentExpanded: boolean
  isThinking?: boolean
}> = ({ log, parentExpanded, isThinking = false }) => {
  const [isExpanded, setIsExpanded] = useState(false)

  useEffect(() => {
    if (isThinking) {
      setIsExpanded(true)
    } else {
      setIsExpanded(false)
    }
  }, [isThinking])

  const title = log.step > 0 ? `Thought (Step ${log.step}/${log.maxSteps})` : `Thought`

  return (
    <div className="agent-flow-step">
      <button
        type="button"
        className="agent-flow-row muted"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <Brain size={13} />
        <span className="agent-flow-label">{title}</span>
        <span className="agent-flow-toggle">
          {isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </span>
      </button>
      <div
        className="agent-flow-detail thought"
        style={{ display: parentExpanded && isExpanded ? 'block' : 'none' }}
      >
        {log.thought}
      </div>
    </div>
  )
}



interface MessageBubbleProps {
  msg: Message
  idx: number
  branchChildren?: BranchChildInfo[]
  isGenerating: boolean
  editingMessageId: string | null
  editingText: string
  onStartEdit: (msg: Message) => void
  onCancelEdit: () => void
  onSaveEdit: (msgId: string, text: string) => void
  onRegenerate: (idx: number) => void
  onResumeAgentRun: (idx: number) => void
  onOpenBranch: (sessionId: string) => void
  onChangeEditingText: (text: string) => void
  activeTaskMessageId: string | null
  isTaskPanelOpen: boolean
  onToggleTasks: (msgId: string) => void
}

export const MessageBubble = React.memo<MessageBubbleProps>(
  ({
    msg,
    idx,
    branchChildren = [],
    isGenerating,
    editingMessageId,
    editingText,
    onStartEdit,
    onCancelEdit,
    onSaveEdit,
    onRegenerate,
    onResumeAgentRun,
    onOpenBranch,
    onChangeEditingText,
    activeTaskMessageId,
    isTaskPanelOpen,
    onToggleTasks
  }) => {
    const [isExpanded, setIsExpanded] = useState(true)
    const { content: displayContent, reasoning: displayReasoning } = parseThinkTags(
      msg.content,
      msg.reasoning_content
    )

    // Determine if we use structured agent events or legacy string logs fallback
    const hasStructuredEvents = msg.agentEvents && msg.agentEvents.length > 0
    const legacyLogs = !hasStructuredEvents ? parseAgentLogs(displayContent).logs : []
    const cleanContent = hasStructuredEvents
      ? displayContent
      : parseAgentLogs(displayContent).cleanContent

    const [userExpandedOverride, setUserExpandedOverride] = useState<boolean | null>(null)
    const [copied, setCopied] = useState(false)
    const isEditing = editingMessageId === msg.id
    const isBranchForkMessage = Boolean(msg.isBranchFork || msg.forkedFrom)
    const branchRunId = shortBranchRunId(msg.forkedFrom?.runId)

    const [elapsed, setElapsed] = useState<number>(0)

    const toolCallCount = hasStructuredEvents
      ? msg.agentEvents!.filter((e) => e.type === 'tool_call').length
      : legacyLogs.filter((l) => l.type === 'tool').length
    const thoughtCount = hasStructuredEvents
      ? msg.agentEvents!.filter((e) => e.type === 'reasoning').length
      : legacyLogs.filter((l) => l.type === 'think').length

    const hasLogs = hasStructuredEvents || legacyLogs.length > 0

    useEffect(() => {
      if (isGenerating && !cleanContent && hasLogs) {
        const startTime = parseInt(msg.id) || Date.now()
        const timer = setInterval(() => {
          setElapsed(Math.round((Date.now() - startTime) / 1000))
        }, 500)
        return () => clearInterval(timer)
      }
      return undefined
    }, [isGenerating, cleanContent, hasLogs, msg.id])

    // Find agent_end event in the events list
    const agentEndEvent = msg.agentEvents?.reduce<Extract<
      AgentEvent,
      { type: 'agent_end' }
    > | null>((last, e) => (e.type === 'agent_end' ? e : last), null)
    // Find the last agent_progress event in the events list
    const lastProgressEvent = msg.agentEvents?.reduce<Extract<
      AgentEvent,
      { type: 'agent_progress' }
    > | null>((last, e) => (e.type === 'agent_progress' ? e : last), null)

    let agentStatus: 'idle' | 'running' | 'completed' | 'cancelled' | 'failed' | 'max_steps' =
      'idle'
    if (msg.agentEvents || msg.agentRunId) {
      if (agentEndEvent) {
        agentStatus = agentEndEvent.status
      } else if (isGenerating) {
        agentStatus = 'running'
      } else {
        agentStatus = cleanContent ? 'completed' : 'idle'
      }
    }

    const currentStep = lastProgressEvent?.step || 1
    const maxSteps = lastProgressEvent?.maxSteps || 30

    let statusLabel = ''
    let statusColor = 'var(--color-text-muted)'
    if (agentStatus === 'running') {
      statusLabel = `Running (Step ${currentStep}/${maxSteps})`
      statusColor = '#3b82f6'
    } else if (agentStatus === 'completed') {
      statusLabel = 'Completed'
      statusColor = '#10b981'
    } else if (agentStatus === 'cancelled') {
      statusLabel = 'Cancelled'
      statusColor = '#f59e0b'
    } else if (agentStatus === 'failed') {
      statusLabel = 'Failed'
      statusColor = '#ef4444'
    } else if (agentStatus === 'max_steps') {
      statusLabel = 'Step Limit Reached'
      statusColor = '#f59e0b'
    }

    // Find the index of the last 'final' event in msg.agentEvents
    let lastFinalEventIdx = -1
    if (msg.agentEvents) {
      for (let i = msg.agentEvents.length - 1; i >= 0; i--) {
        if (msg.agentEvents[i].type === 'final') {
          lastFinalEventIdx = i
          break
        }
      }
    }

    // The assistant's final reply text — the last 'final' event for structured runs, otherwise
    // the cleaned content. This is what the copy button puts on the clipboard.
    const finalReplyText =
      hasStructuredEvents && lastFinalEventIdx !== -1
        ? (msg.agentEvents![lastFinalEventIdx] as Extract<AgentEvent, { type: 'final' }>).content
        : cleanContent

    const handleCopy = (): void => {
      if (!finalReplyText) return
      navigator.clipboard
        .writeText(finalReplyText)
        .then(() => {
          setCopied(true)
          setTimeout(() => setCopied(false), 1500)
        })
        .catch((err) => console.warn('Copy failed:', err))
    }

    // Derived logs expansion state.
    const defaultLogsExpanded = hasStructuredEvents
      ? isGenerating
      : hasLogs && isGenerating
    const effectiveLogsExpanded =
      userExpandedOverride !== null ? userExpandedOverride : defaultLogsExpanded
    const actionSummaryText =
      toolCallCount > 0
        ? `${agentStatus === 'running' ? '正在运行' : '已运行'} ${toolCallCount} 条命令`
        : `${agentStatus === 'running' ? '正在处理' : '已处理'} ${thoughtCount} 条动作`
    const actionMetaText =
      thoughtCount > 0 && toolCallCount > 0 ? `含 ${thoughtCount} 条思考` : undefined

    const formatToolArgsSummary = (toolName: string, args: any): string => {
      if (!args || typeof args !== 'object') return ''
      const name = toolName.toLowerCase()
      if (name.includes('command') || name.includes('shell') || name.includes('run')) {
        const cmd = args.CommandLine || args.command || args.cmd
        if (typeof cmd === 'string') {
          return cmd.length > 50 ? cmd.substring(0, 50) + '...' : cmd
        }
      }
      const path = args.path || args.TargetFile || args.AbsolutePath || args.Target || args.file || args.filePath
      if (path && typeof path === 'string') {
        const parts = path.replace(/\\/g, '/').split('/')
        return parts.length > 2 ? '.../' + parts.slice(-2).join('/') : path
      }
      const query = args.query || args.q
      if (query && typeof query === 'string') {
        return `"${query.length > 40 ? query.substring(0, 40) + '...' : query}"`
      }
      const url = args.url || args.Url || args.uri
      if (url && typeof url === 'string') {
        const displayUrl = url.replace(/^https?:\/\/(www\.)?/, '')
        return displayUrl.length > 40 ? displayUrl.substring(0, 40) + '...' : displayUrl
      }
      const keyVal = Object.entries(args)
        .filter(([k]) => k !== 'purpose')
        .map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`)
        .join(', ')
      return keyVal.length > 50 ? `{${keyVal.substring(0, 50)}...}` : `{${keyVal}}`
    }

    const totalToolsCount = msg.agentEvents
      ? msg.agentEvents.filter((e) => e.type === 'tool_call').length
      : 0
    const failedToolsCount = msg.agentEvents
      ? msg.agentEvents.filter((e) => e.type === 'tool_error').length
      : 0
    const latestToolCall = msg.agentEvents
      ? [...msg.agentEvents].reverse().find((e): e is Extract<AgentEvent, { type: 'tool_call' }> => e.type === 'tool_call')
      : undefined

    const latestTaskEvent = msg.agentEvents
      ? [...msg.agentEvents].reverse().find((e): e is Extract<AgentEvent, { type: 'task_update' }> => e.type === 'task_update')
      : undefined
    const tasks = latestTaskEvent?.tasks || []
    const inProgressTaskIdx = tasks.findIndex((t) => t.status === 'in_progress')
    const inProgressTask = inProgressTaskIdx !== -1 ? tasks[inProgressTaskIdx] : undefined

    const pendingToolCall = msg.agentEvents
      ? msg.agentEvents.find((e): e is Extract<AgentEvent, { type: 'tool_call' }> => e.type === 'tool_call' && e.permissionState === 'pending')
      : undefined

    let statusText = ''
    let opText = ''
    let toolsSummaryText = ''
    let cockpitColor = '#94a3b8'

    if (pendingToolCall) {
      cockpitColor = '#f59e0b'
      const progressStr = inProgressTask
        ? `${inProgressTaskIdx + 1}/${tasks.length}`
        : `第 ${currentStep}/${maxSteps} 步`
      statusText = `等待确认 · ${progressStr} ${inProgressTask ? inProgressTask.title : ''}`
      const argsStr = formatToolArgsSummary(pendingToolCall.toolName, pendingToolCall.args)
      opText = pendingToolCall.toolName === 'shell'
        ? `shell 需要授权：${argsStr}`
        : `${pendingToolCall.toolName} 需要授权：${argsStr}`
      toolsSummaryText = `已运行 ${totalToolsCount - 1} 个工具${failedToolsCount > 0 ? ` · ${failedToolsCount} 个失败已恢复` : ''}`
    } else if (agentStatus === 'running') {
      cockpitColor = '#3b82f6'
      const progressStr = inProgressTask
        ? `${inProgressTaskIdx + 1}/${tasks.length} ${inProgressTask.title}`
        : `第 ${currentStep}/${maxSteps} 步`
      statusText = `正在执行 · ${progressStr}`
      if (latestToolCall) {
        const argsStr = formatToolArgsSummary(latestToolCall.toolName, latestToolCall.args)
        opText = `当前操作：${latestToolCall.purpose || `${latestToolCall.toolName} ${argsStr}`}`
        toolsSummaryText = `工具：${latestToolCall.toolName} · 已运行 ${totalToolsCount} 个工具${failedToolsCount > 0 ? ` · ${failedToolsCount} 个失败已恢复` : ''}`
      } else {
        opText = '当前操作：思考分析中...'
        toolsSummaryText = `已运行 ${totalToolsCount} 个工具`
      }
    } else if (agentStatus === 'completed') {
      cockpitColor = '#10b981'
      const taskTitle = tasks.length > 0 ? tasks[tasks.length - 1].title : '完成所有任务'
      const progressStr = tasks.length > 0 ? `${tasks.length}/${tasks.length} ${taskTitle}` : '任务已完成'
      statusText = `已完成 · ${progressStr}`
      opText = `共运行 ${totalToolsCount} 个工具${failedToolsCount > 0 ? ` · ${failedToolsCount} 个失败已恢复` : ''}`
      toolsSummaryText = ''
    } else if (agentStatus === 'cancelled') {
      cockpitColor = '#f59e0b'
      const completedTasksCount = tasks.filter((t) => t.status === 'completed').length
      statusText = `已取消 · ${completedTasksCount}/${tasks.length} 已完成`
      opText = `共运行 ${totalToolsCount} 个工具${failedToolsCount > 0 ? ` · ${failedToolsCount} 个失败` : ''}`
    } else if (agentStatus === 'failed' || agentStatus === 'max_steps') {
      cockpitColor = '#ef4444'
      const completedTasksCount = tasks.filter((t) => t.status === 'completed').length
      statusText = `${agentStatus === 'max_steps' ? '步数上限' : '执行失败'} · ${completedTasksCount}/${tasks.length} 已完成`
      opText = `共运行 ${totalToolsCount} 个工具${failedToolsCount > 0 ? ` · ${failedToolsCount} 个失败` : ''}`
    } else {
      statusText = '空闲'
      opText = `共运行 ${totalToolsCount} 个工具`
    }

    return (
      <div className={`message-row-shell ${msg.role}`} data-message-id={msg.id}>
        {/* 1. Collapsible logs area for structured events */}
        {hasStructuredEvents && (
          <div
            className="agent-inline-summary-box"
            style={{
              borderColor: pendingToolCall ? '#f59e0b' : undefined
            }}
          >
            <div className="summary-header">
              <div className="summary-title-wrapper">
                {(agentStatus === 'running' || pendingToolCall) ? (
                  <Loader2 size={12} className="animate-spin summary-status-icon" style={{ color: cockpitColor }} />
                ) : agentStatus === 'completed' ? (
                  <Check size={12} className="summary-status-icon" style={{ color: cockpitColor }} />
                ) : (
                  <AlertCircle size={12} className="summary-status-icon" style={{ color: cockpitColor }} />
                )}
                <span className="summary-status-text" style={{ color: cockpitColor }}>
                  {statusText}
                </span>
                {agentStatus === 'running' && !pendingToolCall && (
                  <span className="summary-timer">• {elapsed}s</span>
                )}
              </div>
              <button
                type="button"
                className={`summary-details-btn ${
                  activeTaskMessageId === msg.id && isTaskPanelOpen ? 'active' : ''
                }`}
                onClick={() => onToggleTasks(msg.id)}
              >
                <ListTodo size={11} />
                <span>
                  {activeTaskMessageId === msg.id && isTaskPanelOpen ? '关闭详情' : '执行详情'}
                </span>
              </button>
            </div>
            
            <div className="summary-body">
              <div className="summary-current-op" title={opText}>
                {opText}
              </div>
              {toolsSummaryText && (
                <div className="summary-tools-info">
                  {toolsSummaryText}
                </div>
              )}
            </div>
          </div>
        )}

        {/* 2. Legacy logs wrapper */}
        {!hasStructuredEvents && hasLogs && (
          <div
            className="agent-logs-container-fullwidth"
            style={{
              margin: '12px 0 16px 0',
              padding: '0 4px',
              fontSize: '11px',
              color: 'var(--color-text-muted)'
            }}
          >
            <div
              onClick={() => setUserExpandedOverride(!effectiveLogsExpanded)}
              style={{
                display: 'flex',
                alignItems: 'center',
                cursor: 'pointer',
                userSelect: 'none',
                fontWeight: '500',
                color: 'var(--color-text-muted)',
                gap: '8px',
                marginBottom: '4px'
              }}
            >
              <span style={{ fontSize: '9px', opacity: 0.7 }}>
                {effectiveLogsExpanded ? '▼' : '▶'}
              </span>
              {statusLabel && (
                <span
                  style={{
                    color: statusColor,
                    backgroundColor: `${statusColor}14`,
                    border: `1px solid ${statusColor}2c`,
                    padding: '1px 5px',
                    borderRadius: '3px',
                    fontSize: '9.5px',
                    fontWeight: 'bold'
                  }}
                >
                  {statusLabel}
                </span>
              )}
              <span>{actionSummaryText}</span>
              {actionMetaText && (
                <span style={{ fontSize: '10px', opacity: 0.6 }}>{actionMetaText}</span>
              )}
              {agentStatus === 'running' && (
                <span style={{ fontSize: '10px', opacity: 0.6 }}>• {elapsed}s</span>
              )}
            </div>

            {effectiveLogsExpanded && (
              <div
                className="agent-log-stream"
                style={{
                  flexDirection: 'column',
                  gap: '2px',
                  paddingLeft: '16px'
                }}
              >
                {legacyLogs.reduce<React.ReactNode[]>((acc, log, logIdx) => {
                  if (log.type === 'think') {
                    acc.push(
                      <LogThinkRow
                        key={`think-${log.step}-${logIdx}`}
                        log={log}
                        parentExpanded={effectiveLogsExpanded}
                        isThinking={isGenerating && logIdx === legacyLogs.length - 1}
                      />
                    )
                  } else if (log.type === 'tool') {
                    const resultLog = legacyLogs.find(
                      (l) => l.step === log.step && l.type === 'result' && l.url === log.url
                    )
                    const errorLog = legacyLogs.find(
                      (l) => l.step === log.step && l.type === 'error'
                    )

                    acc.push(
                      <LogStepRow
                        key={`step-${log.step}-${logIdx}`}
                        log={log}
                        resultLog={resultLog}
                        errorLog={errorLog}
                        parentExpanded={effectiveLogsExpanded}
                      />
                    )
                  }
                  return acc
                }, [])}
              </div>
            )}

            {/* Bottom Divider Line */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                color: 'var(--color-text-muted)',
                fontSize: '10px',
                marginTop: '12px',
                opacity: 0.5
              }}
            >
              <div style={{ flex: 1, borderBottom: '1px solid var(--color-border)' }}></div>
              <span style={{ padding: '0 10px', whiteSpace: 'nowrap' }}>
                {agentStatus === 'running'
                  ? 'Tool execution in progress'
                  : agentStatus === 'completed'
                    ? 'Tool execution completed'
                    : agentStatus === 'cancelled'
                      ? 'Tool execution cancelled'
                      : agentStatus === 'failed'
                        ? 'Tool execution failed'
                        : agentStatus === 'max_steps'
                          ? 'Tool execution limit reached'
                          : 'Tool execution finished'}
              </span>
              <div style={{ flex: 1, borderBottom: '1px solid var(--color-border)' }}></div>
            </div>
          </div>
        )}

        {/* 3. Message bubble wrapper */}
        {(cleanContent ||
          (displayReasoning && !hasStructuredEvents) ||
          msg.role === 'user' ||
          (isGenerating && !displayReasoning && !hasLogs) ||
          (hasStructuredEvents && (lastFinalEventIdx !== -1 || isGenerating))) && (
          <div className={`message-bubble ${msg.role}`}>
            {msg.role === 'user' && <div className={`avatar ${msg.role}`}>U</div>}
            <div className="message-content-wrapper" style={{ maxWidth: '100%' }}>
              {!isEditing && isBranchForkMessage && (
                <div className="message-branch-note">
                  <GitBranch size={12} />
                  <span>从历史节点续跑</span>
                  {branchRunId && <span className="message-branch-run">run {branchRunId}</span>}
                </div>
              )}
              {isEditing ? (
                <div className="message-edit-container">
                  <textarea
                    className="message-edit-textarea"
                    value={editingText}
                    onChange={(e) => onChangeEditingText(e.target.value)}
                  />
                  <div className="message-edit-actions">
                    <button className="edit-btn cancel" onClick={onCancelEdit}>
                      取消
                    </button>
                    <button
                      className="edit-btn save"
                      onClick={() => onSaveEdit(msg.id, editingText)}
                    >
                      保存并重发
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="message-text">
                    {msg.files && msg.files.length > 0 && (
                      <div
                        style={{
                          display: 'flex',
                          gap: '6px',
                          flexWrap: 'wrap',
                          marginBottom: '8px'
                        }}
                      >
                        {msg.files.map((f, fileIdx) => (
                          <div
                            key={fileIdx}
                            style={{
                              fontSize: '11px',
                              background: 'rgba(255, 255, 255, 0.08)',
                              padding: '2px 6px',
                              borderRadius: '4px',
                              display: 'flex',
                              alignItems: 'center',
                              gap: '4px'
                            }}
                          >
                            <Paperclip size={10} />
                            <span>{f.name}</span>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Thinking/Reasoning block rendering (DeepSeek R1 style for legacy messages) */}
                    {!hasStructuredEvents && displayReasoning && (
                      <div
                        className="reasoning-block"
                        style={{
                          marginBottom: '10px'
                        }}
                      >
                        <div
                          onClick={() => setIsExpanded(!isExpanded)}
                          style={{
                            fontSize: '12px',
                            color: '#60a5fa',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '6px',
                            userSelect: 'none',
                            marginBottom: '6px',
                            fontWeight: '600'
                          }}
                        >
                          <Sparkles
                            size={11}
                            style={{
                              animation:
                                isGenerating && !cleanContent ? 'spin 3s linear infinite' : 'none'
                            }}
                          />
                          <span>
                            {isGenerating && !cleanContent
                              ? '正在思考中..'
                              : isExpanded
                                ? '思考过程 (收起)'
                                : '思考过程 (展开)'}
                          </span>
                        </div>
                        <div
                          style={{
                            display: isExpanded ? 'block' : 'none',
                            fontSize: '12px',
                            color: 'var(--color-text-muted)',
                            borderLeft: '2px solid rgba(96, 165, 250, 0.35)',
                            paddingLeft: '10px',
                            marginLeft: '4px',
                            fontStyle: 'italic',
                            whiteSpace: 'pre-wrap',
                            lineHeight: '1.6',
                            background: 'var(--color-card-bg)',
                            padding: '6px 10px',
                            borderRadius: '0 6px 6px 0'
                          }}
                        >
                          {displayReasoning}
                        </div>
                      </div>
                    )}

                    {/* Render main text content */}
                    {hasStructuredEvents ? (
                      /* Final answer for structured events */
                      lastFinalEventIdx !== -1 ? (
                        <div className="agent-event-final-text">
                          {renderMessageContent(
                            (
                              msg.agentEvents![lastFinalEventIdx] as Extract<
                                AgentEvent,
                                { type: 'final' }
                              >
                            ).content
                          )}
                        </div>
                      ) : null
                    ) : /* Legacy standard rendering */
                    cleanContent ? (
                      msg.role === 'user' ? (
                        cleanContent
                      ) : (
                        renderMessageContent(cleanContent)
                      )
                    ) : (
                      isGenerating &&
                      displayReasoning && (
                        <span style={{ opacity: 0.5, fontSize: '13px', fontStyle: 'italic' }}>
                          思考完毕，正在生成回答..
                        </span>
                      )
                    )}

                    {/* Show small thinking pulsing dot if we are generating structured events and haven't produced any text blocks yet */}
                    {hasStructuredEvents && isGenerating && lastFinalEventIdx === -1 && (
                      <span style={{ opacity: 0.5, fontSize: '13px', fontStyle: 'italic' }}>
                        正在启动中..
                      </span>
                    )}
                  </div>

                  {branchChildren.length > 0 && (
                    <div className="message-branch-children">
                      <div className="message-branch-children-label">
                        <GitBranch size={12} />
                        <span>派生分支</span>
                      </div>
                      <div className="message-branch-children-list">
                        {branchChildren.map((branch) => (
                          <button
                            key={branch.sessionId}
                            type="button"
                            className="message-branch-link"
                            onClick={() => onOpenBranch(branch.sessionId)}
                            title={`打开分支：${branch.title}`}
                          >
                            <span className="message-branch-link-title">{branch.title}</span>
                            <span className="message-branch-link-meta">
                              {branch.messageCount} msg{branch.messageCount === 1 ? '' : 's'}
                              {branch.shortRunId ? ` · run ${branch.shortRunId}` : ''}
                            </span>
                            <ChevronRight size={12} />
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {msg.role === 'user'
                    ? !isGenerating && (
                        <div className="message-actions" style={{ justifyContent: 'flex-end' }}>
                          <button className="msg-action-btn" onClick={() => onStartEdit(msg)}>
                            <Edit size={10} />
                            <span>编辑</span>
                          </button>
                        </div>
                      )
                    : (!isGenerating ||
                        (hasStructuredEvents &&
                          msg.agentEvents!.some((e) => e.type === 'task_update'))) && (
                        <div className="message-actions" style={{ justifyContent: 'flex-start' }}>
                          {msg.agentRunId && agentStatus === 'failed' && !isGenerating && (
                            <button
                              className="msg-action-btn"
                              onClick={() => onResumeAgentRun(idx)}
                            >
                              <Play size={10} />
                              <span>继续执行</span>
                            </button>
                          )}
                          {!isGenerating && (
                            <button className="msg-action-btn" onClick={() => onRegenerate(idx)}>
                              <RefreshCw size={10} />
                              <span>重新生成</span>
                            </button>
                          )}
                          {(hasStructuredEvents || legacyLogs.length > 0) && (
                            <button
                              className={`msg-action-btn ${
                                activeTaskMessageId === msg.id && isTaskPanelOpen ? 'active' : ''
                              }`}
                              onClick={() => onToggleTasks(msg.id)}
                              title="查看 Agent 执行工具的步骤与分析"
                            >
                              <ListTodo size={10} />
                              <span>
                                {activeTaskMessageId === msg.id && isTaskPanelOpen
                                  ? '关闭分析'
                                  : '运行分析'}
                              </span>
                            </button>
                          )}
                          {!isGenerating && finalReplyText && (
                            <button className="msg-action-btn" onClick={handleCopy}>
                              {copied ? <Check size={10} /> : <Copy size={10} />}
                              <span>{copied ? '已复制' : '复制'}</span>
                            </button>
                          )}
                        </div>
                      )}
                </>
              )}
            </div>
          </div>
        )}
      </div>
    )
  },
  (prevProps, nextProps) => {
    const prevIsEditing = prevProps.editingMessageId === prevProps.msg.id
    const nextIsEditing = nextProps.editingMessageId === nextProps.msg.id
    const prevBranches = prevProps.branchChildren || []
    const nextBranches = nextProps.branchChildren || []

    if (prevIsEditing !== nextIsEditing) return false
    if (nextIsEditing && prevProps.editingText !== nextProps.editingText) return false
    if (prevProps.msg !== nextProps.msg) return false
    if (prevBranches.length !== nextBranches.length) return false
    for (let i = 0; i < prevBranches.length; i += 1) {
      if (
        prevBranches[i].sessionId !== nextBranches[i].sessionId ||
        prevBranches[i].title !== nextBranches[i].title ||
        prevBranches[i].messageCount !== nextBranches[i].messageCount ||
        prevBranches[i].shortRunId !== nextBranches[i].shortRunId
      ) {
        return false
      }
    }
    if (prevProps.isGenerating !== nextProps.isGenerating) return false
    if (prevProps.idx !== nextProps.idx) return false
    if (prevProps.activeTaskMessageId !== nextProps.activeTaskMessageId) return false
    if (prevProps.isTaskPanelOpen !== nextProps.isTaskPanelOpen) return false

    return true
  }
)
