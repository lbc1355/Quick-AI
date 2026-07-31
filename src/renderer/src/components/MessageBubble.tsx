import React, { useState, useEffect } from 'react'
import { AgentEvent, Message } from '../../../shared/types'
import {
  Paperclip,
  Sparkles,
  ChevronRight,
  Check,
  AlertCircle,
  GitBranch,
  Loader2
} from 'lucide-react'
import { RuntimeErrorPanel } from './errors/RuntimeErrorPanel'
import {
  MessageMarkdown,
  renderMessageContent,
  ParsedAgentStep,
  ParsedToolCall
} from '../utils/messageFormat'
import { type BranchChildInfo } from '../utils/branchDisplay'
import { MessageActions } from './message/MessageActions'
import { SubagentRunCard } from './SubagentRunCard'
import { SubagentRunPanel } from './SubagentRunPanel'
import { ToolDetailModal } from './message/ToolDetailModal'
import { useAgentMessageViewModel } from '../features/chat/useAgentMessageViewModel'
import { formatToolArgsSummary } from './message/toolDisplay'
import { useSmoothStreamText } from '../hooks/useSmoothStreamText'

const formatWorkedDuration = (seconds: number, stepsCount: number): string => {
  if (seconds > 0) {
    const mins = Math.floor(seconds / 60)
    const secs = seconds % 60
    if (mins > 0) {
      return `Worked for ${mins}m${secs > 0 ? ` ${secs}s` : ''}`
    }
    return `Worked for ${secs}s`
  }
  return `Worked for ${stepsCount} step${stepsCount === 1 ? '' : 's'}`
}

const getToolEventVerb = (toolCall: ParsedToolCall): string => {
  if (toolCall.status === 'failed') return 'Failed'
  if (toolCall.status === 'denied') return 'Denied'
  if (toolCall.status === 'pending') return 'Waiting'
  if (toolCall.status === 'running') return 'Running'

  const name = toolCall.toolName.toLowerCase()
  if (name.includes('search')) return 'Searched'
  if (name.includes('read') || name.includes('fetch') || name.includes('open')) return 'Read'
  if (name.includes('write') || name.includes('edit') || name.includes('patch')) return 'Edited'
  if (name.includes('list')) return 'Listed'
  if (name.includes('shell') || name.includes('command') || name.includes('run')) return 'Ran'
  return 'Used'
}

const getToolChipText = (toolCall: ParsedToolCall): string => {
  return (
    toolCall.purpose || formatToolArgsSummary(toolCall.toolName, toolCall.args) || toolCall.toolName
  )
}

const getToolFailurePreview = (toolCall: ParsedToolCall): string => {
  if (toolCall.status !== 'failed' && toolCall.status !== 'denied') return ''
  const fallback = toolCall.status === 'denied' ? 'Permission denied' : 'Tool failed'
  const text = (toolCall.error || fallback).replace(/\s+/g, ' ').trim()
  return text.length > 120 ? text.substring(0, 117) + '...' : text
}

interface ToolEventGroup {
  id: string
  verb: string
  calls: ParsedToolCall[]
}

const groupConsecutiveToolCalls = (step: ParsedAgentStep): ToolEventGroup[] => {
  const groups: ToolEventGroup[] = []

  step.toolCalls.forEach((toolCall) => {
    const verb = getToolEventVerb(toolCall)
    const latestGroup = groups[groups.length - 1]
    if (
      latestGroup &&
      latestGroup.calls[0].toolName === toolCall.toolName &&
      latestGroup.verb === verb
    ) {
      latestGroup.calls.push(toolCall)
      return
    }

    groups.push({
      id: `${step.id}-${toolCall.callId}-${verb}`,
      verb,
      calls: [toolCall]
    })
  })

  return groups
}

