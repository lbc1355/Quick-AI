import React, { useState, useMemo } from 'react'
import { X } from 'lucide-react'
import { AgentEvent, Message } from '../../../shared/types'
import {
  MessageMarkdown,
  parseAgentSteps,
  ParsedToolCall,
  ParsedAgentStep
} from '../utils/messageFormat'
import { StepProgressMessage, StepReasoningBlock, StepToolEvents } from './MessageBubble'
import { SubagentRunState } from './SubagentRunCard'
import { ToolDetailModal } from './message/ToolDetailModal'
import { useSmoothStreamText } from '../hooks/useSmoothStreamText'

const SubagentStepBlock = React.memo<{
  step: ParsedAgentStep
  onOpenToolDetail: (toolCallId: string) => void
}>(
  ({ step, onOpenToolDetail }) => {
    return (
      <div className={`agent-step-block ${step.status}`}>
        {step.progressMessage && <StepProgressMessage message={step.progressMessage} />}
        <StepReasoningBlock reasoning={step.reasoning} autoOpen={true} />
        <StepToolEvents
          step={step}
          onOpenToolDetail={(toolCall) => onOpenToolDetail(toolCall.callId)}
        />
      </div>
    )
  },
  (prev, next) => {
    return (
      prev.step.status === next.step.status &&
      prev.step.reasoning === next.step.reasoning &&
      prev.step.progressMessage === next.step.progressMessage &&
      prev.step.toolCalls === next.step.toolCalls
    )
  }
)
SubagentStepBlock.displayName = 'SubagentStepBlock'

interface SubagentRunPanelProps {
  subagent: SubagentRunState
  onClose: () => void
}

const getShortTaskTitle = (task: string): string => {
  const clean = task.trim().replace(/\s+/g, ' ')
  const firstSentence = clean.split(/[。！？.!?\n]/)[0]
  if (firstSentence && firstSentence.length > 5 && firstSentence.length <= 40) {
    return firstSentence
  }
  if (clean.length <= 40) return clean
  return `${clean.substring(0, 40)}...`
}

