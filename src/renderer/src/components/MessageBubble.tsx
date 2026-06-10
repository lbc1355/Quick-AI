/* eslint-disable react/display-name, react/prop-types */
import React, { useState, useEffect } from 'react'
import { Message, AgentEvent, ToolResultUi } from '../../../shared/types'
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
  ListTodo
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

const LogThinkRow: React.FC<{ log: AgentLogStep; parentExpanded: boolean }> = ({
  log,
  parentExpanded
}) => {
  const [isExpanded, setIsExpanded] = useState(false)
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

interface EventStepRowProps {
  callId: string
  agentRunId?: string
  toolName: string
  args: unknown
  permissionState?: 'pending' | 'approved' | 'denied'
  result?: ToolResultUi
  error?: string
  parentExpanded: boolean
}

interface EventToolCallItem {
  event: Extract<AgentEvent, { type: 'tool_call' }>
  result?: ToolResultUi
  error?: string
}

const EventStepRow: React.FC<EventStepRowProps> = ({
  callId,
  agentRunId,
  toolName,
  args,
  permissionState,
  result,
  error,
  parentExpanded
}) => {
  void callId
  void agentRunId
  const [isExpanded, setIsExpanded] = useState(false)

  const argsObj = args && typeof args === 'object' ? (args as Record<string, unknown>) : null
  const url = typeof argsObj?.url === 'string' ? argsObj.url : ''
  const displayUrl = url ? url.replace(/^https?:\/\/(www\.)?/, '') : ''
  const truncatedUrl = displayUrl.length > 55 ? displayUrl.substring(0, 55) + '...' : displayUrl
  const statusText =
    permissionState === 'pending'
      ? 'Waiting for'
      : permissionState === 'denied'
        ? 'Denied'
        : error
          ? 'Failed'
          : result
            ? 'Ran'
            : 'Running'
  const statusClass =
    permissionState === 'pending'
      ? 'waiting'
      : permissionState === 'denied' || error
        ? 'failed'
        : result
          ? 'done'
          : 'running'

  return (
    <div className="agent-flow-step">
      <button
        type="button"
        className={`agent-flow-row ${statusClass}`}
        onClick={() => setIsExpanded(!isExpanded)}
      >
        {statusClass === 'failed' ? <AlertCircle size={13} /> : <SquareTerminal size={13} />}
        <span className="agent-flow-label">
          {statusText} {toolName}
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
        {url && (
          <div style={{ wordBreak: 'break-all' }}>
            URL:{' '}
            <a
              href={url}
              target="_blank"
              rel="noreferrer"
              style={{ color: 'var(--color-primary)', textDecoration: 'none' }}
            >
              {url}
            </a>
          </div>
        )}
        {argsObj &&
          Object.keys(argsObj)
            .filter((k) => k !== 'url')
            .map((key) => (
              <div key={key}>
                {key}: {JSON.stringify(argsObj[key])}
              </div>
            ))}
        {result && (
          <>
            {result.title && (
              <div style={{ textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>
                Title: {result.title}
              </div>
            )}
            {result.summary && (
              <div style={{ fontStyle: 'italic', opacity: 0.9 }}>Summary: {result.summary}</div>
            )}
            {result.items && result.items.length > 0 && (
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '6px',
                  marginTop: '6px',
                  borderTop: '1px dashed var(--color-border)',
                  paddingTop: '6px'
                }}
              >
                {result.items.map((item, itemIdx) => (
                  <div
                    key={itemIdx}
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '2px',
                      paddingBottom: itemIdx < result.items!.length - 1 ? '4px' : '0',
                      borderBottom:
                        itemIdx < result.items!.length - 1
                          ? '1px solid rgba(255, 255, 255, 0.03)'
                          : 'none'
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px',
                        flexWrap: 'wrap'
                      }}
                    >
                      <span style={{ fontWeight: 600, color: 'var(--color-primary)' }}>
                        [{itemIdx + 1}]
                      </span>
                      <a
                        href={item.url}
                        target="_blank"
                        rel="noreferrer"
                        style={{
                          color: 'var(--color-text-title)',
                          textDecoration: 'none',
                          fontWeight: 500
                        }}
                      >
                        {item.title}
                      </a>
                      {item.source && (
                        <span
                          style={{
                            fontSize: '9px',
                            background: 'rgba(255, 255, 255, 0.06)',
                            padding: '0px 4px',
                            borderRadius: '3px',
                            color: 'var(--color-text-muted)'
                          }}
                        >
                          {item.source}
                        </span>
                      )}
                    </div>
                    {item.snippet && (
                      <div
                        style={{
                          fontSize: '9px',
                          color: 'var(--color-text-muted)',
                          paddingLeft: '14px',
                          lineHeight: '1.3',
                          whiteSpace: 'normal',
                          wordBreak: 'break-word'
                        }}
                      >
                        {item.snippet}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </>
        )}
        {error && <div style={{ color: '#f87171' }}>Error: {error}</div>}
      </div>
    </div>
  )
}

const EventToolGroup: React.FC<{
  toolName: string
  calls: EventToolCallItem[]
  agentRunId?: string
  parentExpanded: boolean
}> = ({ toolName, calls, agentRunId, parentExpanded }) => {
  const [isExpanded, setIsExpanded] = useState(false)
  const hasError = calls.some((call) => call.error || call.event.permissionState === 'denied')
  const hasPending = calls.some((call) => call.event.permissionState === 'pending')
  const hasRunning = calls.some(
    (call) => !call.result && !call.error && call.event.permissionState !== 'denied'
  )
  const statusClass = hasError ? 'failed' : hasPending || hasRunning ? 'running' : 'done'
  const statusText = hasError
    ? 'Failed'
    : hasPending
      ? 'Waiting for'
      : hasRunning
        ? 'Running'
        : 'Ran'

  return (
    <div className="agent-flow-step agent-flow-group">
      <button
        type="button"
        className={`agent-flow-row ${statusClass}`}
        onClick={() => setIsExpanded(!isExpanded)}
      >
        {statusClass === 'failed' ? <AlertCircle size={13} /> : <SquareTerminal size={13} />}
        <span className="agent-flow-label">
          {statusText} {toolName}
        </span>
        <span className="agent-flow-meta">{calls.length} calls</span>
        <span className="agent-flow-toggle">
          {isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </span>
      </button>

      {parentExpanded && isExpanded && (
        <div className="agent-flow-group-children">
          {calls.map((call, callIndex) => (
            <EventStepRow
              key={`${call.event.callId}-${callIndex}`}
              callId={call.event.callId}
              agentRunId={agentRunId}
              toolName={call.event.toolName}
              args={call.event.args}
              permissionState={call.event.permissionState}
              result={call.result}
              error={call.error}
              parentExpanded={parentExpanded && isExpanded}
            />
          ))}
        </div>
      )}
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

    // Derived logs expansion state. Long tool streams default to compact mode to avoid flooding
    // the conversation while generation is still running.
    const shouldCompactLogs = toolCallCount > 3
    const defaultLogsExpanded = hasStructuredEvents
      ? isGenerating && !cleanContent && !shouldCompactLogs
      : hasLogs && !cleanContent && !shouldCompactLogs
    const effectiveLogsExpanded =
      userExpandedOverride !== null ? userExpandedOverride : defaultLogsExpanded
    const actionSummaryText =
      toolCallCount > 0
        ? `${agentStatus === 'running' ? '正在运行' : '已运行'} ${toolCallCount} 条命令`
        : `${agentStatus === 'running' ? '正在处理' : '已处理'} ${thoughtCount} 条动作`
    const actionMetaText =
      thoughtCount > 0 && toolCallCount > 0 ? `含 ${thoughtCount} 条思考` : undefined

    return (
      <div className={`message-row-shell ${msg.role}`} data-message-id={msg.id}>
        {/* 1. Collapsible logs area for structured events */}
        {hasStructuredEvents && (
          <div
            className="agent-logs-container-fullwidth"
            style={{
              margin: '12px 0 8px 0',
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
                gap: '8px'
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

            {/* Intermediate event stream inside the collapsible container */}
            {effectiveLogsExpanded && (
              <div
                className="agent-log-stream"
                style={{
                  flexDirection: 'column',
                  gap: '2px',
                  paddingLeft: '16px',
                  marginTop: '4px'
                }}
              >
                {msg.agentEvents!.reduce<React.ReactNode[]>((acc, event, eventIdx) => {
                  // Skip the last final event (which is the final answer rendered outside)
                  if (eventIdx === lastFinalEventIdx) {
                    return acc
                  }

                  if (event.type === 'final') {
                    acc.push(
                      <div
                        key={`final-${eventIdx}`}
                        className="agent-event-final-text"
                        style={{ margin: '4px 0' }}
                      >
                        {renderMessageContent(event.content)}
                      </div>
                    )
                  } else if (event.type === 'reasoning') {
                    acc.push(
                      <div
                        key={`think-${eventIdx}`}
                        style={{
                          margin: '2px 0'
                        }}
                      >
                        <LogThinkRow
                          log={{
                            step: 0,
                            maxSteps: 0,
                            type: 'think',
                            thought: event.content
                          }}
                          parentExpanded={effectiveLogsExpanded}
                        />
                      </div>
                    )
                  } else if (event.type === 'tool_call') {
                    const isToolGroupBoundary = (candidate: AgentEvent): boolean =>
                      candidate.type === 'reasoning' ||
                      candidate.type === 'final' ||
                      candidate.type === 'agent_start' ||
                      candidate.type === 'agent_end'

                    for (let i = eventIdx - 1; i >= 0; i -= 1) {
                      const previousEvent = msg.agentEvents![i]
                      if (previousEvent.type === 'tool_call') {
                        if (previousEvent.toolName === event.toolName) return acc
                        break
                      }
                      if (isToolGroupBoundary(previousEvent)) break
                    }

                    const groupedCalls: EventToolCallItem[] = []
                    for (let i = eventIdx; i < msg.agentEvents!.length; i += 1) {
                      const candidate = msg.agentEvents![i]
                      if (candidate.type === 'tool_call') {
                        if (candidate.toolName !== event.toolName) break
                        const resultEvent = msg.agentEvents!.find(
                          (e): e is Extract<AgentEvent, { type: 'tool_result' }> =>
                            e.type === 'tool_result' && e.callId === candidate.callId
                        )
                        const errorEvent = msg.agentEvents!.find(
                          (e): e is Extract<AgentEvent, { type: 'tool_error' }> =>
                            e.type === 'tool_error' && e.callId === candidate.callId
                        )
                        groupedCalls.push({
                          event: candidate,
                          result: resultEvent?.result,
                          error: errorEvent?.error
                        })
                        continue
                      }
                      if (isToolGroupBoundary(candidate)) break
                    }

                    const callId = event.callId
                    const resultEvent = msg.agentEvents!.find(
                      (e): e is Extract<AgentEvent, { type: 'tool_result' }> =>
                        e.type === 'tool_result' && e.callId === callId
                    )
                    const errorEvent = msg.agentEvents!.find(
                      (e): e is Extract<AgentEvent, { type: 'tool_error' }> =>
                        e.type === 'tool_error' && e.callId === callId
                    )
                    const permState = event.permissionState

                    acc.push(
                      <div
                        key={`step-${callId}-${eventIdx}`}
                        style={{
                          margin: '2px 0'
                        }}
                      >
                        {groupedCalls.length > 1 ? (
                          <EventToolGroup
                            toolName={event.toolName}
                            calls={groupedCalls}
                            agentRunId={msg.agentRunId}
                            parentExpanded={effectiveLogsExpanded}
                          />
                        ) : (
                          <EventStepRow
                            callId={callId}
                            agentRunId={msg.agentRunId}
                            toolName={event.toolName}
                            args={event.args}
                            permissionState={permState}
                            result={resultEvent?.result}
                            error={errorEvent?.error}
                            parentExpanded={effectiveLogsExpanded}
                          />
                        )}
                      </div>
                    )
                  }
                  return acc
                }, [])}
              </div>
            )}
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
