import React, { useState, useEffect } from 'react'
import { Message, AgentEvent, ToolResultUi } from '../../../shared/types'
import { Edit, RefreshCw, Paperclip, Sparkles } from 'lucide-react'
import {
  parseThinkTags,
  renderMessageContent,
  parseAgentLogs,
  AgentLogStep
} from '../utils/messageFormat'

interface LogStepRowProps {
  log: AgentLogStep
  resultLog?: AgentLogStep
  errorLog?: AgentLogStep
}

const LogStepRow: React.FC<LogStepRowProps> = ({ log, resultLog, errorLog }) => {
  const [isExpanded, setIsExpanded] = useState(false)

  const displayUrl = log.url ? log.url.replace(/^https?:\/\/(www\.)?/, '') : ''
  const truncatedUrl = displayUrl.length > 55 ? displayUrl.substring(0, 55) + '...' : displayUrl

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
      <div
        onClick={() => setIsExpanded(!isExpanded)}
        style={{
          display: 'flex',
          alignItems: 'center',
          cursor: 'pointer',
          userSelect: 'none',
          color: 'var(--color-text-muted)',
          gap: '6px'
        }}
      >
        <span style={{ color: 'var(--color-text-muted)', opacity: 0.9 }}>
          Called {log.toolName} {truncatedUrl && `(${truncatedUrl})`}
        </span>
        <span style={{ fontSize: '8px', opacity: 0.6 }}>{isExpanded ? 'v' : '>'}</span>
        {resultLog ? (
          <span style={{ color: '#10b981', opacity: 0.8, fontSize: '9px', marginLeft: '4px' }}>
            [completed]
          </span>
        ) : errorLog ? (
          <span style={{ color: '#ef4444', opacity: 0.8, fontSize: '9px', marginLeft: '4px' }}>
            [failed]
          </span>
        ) : (
          <span style={{ color: '#eab308', opacity: 0.8, fontSize: '9px', marginLeft: '4px' }}>
            [running]
          </span>
        )}
      </div>

      <div
        style={{
          display: isExpanded ? 'flex' : 'none',
          paddingLeft: '14px',
          fontSize: '9px',
          flexDirection: 'column',
          gap: '2px',
          color: 'var(--color-text-muted)',
          opacity: 0.8
        }}
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

const LogThinkRow: React.FC<{ log: AgentLogStep }> = ({ log }) => {
  const [isExpanded, setIsExpanded] = useState(false)
  const title = log.step > 0 ? `Thought (Step ${log.step}/${log.maxSteps})` : `Thought`

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
      <div
        onClick={() => setIsExpanded(!isExpanded)}
        style={{
          display: 'flex',
          alignItems: 'center',
          cursor: 'pointer',
          userSelect: 'none',
          color: 'var(--color-text-muted)',
          gap: '6px'
        }}
      >
        <span style={{ color: 'var(--color-text-muted)', opacity: 0.9 }}>{title}</span>
        <span style={{ fontSize: '8px', opacity: 0.6 }}>{isExpanded ? 'v' : '>'}</span>
      </div>
      <div
        style={{
          display: isExpanded ? 'block' : 'none',
          paddingLeft: '14px',
          fontSize: '9.5px',
          fontStyle: 'italic',
          color: 'var(--color-text-muted)',
          whiteSpace: 'pre-wrap',
          lineHeight: '1.4',
          opacity: 0.85
        }}
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
}

const EventStepRow: React.FC<EventStepRowProps> = ({
  callId,
  agentRunId,
  toolName,
  args,
  permissionState,
  result,
  error
}) => {
  void callId
  void agentRunId
  const [isExpanded, setIsExpanded] = useState(false)
  const argsObj = args && typeof args === 'object' ? (args as Record<string, unknown>) : null
  const url = typeof argsObj?.url === 'string' ? argsObj.url : ''
  const displayUrl = url ? url.replace(/^https?:\/\/(www\.)?/, '') : ''
  const truncatedUrl = displayUrl.length > 55 ? displayUrl.substring(0, 55) + '...' : displayUrl

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
      <div
        onClick={() => setIsExpanded(!isExpanded)}
        style={{
          display: 'flex',
          alignItems: 'center',
          cursor: 'pointer',
          userSelect: 'none',
          color: 'var(--color-text-muted)',
          gap: '6px'
        }}
      >
        <span style={{ color: 'var(--color-text-muted)', opacity: 0.9 }}>
          Called {toolName} {truncatedUrl && `(${truncatedUrl})`}
        </span>
        <span style={{ fontSize: '8px', opacity: 0.6 }}>{isExpanded ? 'v' : '>'}</span>

        {permissionState === 'pending' ? (
          <span style={{ color: '#eab308', opacity: 0.8, fontSize: '9px', marginLeft: '4px' }}>
            [waiting for permission]
          </span>
        ) : permissionState === 'denied' ? (
          <span style={{ color: '#ef4444', opacity: 0.8, fontSize: '9px', marginLeft: '4px' }}>
            [denied]
          </span>
        ) : error ? (
          <span style={{ color: '#ef4444', opacity: 0.8, fontSize: '9px', marginLeft: '4px' }}>
            [failed]
          </span>
        ) : result ? (
          <span style={{ color: '#10b981', opacity: 0.8, fontSize: '9px', marginLeft: '4px' }}>
            [completed]
          </span>
        ) : (
          <span style={{ color: '#eab308', opacity: 0.8, fontSize: '9px', marginLeft: '4px' }}>
            [running]
          </span>
        )}
      </div>

      <div
        style={{
          display: isExpanded ? 'flex' : 'none',
          paddingLeft: '14px',
          fontSize: '9px',
          flexDirection: 'column',
          gap: '2px',
          color: 'var(--color-text-muted)',
          opacity: 0.8
        }}
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

interface MessageBubbleProps {
  msg: Message
  idx: number
  isGenerating: boolean
  editingMessageId: string | null
  editingText: string
  onStartEdit: (msg: Message) => void
  onCancelEdit: () => void
  onSaveEdit: (msgId: string, text: string) => void
  onRegenerate: (idx: number) => void
  onChangeEditingText: (text: string) => void
}

export const MessageBubble = React.memo<MessageBubbleProps>(
  ({
    msg,
    idx,
    isGenerating,
    editingMessageId,
    editingText,
    onStartEdit,
    onCancelEdit,
    onSaveEdit,
    onRegenerate,
    onChangeEditingText
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
    const isEditing = editingMessageId === msg.id

    const [elapsed, setElapsed] = useState<number>(0)

    const toolCallCount = hasStructuredEvents
      ? msg.agentEvents!.filter((e) => e.type === 'tool_call').length
      : legacyLogs.filter((l) => l.type === 'tool').length

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
    const agentEndEvent = msg.agentEvents?.find(
      (e): e is Extract<AgentEvent, { type: 'agent_end' }> => e.type === 'agent_end'
    )
    // Find the last agent_progress event in the events list
    const lastProgressEvent = msg.agentEvents?.reduce<Extract<AgentEvent, { type: 'agent_progress' }> | null>(
      (last, e) => (e.type === 'agent_progress' ? e : last),
      null
    )

    let agentStatus: 'idle' | 'running' | 'completed' | 'cancelled' | 'failed' | 'max_steps' = 'idle'
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
      statusColor = '#3b82f6' // nice blue
    } else if (agentStatus === 'completed') {
      statusLabel = 'Completed'
      statusColor = '#10b981' // nice green
    } else if (agentStatus === 'cancelled') {
      statusLabel = 'Cancelled'
      statusColor = '#f59e0b' // nice yellow/orange
    } else if (agentStatus === 'failed') {
      statusLabel = 'Failed'
      statusColor = '#ef4444' // nice red
    } else if (agentStatus === 'max_steps') {
      statusLabel = 'Step Limit Reached'
      statusColor = '#f59e0b' // yellow/orange
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

    // Derived logs expansion state
    const effectiveLogsExpanded =
      userExpandedOverride !== null
        ? userExpandedOverride
        : hasStructuredEvents
          ? (isGenerating || !cleanContent)
          : (hasLogs && !cleanContent)

    return (
      <div style={{ display: 'flex', flexDirection: 'column', width: '100%' }}>
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
              <span>
                {`Called tools (${toolCallCount} steps)`}
              </span>
              {agentStatus === 'running' && (
                <span style={{ fontSize: '10px', opacity: 0.6 }}>
                  • {elapsed}s
                </span>
              )}
            </div>

            {/* Intermediate event stream inside the collapsible container */}
            <div
              style={{
                display: effectiveLogsExpanded ? 'flex' : 'none',
                flexDirection: 'column',
                gap: '6px',
                paddingLeft: '16px',
                marginTop: '8px'
              }}
            >
              {msg.agentEvents!.reduce<React.ReactNode[]>((acc, event, eventIdx) => {
                // Skip the last final event (which is the final answer rendered outside)
                if (eventIdx === lastFinalEventIdx) {
                  return acc
                }

                if (event.type === 'final') {
                  acc.push(
                    <div key={`final-${eventIdx}`} className="agent-event-final-text" style={{ margin: '4px 0' }}>
                      {renderMessageContent(event.content)}
                    </div>
                  )
                } else if (event.type === 'reasoning') {
                  acc.push(
                    <div
                      key={`think-${eventIdx}`}
                      style={{
                        margin: '6px 0'
                      }}
                    >
                      <LogThinkRow
                        log={{
                          step: 0,
                          maxSteps: 0,
                          type: 'think',
                          thought: event.content
                        }}
                      />
                    </div>
                  )
                } else if (event.type === 'tool_call') {
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
                        margin: '6px 0'
                      }}
                    >
                      <EventStepRow
                        callId={callId}
                        agentRunId={msg.agentRunId}
                        toolName={event.toolName}
                        args={event.args}
                        permissionState={permState}
                        result={resultEvent?.result}
                        error={errorEvent?.error}
                      />
                    </div>
                  )
                }
                return acc
              }, [])}
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
                marginBottom: '8px'
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
              <span>
                {`Called tools (${toolCallCount} steps)`}
              </span>
              {agentStatus === 'running' && (
                <span style={{ fontSize: '10px', opacity: 0.6 }}>
                  • {elapsed}s
                </span>
              )}
            </div>

            <div
              style={{
                display: effectiveLogsExpanded ? 'flex' : 'none',
                flexDirection: 'column',
                gap: '6px',
                paddingLeft: '16px'
              }}
            >
              {legacyLogs.reduce<React.ReactNode[]>((acc, log, logIdx) => {
                if (log.type === 'think') {
                  acc.push(<LogThinkRow key={`think-${log.step}-${logIdx}`} log={log} />)
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
                    />
                  )
                }
                return acc
              }, [])}
            </div>

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
                    <button className="edit-btn save" onClick={() => onSaveEdit(msg.id, editingText)}>
                      保存并重发
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="message-text">
                    {msg.files && msg.files.length > 0 && (
                      <div
                        style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '8px' }}
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
                            (msg.agentEvents![lastFinalEventIdx] as Extract<AgentEvent, { type: 'final' }>).content
                          )}
                        </div>
                      ) : null
                    ) : (
                      /* Legacy standard rendering */
                      cleanContent
                        ? msg.role === 'user'
                          ? cleanContent
                          : renderMessageContent(cleanContent)
                        : isGenerating &&
                          displayReasoning && (
                            <span style={{ opacity: 0.5, fontSize: '13px', fontStyle: 'italic' }}>
                              思考完毕，正在生成回答..
                            </span>
                          )
                    )}

                    {/* Show small thinking pulsing dot if we are generating structured events and haven't produced any text blocks yet */}
                    {hasStructuredEvents &&
                      isGenerating &&
                      lastFinalEventIdx === -1 && (
                        <span style={{ opacity: 0.5, fontSize: '13px', fontStyle: 'italic' }}>
                          正在启动中..
                        </span>
                      )}
                  </div>

                  {!isGenerating && (
                    <div
                      className="message-actions"
                      style={{ justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start' }}
                    >
                      {msg.role === 'user' ? (
                        <button className="msg-action-btn" onClick={() => onStartEdit(msg)}>
                          <Edit size={10} />
                          <span>编辑</span>
                        </button>
                      ) : (
                        <button className="msg-action-btn" onClick={() => onRegenerate(idx)}>
                          <RefreshCw size={10} />
                          <span>重新生成</span>
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

    if (prevIsEditing !== nextIsEditing) return false
    if (nextIsEditing && prevProps.editingText !== nextProps.editingText) return false
    if (prevProps.msg !== nextProps.msg) return false
    if (prevProps.isGenerating !== nextProps.isGenerating) return false
    if (prevProps.idx !== nextProps.idx) return false

    return true
  }
)