export const SubagentRunPanel: React.FC<SubagentRunPanelProps> = ({ subagent, onClose }) => {
  const [selectedToolCallId, setSelectedToolCallId] = useState<string | null>(null)
  const isStreaming = subagent.status === 'running'

  const virtualMessage = useMemo((): Message => {
    return {
      id: subagent.info.subagentId,
      role: 'assistant',
      content: subagent.finalAnswer || '',
      agentEvents: subagent.events as AgentEvent[]
    }
  }, [subagent])

  const parsedRun = useMemo(() => {
    return parseAgentSteps(virtualMessage.agentEvents, virtualMessage.content)
  }, [virtualMessage])

  const selectedToolCall = useMemo((): ParsedToolCall | null => {
    if (!selectedToolCallId) return null
    for (const step of parsedRun.steps) {
      const match = step.toolCalls.find((toolCall) => toolCall.callId === selectedToolCallId)
      if (match) return match
    }
    return null
  }, [parsedRun.steps, selectedToolCallId])

  const smoothFinalAnswer = useSmoothStreamText(parsedRun.finalAnswer, isStreaming)

  return (
    <div
      className="subagent-route-panel"
      style={{
        position: 'relative',
        flex: '1 1 auto',
        minHeight: 0,
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--color-panel)',
        color: 'var(--color-text)',
        animation: 'fadeIn 0.2s ease-out'
      }}
    >
      {/* Floating Close Button */}
      <button
        type="button"
        onClick={onClose}
        style={{
          position: 'absolute',
          top: '14px',
          right: '18px',
          background: 'var(--color-bg-header)',
          border: '1px solid var(--color-border)',
          color: 'var(--color-text-muted)',
          cursor: 'pointer',
          padding: '6px',
          borderRadius: '50%',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          boxShadow: '0 2px 6px rgba(0, 0, 0, 0.1)',
          transition: 'all 0.15s ease',
          zIndex: 4
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.color = 'var(--color-text)'
          e.currentTarget.style.borderColor = 'var(--color-primary)'
          e.currentTarget.style.background = 'var(--color-card-bg-hover)'
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.color = 'var(--color-text-muted)'
          e.currentTarget.style.borderColor = 'var(--color-border)'
          e.currentTarget.style.background = 'var(--color-bg-header)'
        }}
        title="关闭"
      >
        <X size={18} />
      </button>

      {/* Main Details Area */}
      <div
        style={{
          flex: '1 1 auto',
          overflowY: 'auto',
          padding: '24px 16px 80px',
          maxWidth: '800px',
          width: '100%',
          margin: '0 auto',
          display: 'flex',
          flexDirection: 'column',
          gap: '16px',
          WebkitOverflowScrolling: 'touch',
          willChange: 'transform',
          transform: 'translateZ(0)'
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span
              style={{
                fontFamily: 'Consolas, monospace',
                fontSize: '11px',
                background: 'color-mix(in srgb, var(--color-primary) 10%, transparent)',
                color: 'var(--color-primary)',
                padding: '2px 6px',
                borderRadius: '4px',
                fontWeight: 600
              }}
            >
              {subagent.info.label} Agent
            </span>
            <span style={{ fontSize: '11px', color: 'var(--color-text-muted)' }}>
              最大迭代步数: {subagent.info.maxSteps} 步
            </span>
          </div>
          <h2 style={{ fontSize: '16px', fontWeight: 600, margin: '4px 0 12px' }}>
            {getShortTaskTitle(subagent.info.task)}
          </h2>
        </div>

        {subagent.info.task.length > getShortTaskTitle(subagent.info.task).length && (
          <div
            style={{
              padding: '12px 16px',
              background: 'var(--color-card-bg)',
              borderLeft: '4px solid var(--color-primary)',
              borderRadius: '0 6px 6px 0',
              fontSize: '13px',
              color: 'var(--color-text-muted)',
              lineHeight: '1.6',
              marginBottom: '4px',
              flex: '0 0 auto'
            }}
          >
            <div
              style={{
                fontSize: '11px',
                fontWeight: 600,
                color: 'var(--color-text)',
                marginBottom: '4px',
                textTransform: 'uppercase',
                letterSpacing: '0.05em'
              }}
            >
              完整任务描述
            </div>
            {subagent.info.task}
          </div>
        )}

        {/* Timeline / Tool steps */}
        <div className="agent-structured-steps-area" style={{ flex: '0 0 auto' }}>
          {parsedRun.steps.map((step) => (
            <SubagentStepBlock key={step.id} step={step} onOpenToolDetail={setSelectedToolCallId} />
          ))}
        </div>

        {/* Final output reasoning & answer */}
        {(parsedRun.finalReasoning || parsedRun.finalAnswer || subagent.error) && (
          <div className="agent-event-final-text" style={{ flex: '0 0 auto', marginTop: '8px' }}>
            <StepReasoningBlock reasoning={parsedRun.finalReasoning} autoOpen={true} />
            {parsedRun.finalAnswer ? (
              <div className="message-text subagent-final-answer">
                <MessageMarkdown
                  text={isStreaming ? smoothFinalAnswer : parsedRun.finalAnswer}
                  streaming={isStreaming}
                />
              </div>
            ) : null}

            {subagent.error && (
              <div
                style={{
                  padding: '12px',
                  background: 'color-mix(in srgb, var(--color-danger) 8%, transparent)',
                  border: '1px solid color-mix(in srgb, var(--color-danger) 20%, transparent)',
                  borderRadius: '6px',
                  color: 'var(--color-danger)',
                  fontSize: '13px',
                  fontFamily: 'Consolas, monospace',
                  marginTop: '10px',
                  whiteSpace: 'pre-wrap'
                }}
              >
                <strong>Execution Error:</strong>
                <div style={{ marginTop: '4px' }}>{subagent.error}</div>
              </div>
            )}
          </div>
        )}

        {/* Statistics Footer Banner */}
        <div
          style={{
            marginTop: '24px',
            paddingTop: '16px',
            borderTop: '1px solid var(--color-border)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: '12px',
            fontSize: '12px',
            color: 'var(--color-text-muted)',
            flex: '0 0 auto'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
            <span>
              迭代步数:{' '}
              <strong style={{ color: 'var(--color-text)' }}>{parsedRun.steps.length}</strong> /{' '}
              {subagent.info.maxSteps}
            </span>
            {parsedRun.totalToolsCount > 0 && (
              <span>
                工具调用:{' '}
                <strong style={{ color: 'var(--color-text)' }}>{parsedRun.totalToolsCount}</strong>{' '}
                次
                {parsedRun.failedToolsCount > 0 && (
                  <span style={{ color: 'var(--color-danger)', marginLeft: '4px' }}>
                    ({parsedRun.failedToolsCount} 次失败)
                  </span>
                )}
              </span>
            )}
            {subagent.durationMs !== undefined && (
              <span>
                执行耗时:{' '}
                <strong style={{ color: 'var(--color-text)' }}>
                  {(subagent.durationMs / 1000).toFixed(2)}s
                </strong>
              </span>
            )}
          </div>
          <div>
            运行状态:{' '}
            <span
              style={{
                color:
                  subagent.status === 'completed'
                    ? 'var(--color-success)'
                    : subagent.status === 'running'
                      ? 'var(--color-primary)'
                      : subagent.status === 'cancelled'
                        ? 'var(--color-text-muted)'
                        : 'var(--color-danger)',
                fontWeight: 600
              }}
            >
              {subagent.status === 'running'
                ? '运行中'
                : subagent.status === 'completed'
                  ? '已完成'
                  : subagent.status === 'cancelled'
                    ? '已取消'
                    : subagent.status === 'max_steps'
                      ? '步数超限'
                      : '失败'}
            </span>
          </div>
        </div>
      </div>

      {/* Tool details overlay modal */}
      {selectedToolCall && (
        <ToolDetailModal toolCall={selectedToolCall} onClose={() => setSelectedToolCallId(null)} />
      )}
    </div>
  )
}