export const StepToolEvents: React.FC<{
  step: ParsedAgentStep
  onOpenToolDetail: (toolCall: ParsedToolCall) => void
}> = ({ step, onOpenToolDetail }) => {
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({})

  if (step.toolCalls.length === 0) return null

  const toolGroups = groupConsecutiveToolCalls(step)

  const toggleGroup = (groupId: string): void => {
    setExpandedGroups((prev) => ({
      ...prev,
      [groupId]: !prev[groupId]
    }))
  }

  const renderToolEvent = (tc: ParsedToolCall, hideName = false): React.ReactNode => {
    const isFocused = tc.status === 'running' || tc.status === 'pending'
    const failurePreview = getToolFailurePreview(tc)
    const hasFailure = Boolean(failurePreview)
    return (
      <button
        key={tc.callId}
        type="button"
        className={`agent-tool-event ${tc.status} ${isFocused ? 'focused' : ''} ${hasFailure ? 'has-failure' : ''}`}
        onClick={() => onOpenToolDetail(tc)}
        title="查看工具详情"
      >
        <span className="agent-tool-event-line">
          {hasFailure && <AlertCircle size={12} className="agent-tool-failure-icon" />}
          {!hideName && <span className="agent-tool-name">{tc.toolName}</span>}
          <span className="agent-tool-chip">{getToolChipText(tc)}</span>
          {tc.result?.readStartLine !== undefined && tc.result?.readEndLine !== undefined && (
            <span className="agent-tool-line-range">{`#L${tc.result.readStartLine}-${tc.result.readEndLine}`}</span>
          )}
          {tc.result?.addedLines !== undefined && (
            <span className="agent-tool-diff-added">{`+${tc.result.addedLines}`}</span>
          )}
          {tc.result?.removedLines !== undefined && (
            <span className="agent-tool-diff-removed">{`-${tc.result.removedLines}`}</span>
          )}
          <span className="agent-tool-verb">{getToolEventVerb(tc)}</span>
        </span>
        {failurePreview && <span className="agent-tool-failure-preview">{failurePreview}</span>}
      </button>
    )
  }

  return (
    <div className="agent-tool-events">
      {toolGroups.map((group) => {
        if (group.calls.length === 1) return renderToolEvent(group.calls[0])

        const isFocused = group.calls.some(
          (tc) => tc.status === 'running' || tc.status === 'pending'
        )
        const hasFailure = group.calls.some(
          (tc) => tc.status === 'failed' || tc.status === 'denied'
        )
        const groupStatus = hasFailure ? 'failed' : isFocused ? 'running' : 'completed'
        const isExpanded = expandedGroups[group.id] ?? isFocused
        const failedCallsCount = group.calls.filter(
          (tc) => tc.status === 'failed' || tc.status === 'denied'
        ).length

        return (
          <div key={group.id} className="agent-tool-group">
            <button
              type="button"
              className={`agent-tool-group-toggle ${groupStatus} ${isFocused ? 'focused' : ''} ${isExpanded ? 'expanded' : ''}`}
              onClick={() => toggleGroup(group.id)}
              title={isExpanded ? 'Collapse tool group' : 'Expand tool group'}
            >
              <ChevronRight size={12} className="agent-tool-group-caret" />
              {hasFailure && <AlertCircle size={12} className="agent-tool-failure-icon" />}
              <span className="agent-tool-name">{group.calls[0].toolName}</span>
              <span className="agent-tool-group-count">{group.calls.length}</span>
              {failedCallsCount > 0 && (
                <span className="agent-tool-group-failure">{failedCallsCount} failed</span>
              )}
              <span className="agent-tool-verb">{group.verb}</span>
            </button>
            {isExpanded && (
              <div className="agent-tool-group-items">
                {group.calls.map((tc) => renderToolEvent(tc, true))}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

const getSystemGeneratedProgressText = (message: string): string | null => {
  const clean = message.trim()
  const match = clean.match(/^准备(?:调用|执行)\s+\d+\s*个工具[：:]\s*(.+?)[。.]?$/)
  if (!match) return null
  return `即将调用工具：${match[1].trim()}`
}

export const StepProgressMessage: React.FC<{ message: string }> = ({ message }) => {
  const systemText = getSystemGeneratedProgressText(message)

  if (systemText) {
    return (
      <div className="agent-step-progress-message system-generated">
        <span className="system-progress-label">系统进度</span>
        <span>{systemText}</span>
      </div>
    )
  }

  return <div className="agent-step-progress-message">{renderMessageContent(message)}</div>
}

export const StepReasoningBlock: React.FC<{
  reasoning: string
  autoOpen?: boolean
  autoStateKey?: string
}> = ({ reasoning, autoOpen = false, autoStateKey }) => {
  const [isOpen, setIsOpen] = useState(autoOpen)

  useEffect(() => {
    setIsOpen(autoOpen)
  }, [autoOpen, autoStateKey])

  if (!reasoning.trim()) return null

  return (
    <details
      className="agent-step-reasoning"
      open={autoOpen || isOpen}
      onToggle={(event) => setIsOpen(event.currentTarget.open)}
    >
      <summary>思考</summary>
      <div className="agent-step-reasoning-content">{reasoning}</div>
    </details>
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
  onRevertAgentFiles?: (msg: Message) => void
  canRevertSession?: boolean
  onRevertSession?: (msg: Message) => void
  onOpenBranch: (sessionId: string) => void
  onOpenSubagent?: (messageId: string, subagentId: string) => void
  onChangeEditingText: (text: string) => void
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
    onRevertAgentFiles,
    canRevertSession = false,
    onRevertSession,
    onOpenBranch,
    onOpenSubagent,
    onChangeEditingText
  }) => {
    const isStreamingAssistant = isGenerating && msg.role === 'assistant' && !msg.isRuntimeError
    const vm = useAgentMessageViewModel({
      msg,
      isGenerating
    })
    const {
      isExpanded,
      setIsExpanded,
      copied,
      isStepsExpanded,
      setIsStepsExpanded,
      selectedToolCallId,
      setSelectedToolCallId,
      elapsed,
      subagents,
      activeSubagent,
      setActiveSubagentId,
      displayReasoning,
      hasStructuredEvents,
      cleanContent,
      branchRunId,
      hasLogs,
      agentEndEvent,
      agentStatus,
      parsedRun,
      selectedToolCall,
      finalReplyText,
      handleCopy,
      cacheHitRateText,
      generationDurationText,
      tasks,
      pendingToolCall,
      latestReasoningKey,
      reasoningAutoStateKey,
      shouldAutoOpenStepReasoning,
      statusText,
      opText,
      toolsSummaryText,
      cockpitColor
    } = vm
    const smoothCleanContent = useSmoothStreamText(
      cleanContent,
      isStreamingAssistant && !hasStructuredEvents
    )
    const smoothFinalAnswer = useSmoothStreamText(
      parsedRun.finalAnswer,
      isStreamingAssistant && (hasStructuredEvents || parsedRun.steps.length > 0)
    )

    const isEditing = editingMessageId === msg.id
    const isBranchForkMessage = Boolean(msg.isBranchFork || msg.forkedFrom)
    const fileChangesEvent = [...(msg.agentEvents || [])]
      .reverse()
      .find(
        (event): event is Extract<AgentEvent, { type: 'file_changes' }> =>
          event.type === 'file_changes' &&
          (!msg.agentRunId || !event.runId || event.runId === msg.agentRunId)
      )

    const renderAgentStep = (step: ParsedAgentStep): React.ReactNode => (
      <div key={step.id} className={`agent-step-block ${step.status}`}>
        {step.progressMessage && <StepProgressMessage message={step.progressMessage} />}
        <StepReasoningBlock
          reasoning={step.reasoning}
          autoOpen={shouldAutoOpenStepReasoning(step)}
          autoStateKey={reasoningAutoStateKey}
        />
        <StepToolEvents
          step={step}
          onOpenToolDetail={(toolCall) => setSelectedToolCallId(toolCall.callId)}
        />
      </div>
    )

    useEffect(() => {
      if (!selectedToolCallId) return undefined

      const handleKeyDown = (event: KeyboardEvent): void => {
        if (event.key !== 'Escape') return
        event.preventDefault()
        event.stopPropagation()
        setSelectedToolCallId(null)
      }

      window.addEventListener('keydown', handleKeyDown, true)
      return () => window.removeEventListener('keydown', handleKeyDown, true)
    }, [selectedToolCallId, setSelectedToolCallId])

    return (
      <div
        className={`message-row-shell ${msg.role}`}
        data-message-id={msg.id}
        data-message-role={msg.role}
      >
        {/* 1. Collapsible logs area for structured events */}
        {hasStructuredEvents &&
          (agentStatus !== 'completed' || isGenerating || pendingToolCall) && (
            <div
              className="agent-inline-summary-box"
              style={{
                borderColor: pendingToolCall ? 'var(--color-status-pending)' : undefined
              }}
            >
              <div className="summary-header">
                <div className="summary-title-wrapper">
                  {agentStatus === 'running' || pendingToolCall ? (
                    <Loader2
                      size={12}
                      className="animate-spin summary-status-icon"
                      style={{ color: cockpitColor }}
                    />
                  ) : agentStatus === 'completed' ? (
                    <Check
                      size={12}
                      className="summary-status-icon"
                      style={{ color: cockpitColor }}
                    />
                  ) : (
                    <AlertCircle
                      size={12}
                      className="summary-status-icon"
                      style={{ color: cockpitColor }}
                    />
                  )}
                  <span className="summary-status-text" style={{ color: cockpitColor }}>
                    {statusText}
                  </span>
                  {agentStatus === 'running' && !pendingToolCall && (
                    <span className="summary-timer">• {elapsed}s</span>
                  )}
                </div>
              </div>

              <div className="summary-body">
                {tasks.length > 0 &&
                  (() => {
                    const totalTasks = tasks.length
                    const completedTasks = tasks.filter((t) => t.status === 'completed').length
                    const inProgressTask = tasks.find((t) => t.status === 'in_progress')

                    let currentTaskIdx = completedTasks + 1
                    let currentTaskTitle = ''

                    if (inProgressTask) {
                      const idx = tasks.findIndex((t) => t.id === inProgressTask.id)
                      if (idx !== -1) {
                        currentTaskIdx = idx + 1
                      }
                      currentTaskTitle = inProgressTask.title
                    } else {
                      const pendingTask = tasks.find((t) => t.status === 'pending')
                      if (pendingTask) {
                        const idx = tasks.findIndex((t) => t.id === pendingTask.id)
                        if (idx !== -1) {
                          currentTaskIdx = idx + 1
                        }
                        currentTaskTitle = pendingTask.title
                      } else {
                        currentTaskIdx = completedTasks
                        currentTaskTitle = tasks[tasks.length - 1]?.title || ''
                      }
                    }

                    return (
                      <div className="summary-task-progress-line">
                        <span className="summary-task-progress-label">任务进度：</span>
                        <span className="summary-task-progress-value">
                          {currentTaskIdx}/{totalTasks} &ldquo;{currentTaskTitle}&rdquo;
                        </span>
                      </div>
                    )
                  })()}
                <div className="summary-current-op" title={opText}>
                  {opText}
                </div>
                {toolsSummaryText && <div className="summary-tools-info">{toolsSummaryText}</div>}
              </div>
            </div>
          )}

        {/* 3. Message bubble wrapper */}
        {(cleanContent ||
          (displayReasoning && !hasStructuredEvents) ||
          msg.role === 'user' ||
          (isGenerating && !displayReasoning && !hasLogs) ||
          agentStatus === 'failed' ||
          agentStatus === 'cancelled' ||
          msg.isRuntimeError ||
          ((hasStructuredEvents || parsedRun.steps.length > 0) &&
            (parsedRun.steps.length > 0 || parsedRun.finalAnswer || isGenerating))) && (
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
                            color: 'var(--color-text-accent)',
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
                            borderLeft:
                              '2px solid color-mix(in srgb, var(--color-primary) 35%, transparent)',
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
                    {hasStructuredEvents || parsedRun.steps.length > 0 ? (
                      <div className="agent-structured-steps-area">
                        {isGenerating ? (
                          parsedRun.steps.map(renderAgentStep)
                        ) : parsedRun.steps.length > 0 ? (
                          <div className="agent-completed-steps-simple-collapsible">
                            <button
                              type="button"
                              className={`agent-steps-simple-toggle ${isStepsExpanded ? 'expanded' : ''}`}
                              onClick={() => setIsStepsExpanded(!isStepsExpanded)}
                            >
                              <span>{formatWorkedDuration(elapsed, parsedRun.steps.length)}</span>
                              <ChevronRight
                                size={12}
                                className="toggle-icon"
                                style={{
                                  transform: isStepsExpanded ? 'rotate(90deg)' : 'none',
                                  transition: 'transform 0.15s ease'
                                }}
                              />
                            </button>
                            {isStepsExpanded && (
                              <div className="agent-steps-simple-collapsed-content">
                                {parsedRun.steps.map(renderAgentStep)}
                              </div>
                            )}
                          </div>
                        ) : null}

                        {subagents.length > 0 && (
                          <div
                            className="agent-subagents-list"
                            style={{
                              display: 'flex',
                              flexDirection: 'column',
                              gap: '6px',
                              margin: '8px 0'
                            }}
                          >
                            {subagents.map((subagent) => (
                              <SubagentRunCard
                                key={subagent.info.subagentId}
                                subagent={subagent}
                                onClick={() => {
                                  if (onOpenSubagent) {
                                    onOpenSubagent(msg.id, subagent.info.subagentId)
                                    return
                                  }
                                  setActiveSubagentId(subagent.info.subagentId)
                                }}
                              />
                            ))}
                          </div>
                        )}

                        {(parsedRun.finalReasoning ||
                          parsedRun.finalAnswer ||
                          msg.isRuntimeError ||
                          agentEndEvent?.error) && (
                          <div className="agent-event-final-text">
                            <StepReasoningBlock
                              reasoning={parsedRun.finalReasoning}
                              autoOpen={latestReasoningKey === 'final'}
                              autoStateKey={reasoningAutoStateKey}
                            />
                            {parsedRun.finalAnswer ? (
                              <MessageMarkdown
                                text={smoothFinalAnswer}
                                streaming={isStreamingAssistant}
                              />
                            ) : null}
                            {msg.isRuntimeError && (
                              <RuntimeErrorPanel
                                error={msg.errorPayload || msg.content}
                                onRetry={() => onRegenerate(idx)}
                              />
                            )}
                            {!msg.isRuntimeError && agentEndEvent?.error && (
                              <RuntimeErrorPanel
                                error={agentEndEvent.error}
                                onRetry={() => onRegenerate(idx)}
                              />
                            )}
                            {(generationDurationText ||
                              msg.tokenSpeed !== undefined ||
                              cacheHitRateText) && (
                              <div
                                className="msg-generation-stats"
                                style={{
                                  fontSize: '11px',
                                  color: 'var(--color-text-muted)',
                                  marginTop: '8px',
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: '4px',
                                  opacity: 0.7
                                }}
                              >
                                <Sparkles
                                  size={10}
                                  style={{ color: 'var(--color-status-success)' }}
                                />
                                {generationDurationText && <span>{generationDurationText}</span>}
                                {msg.tokenSpeed !== undefined && (
                                  <>
                                    {generationDurationText && <span>·</span>}
                                    <span>{msg.tokenSpeed} token/s</span>
                                  </>
                                )}
                                {cacheHitRateText && (
                                  <>
                                    {(generationDurationText || msg.tokenSpeed !== undefined) && (
                                      <span>·</span>
                                    )}
                                    <span>{cacheHitRateText}</span>
                                  </>
                                )}
                              </div>
                            )}
                          </div>
                        )}
                        {isGenerating && parsedRun.steps.length === 0 && !parsedRun.finalAnswer && (
                          <span style={{ opacity: 0.5, fontSize: '13px', fontStyle: 'italic' }}>
                            正在启动中..
                          </span>
                        )}
                      </div>
                    ) : /* Legacy standard rendering */
                    cleanContent ? (
                      msg.role === 'user' ? (
                        cleanContent
                      ) : msg.isRuntimeError ? (
                        <RuntimeErrorPanel
                          error={msg.errorPayload || msg.content}
                          onRetry={() => onRegenerate(idx)}
                        />
                      ) : (
                        <>
                          <MessageMarkdown
                            text={smoothCleanContent}
                            streaming={isStreamingAssistant}
                          />
                          {(generationDurationText ||
                            msg.tokenSpeed !== undefined ||
                            cacheHitRateText) && (
                            <div
                              className="msg-generation-stats"
                              style={{
                                fontSize: '11px',
                                color: 'var(--color-text-muted)',
                                marginTop: '8px',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '4px',
                                opacity: 0.7
                              }}
                            >
                              <Sparkles
                                size={10}
                                style={{ color: 'var(--color-status-success)' }}
                              />
                              {generationDurationText && <span>{generationDurationText}</span>}
                              {msg.tokenSpeed !== undefined && (
                                <>
                                  {generationDurationText && <span>·</span>}
                                  <span>{msg.tokenSpeed} token/s</span>
                                </>
                              )}
                              {cacheHitRateText && (
                                <>
                                  {(generationDurationText || msg.tokenSpeed !== undefined) && (
                                    <span>·</span>
                                  )}
                                  <span>{cacheHitRateText}</span>
                                </>
                              )}
                            </div>
                          )}
                        </>
                      )
                    ) : (
                      isGenerating &&
                      displayReasoning && (
                        <span style={{ opacity: 0.5, fontSize: '13px', fontStyle: 'italic' }}>
                          思考完毕，正在生成回答..
                        </span>
                      )
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

                  {msg.role === 'user' ? (
                    <MessageActions
                      align="flex-end"
                      canEdit={!isGenerating && !msg.isSynthetic}
                      canRegenerate={false}
                      canResume={false}
                      copied={copied}
                      onCopy={handleCopy}
                      onEdit={() => onStartEdit(msg)}
                      onRegenerate={() => onRegenerate(idx)}
                      onResume={() => onResumeAgentRun(idx)}
                      canRevertFiles={false}
                      canRevertSession={canRevertSession}
                      onRevertSession={() => onRevertSession?.(msg)}
                    />
                  ) : (
                    <MessageActions
                      align="flex-start"
                      canEdit={false}
                      canResume={!!msg.agentRunId && agentStatus === 'failed' && !isGenerating}
                      canRegenerate={!isGenerating}
                      canCopy={!isGenerating && !!finalReplyText}
                      copied={copied}
                      onCopy={handleCopy}
                      onEdit={() => onStartEdit(msg)}
                      onRegenerate={() => onRegenerate(idx)}
                      onResume={() => onResumeAgentRun(idx)}
                      canRevertFiles={
                        !!onRevertAgentFiles &&
                        !!msg.agentRunId &&
                        !!fileChangesEvent?.files.length &&
                        !isGenerating
                      }
                      filesReverted={!!fileChangesEvent?.revertedAt}
                      onRevertFiles={() => onRevertAgentFiles?.(msg)}
                      canRevertSession={canRevertSession}
                      onRevertSession={() => onRevertSession?.(msg)}
                    />
                  )}
                </>
              )}
            </div>
          </div>
        )}
        {selectedToolCall && (
          <ToolDetailModal
            toolCall={selectedToolCall}
            onClose={() => setSelectedToolCallId(null)}
          />
        )}
        {activeSubagent && !onOpenSubagent && (
          <SubagentRunPanel subagent={activeSubagent} onClose={() => setActiveSubagentId(null)} />
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
    if (Boolean(prevProps.onOpenSubagent) !== Boolean(nextProps.onOpenSubagent)) return false
    if (Boolean(prevProps.onRevertAgentFiles) !== Boolean(nextProps.onRevertAgentFiles))
      return false
    if (prevProps.canRevertSession !== nextProps.canRevertSession) return false
    if (Boolean(prevProps.onRevertSession) !== Boolean(nextProps.onRevertSession)) return false
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
    return true
  }
)

MessageBubble.displayName = 'MessageBubble'
