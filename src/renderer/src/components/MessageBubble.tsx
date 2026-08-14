import React, { useEffect, useCallback } from 'react'
import { AgentEvent, Message } from '../../../shared/types'
import { ChevronRight, GitBranch, Loader2 } from 'lucide-react'
import { RuntimeErrorPanel } from './errors/RuntimeErrorPanel'
import { MessageMarkdown, ParsedAgentStep } from '../utils/messageFormat'
import { type BranchChildInfo } from '../utils/branchDisplay'
import { MessageActions } from './message/MessageActions'
import { SubagentRunCard } from './SubagentRunCard'
import { SubagentRunPanel } from './SubagentRunPanel'
import { ToolDetailModal } from './message/ToolDetailModal'
import { useAgentMessageViewModel } from '../features/chat/useAgentMessageViewModel'
import { useSmoothStreamText } from '../hooks/useSmoothStreamText'
import { StepToolEvents } from './message/StepToolEvents'
import { StepProgressMessage } from './message/StepProgressMessage'
import { StepReasoningBlock } from './message/StepReasoningBlock'
import { AgentInlineSummary } from './message/AgentInlineSummary'
import { GenerationStats } from './message/GenerationStats'
import { LegacyReasoningBlock } from './message/LegacyReasoningBlock'
import { MessageFileChips } from './message/MessageFileChips'
import { BranchChildrenList } from './message/BranchChildrenList'
import { MessageEditContainer } from './message/MessageEditContainer'

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
  onCancelQueuedPrompt?: (msg: Message) => void
  isCancellingQueuedPrompt?: boolean
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
    onCancelQueuedPrompt,
    isCancellingQueuedPrompt = false,
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
      cockpitColor,
      latestProgressMessage
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

    const handleOpenToolDetail = useCallback(
      (toolCall: { callId: string }): void => {
        setSelectedToolCallId(toolCall.callId)
      },
      [setSelectedToolCallId]
    )

    const renderAgentStep = (step: ParsedAgentStep): React.ReactNode => (
      <div key={step.id} className={`agent-step-block ${step.status}`}>
        {step.progressMessage && <StepProgressMessage message={step.progressMessage} />}
        <StepReasoningBlock
          reasoning={step.reasoning}
          autoOpen={shouldAutoOpenStepReasoning(step)}
          autoStateKey={reasoningAutoStateKey}
        />
        <StepToolEvents step={step} onOpenToolDetail={handleOpenToolDetail} />
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
        {(hasStructuredEvents ||
          (isGenerating && msg.role === 'assistant' && Boolean(msg.agentRunId))) &&
          (agentStatus !== 'completed' || isGenerating || pendingToolCall) && (
            <AgentInlineSummary
              agentStatus={agentStatus}
              hasPendingToolCall={Boolean(pendingToolCall)}
              cockpitColor={cockpitColor}
              statusText={statusText}
              elapsed={elapsed}
              tasks={tasks}
              opText={opText}
              toolsSummaryText={toolsSummaryText}
            />
          )}

        {/* 3. Message bubble wrapper */}
        {(cleanContent ||
          (displayReasoning && !hasStructuredEvents) ||
          msg.role === 'user' ||
          (isGenerating && !displayReasoning && !hasLogs && !msg.agentRunId) ||
          agentStatus === 'failed' ||
          agentStatus === 'cancelled' ||
          agentStatus === 'safety_stop' ||
          msg.isRuntimeError ||
          ((hasStructuredEvents || parsedRun.steps.length > 0) &&
            (parsedRun.steps.length > 0 ||
              parsedRun.finalReasoning ||
              parsedRun.finalAnswer ||
              subagents.length > 0))) && (
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
                <MessageEditContainer
                  editingText={editingText}
                  onChange={onChangeEditingText}
                  onCancel={onCancelEdit}
                  onSave={() => onSaveEdit(msg.id, editingText)}
                />
              ) : (
                <>
                  <div className="message-text">
                    {msg.files && <MessageFileChips files={msg.files} />}

                    {/* Thinking/Reasoning block rendering (DeepSeek R1 style for legacy messages) */}
                    {!hasStructuredEvents && displayReasoning && (
                      <LegacyReasoningBlock
                        reasoning={displayReasoning}
                        isThinking={isGenerating && !cleanContent}
                        isExpanded={isExpanded}
                        onToggle={() => setIsExpanded(!isExpanded)}
                      />
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
                            <GenerationStats
                              generationDurationText={generationDurationText}
                              tokenSpeed={msg.tokenSpeed}
                              cacheHitRateText={cacheHitRateText}
                            />
                          </div>
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
                          <GenerationStats
                            generationDurationText={generationDurationText}
                            tokenSpeed={msg.tokenSpeed}
                            cacheHitRateText={cacheHitRateText}
                          />
                        </>
                      )
                    ) : isGenerating && msg.role === 'assistant' ? (
                      <span className="agent-startup-indicator">
                        <Loader2 size={13} className="animate-spin" />
                        <span>
                          {displayReasoning
                            ? '思考完毕，正在生成回答...'
                            : latestProgressMessage || '正在连接模型并等待响应...'}
                        </span>
                      </span>
                    ) : null}
                  </div>

                  <BranchChildrenList branchChildren={branchChildren} onOpenBranch={onOpenBranch} />

                  {msg.role === 'user' ? (
                    <MessageActions
                      align="flex-end"
                      canCopy={!!finalReplyText}
                      canEdit={!isGenerating && !msg.isSynthetic && !msg.queuedPrompt}
                      canRegenerate={false}
                      canResume={false}
                      canCancelQueued={!!msg.queuedPrompt && !!onCancelQueuedPrompt}
                      cancellingQueued={isCancellingQueuedPrompt}
                      copied={copied}
                      onCopy={handleCopy}
                      onEdit={() => onStartEdit(msg)}
                      onRegenerate={() => onRegenerate(idx)}
                      onResume={() => onResumeAgentRun(idx)}
                      canRevertFiles={false}
                      canRevertSession={canRevertSession}
                      onRevertSession={() => onRevertSession?.(msg)}
                      onCancelQueued={() => onCancelQueuedPrompt?.(msg)}
                    />
                  ) : (
                    <MessageActions
                      align="flex-start"
                      canEdit={false}
                      canResume={
                        !!msg.agentRunId &&
                        (agentStatus === 'failed' || agentStatus === 'safety_stop') &&
                        !isGenerating
                      }
                      canRegenerate={!isGenerating && !msg.queuedPrompt}
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
    if (Boolean(prevProps.onCancelQueuedPrompt) !== Boolean(nextProps.onCancelQueuedPrompt))
      return false
    if (prevProps.isCancellingQueuedPrompt !== nextProps.isCancellingQueuedPrompt) return false
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
