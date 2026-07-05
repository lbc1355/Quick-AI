/* eslint-disable react/display-name, react/prop-types */
import React, { useState, useEffect, useMemo } from 'react'
import { Message, AgentEvent } from '../../../shared/types'
import {
  Paperclip,
  Sparkles,
  ChevronRight,
  Check,
  AlertCircle,
  GitBranch,
  Loader2,
  RefreshCw
} from 'lucide-react'
import {
  parseThinkTags,
  renderMessageContent,
  parseAgentLogs,
  parseAgentSteps,
  ParsedAgentStep,
  ParsedToolCall
} from '../utils/messageFormat'
import { shortBranchRunId, type BranchChildInfo } from '../utils/branchDisplay'
import { MessageActions } from './message/MessageActions'
import { ToolDetailModal } from './message/ToolDetailModal'
import {
  formatCacheHitRate,
  formatToolArgsSummary,
  formatToolDisplayText
} from './message/toolDisplay'

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

const formatElapsedDuration = (seconds: number): string => {
  const safeSeconds = Math.max(0, Math.round(seconds))
  const mins = Math.floor(safeSeconds / 60)
  const secs = safeSeconds % 60
  if (mins > 0) return `${mins}m${secs > 0 ? ` ${secs}s` : ''}`
  return `${secs}s`
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

interface ErrorAnalysis {
  title: string
  description: string
  suggestion: string[]
}

const analyzeError = (errorText: string): ErrorAnalysis => {
  const lowercaseErr = errorText.toLowerCase()

  if (lowercaseErr.includes('terminated')) {
    return {
      title: '大模型连接超时中断 (Terminated)',
      description:
        '智能体在执行高负荷任务（如编写长游戏代码或进行长链思考）时消耗了过长时间，流式响应的连接中途被服务商或网络代理强行断开了。',
      suggestion: [
        '请在“设置”中尝试切换至更稳定的商业 API 提供商（如官方 DeepSeek 通道）以避开免费额度的连接限制；',
        '尝试采用“分段提问”或“渐进式提示”，每次让 AI 生成一部分，以避免单次请求执行时间过长。'
      ]
    }
  }

  if (lowercaseErr.includes('rate limit') || lowercaseErr.includes('429')) {
    return {
      title: '触发模型接口限流 (Rate Limited)',
      description: '当前请求的频次或模型配额已超过服务商的限制，API 服务商拒绝了本次访问。',
      suggestion: [
        '请稍等几分钟后再重试本次操作；',
        '您可以在“设置”中临时切换至其他备用的大模型服务商。'
      ]
    }
  }

  if (
    lowercaseErr.includes('unauthorized') ||
    lowercaseErr.includes('401') ||
    lowercaseErr.includes('api key') ||
    lowercaseErr.includes('key is invalid')
  ) {
    return {
      title: 'API 密钥验证失败 (Unauthorized)',
      description: '向模型服务商发起接口调用时，对方服务器提示您的 API Key 无效或未授权。',
      suggestion: [
        '请前往“设置”面板，确认您对应提供商 the API Key 填写是否正确；',
        '请检查该 API Key 余额是否充足或是否已被服务商封禁。'
      ]
    }
  }

  if (
    lowercaseErr.includes('dns') ||
    lowercaseErr.includes('fetch failed') ||
    lowercaseErr.includes('connect') ||
    lowercaseErr.includes('network error') ||
    lowercaseErr.includes('enoent')
  ) {
    return {
      title: '网络连接失败',
      description:
        '智能体无法连接至当前模型服务商的 API 终点（Endpoint）。可能是您的代理软件阻止了连接，或者是 API 地址填写错误。',
      suggestion: [
        '请检查您本地的 VPN 或代理软件设置，确保它允许 Electron/Node.js 进程发起外部连接；',
        '请核对“设置”中 API URL 是否拼写正确（包含完整的协议和路径）。'
      ]
    }
  }

  const cleanMsg = errorText.replace(/^出错了：/, '')
  return {
    title: '执行过程中发生异常',
    description: cleanMsg || '智能体运行中遇到了未知错误，导致本次交互异常终止。',
    suggestion: [
      '您可以点击下方的“重试并发送”按钮再次尝试；',
      '如果问题持续发生，请检查控制台运行日志或配置文件。'
    ]
  }
}

const RuntimeErrorPanel: React.FC<{
  content: string
  onRetry: () => void
}> = ({ content, onRetry }) => {
  const analysis = useMemo(() => analyzeError(content), [content])

  return (
    <div className="runtime-error-panel">
      <div className="runtime-error-header">
        <AlertCircle className="runtime-error-icon" size={16} />
        <span className="runtime-error-title">{analysis.title}</span>
      </div>
      <div className="runtime-error-body">
        <div className="runtime-error-description">{analysis.description}</div>
        <div className="runtime-error-suggestion-box">
          <div className="runtime-error-suggestion-title">您可以尝试以下排查建议：</div>
          <ul className="runtime-error-suggestions">
            {analysis.suggestion.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ul>
        </div>
      </div>
      <div className="runtime-error-retry-row">
        <button className="runtime-error-retry-btn" type="button" onClick={onRetry}>
          <RefreshCw size={12} />
          重试并发送
        </button>
      </div>
    </div>
  )
}

const StepToolEvents: React.FC<{
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

const StepProgressMessage: React.FC<{ message: string }> = ({ message }) => {
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

const StepReasoningBlock: React.FC<{
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
  onOpenBranch: (sessionId: string) => void
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
    onOpenBranch,
    onChangeEditingText
  }) => {
    const [isExpanded, setIsExpanded] = useState(true)
    const { content: displayContent, reasoning: displayReasoning } = useMemo(
      () => parseThinkTags(msg.content, msg.reasoning_content),
      [msg.content, msg.reasoning_content]
    )

    // Determine if we use structured agent events or legacy string logs fallback
    const hasStructuredEvents = msg.agentEvents && msg.agentEvents.length > 0
    const cleanContent = useMemo(
      () => (hasStructuredEvents ? displayContent : parseAgentLogs(displayContent).cleanContent),
      [hasStructuredEvents, displayContent]
    )

    const [copied, setCopied] = useState(false)
    const [isStepsExpanded, setIsStepsExpanded] = useState(true)
    const [selectedToolCallId, setSelectedToolCallId] = useState<string | null>(null)
    const isEditing = editingMessageId === msg.id
    const isBranchForkMessage = Boolean(msg.isBranchFork || msg.forkedFrom)
    const branchRunId = shortBranchRunId(msg.forkedFrom?.runId)

    const [elapsed, setElapsed] = useState<number>(() =>
      isGenerating && msg.role === 'assistant'
        ? Math.round((Date.now() - (parseInt(msg.id) || Date.now())) / 1000)
        : 0
    )

    const hasLogs = hasStructuredEvents || (msg.content && msg.content.includes('[tool '))

    useEffect(() => {
      if (isGenerating && msg.role === 'assistant') {
        const startTime = parseInt(msg.id) || Date.now()
        const timer = setInterval(() => {
          setElapsed(Math.round((Date.now() - startTime) / 1000))
        }, 500)
        return () => clearInterval(timer)
      }
      return undefined
    }, [isGenerating, msg.id, msg.role])

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
    }, [selectedToolCallId])

    // Find agent_end event in the events list
    const agentEndEvent = useMemo(
      () =>
        msg.agentEvents?.reduce<Extract<AgentEvent, { type: 'agent_end' }> | null>(
          (last, e) => (e.type === 'agent_end' ? e : last),
          null
        ),
      [msg.agentEvents]
    )
    // Find the last agent_progress event in the events list
    const lastProgressEvent = useMemo(
      () =>
        msg.agentEvents?.reduce<Extract<AgentEvent, { type: 'agent_progress' }> | null>(
          (last, e) => (e.type === 'agent_progress' ? e : last),
          null
        ),
      [msg.agentEvents]
    )
    const latestProgressMessage = lastProgressEvent?.message?.trim() || ''

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

    const parsedRun = useMemo(() => {
      return parseAgentSteps(msg.agentEvents, msg.content)
    }, [msg.agentEvents, msg.content])

    const selectedToolCall = useMemo(() => {
      if (!selectedToolCallId) return null
      for (const step of parsedRun.steps) {
        const match = step.toolCalls.find((toolCall) => toolCall.callId === selectedToolCallId)
        if (match) return match
      }
      return null
    }, [parsedRun.steps, selectedToolCallId])

    // The assistant's final reply text — the last final answer for structured runs, otherwise
    // the cleaned content. This is what the copy button puts on the clipboard.
    const finalReplyText = hasStructuredEvents ? parsedRun.finalAnswer : cleanContent

    // Memoize the rendered markdown/KaTeX output. renderMessageContent runs regex splits and a
    // synchronous katex.renderToString per math span; without memoization it re-runs on every
    // re-render (notably the high-frequency re-renders during streaming).
    const renderedFinalAnswer = useMemo(
      () => (parsedRun.finalAnswer ? renderMessageContent(parsedRun.finalAnswer) : null),
      [parsedRun.finalAnswer]
    )
    const renderedCleanContent = useMemo(
      () => (cleanContent ? renderMessageContent(cleanContent) : null),
      [cleanContent]
    )

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

    const totalToolsCount = parsedRun.totalToolsCount
    const failedToolsCount = parsedRun.failedToolsCount
    const cacheHitRateText = formatCacheHitRate(msg.cacheStats)
    const generationDurationText = elapsed > 0 ? `耗时 ${formatElapsedDuration(elapsed)}` : null

    const activeParsedStep =
      [...parsedRun.steps]
        .reverse()
        .find((step) => step.status === 'running' || step.status === 'failed') ||
      parsedRun.steps[parsedRun.steps.length - 1]
    const latestToolCall: ParsedToolCall | undefined =
      activeParsedStep?.toolCalls.find(
        (tc) => tc.status === 'pending' || tc.status === 'running'
      ) || activeParsedStep?.toolCalls[activeParsedStep.toolCalls.length - 1]

    const latestTaskEvent = msg.agentEvents
      ? [...msg.agentEvents]
          .reverse()
          .find((e): e is Extract<AgentEvent, { type: 'task_update' }> => e.type === 'task_update')
      : undefined
    const tasks = latestTaskEvent?.tasks || []
    const inProgressTaskIdx = tasks.findIndex((t) => t.status === 'in_progress')
    const inProgressTask = inProgressTaskIdx !== -1 ? tasks[inProgressTaskIdx] : undefined

    const pendingToolCall = msg.agentEvents
      ? msg.agentEvents.find(
          (e): e is Extract<AgentEvent, { type: 'tool_call' }> =>
            e.type === 'tool_call' && e.permissionState === 'pending'
        )
      : undefined
    const hasActiveToolCall =
      latestToolCall?.status === 'pending' || latestToolCall?.status === 'running'
    const isGeneratingAnswer =
      agentStatus === 'running' &&
      !pendingToolCall &&
      !hasActiveToolCall &&
      (parsedRun.finalAnswer.trim().length > 0 || totalToolsCount > 0)
    const latestReasoningStep =
      agentStatus === 'running'
        ? [...parsedRun.steps].reverse().find((step) => step.reasoning.trim().length > 0)
        : undefined
    const latestReasoningKey =
      agentStatus === 'running'
        ? parsedRun.finalReasoning.trim().length > 0
          ? 'final'
          : latestReasoningStep?.id
        : undefined
    const reasoningAutoStateKey = `${agentStatus}:${latestReasoningKey || 'none'}`
    const shouldAutoOpenStepReasoning = (step: ParsedAgentStep): boolean => {
      return latestReasoningKey === step.id
    }

    const activeStepTitle = useMemo(() => {
      if (activeParsedStep?.title) return activeParsedStep.title
      if (activeParsedStep) {
        const latestStep = activeParsedStep
        if (latestStep.progressMessage) {
          const firstLine = latestStep.progressMessage
            .trim()
            .split(/[。\n]/)[0]
            .trim()
          const clean = firstLine.replace(/[*#_`[\]]/g, '').trim()
          if (clean.length > 0) {
            return clean.length > 25 ? clean.substring(0, 25) + '...' : clean
          }
        }
        if (latestStep.toolCalls.length > 0) {
          return `执行 ${latestStep.toolCalls[0].toolName}`
        }
      }
      if (inProgressTask) return inProgressTask.title
      return `第 ${currentStep}/${maxSteps} 步`
    }, [activeParsedStep, inProgressTask, currentStep, maxSteps])

    let statusText = ''
    let opText = ''
    let toolsSummaryText = ''
    let cockpitColor = 'var(--color-status-muted)'

    if (pendingToolCall) {
      cockpitColor = 'var(--color-status-pending)'
      statusText = `等待确认 · 正在${activeStepTitle}`
      const argsStr = formatToolArgsSummary(pendingToolCall.toolName, pendingToolCall.args)
      opText =
        pendingToolCall.toolName === 'shell'
          ? `shell 需要授权：${argsStr}`
          : `${pendingToolCall.toolName} 需要授权：${argsStr}`
      toolsSummaryText = `已耗时 ${formatElapsedDuration(elapsed)}${failedToolsCount > 0 ? ` · ${failedToolsCount} 个失败已恢复` : ''}`
    } else if (agentStatus === 'running') {
      cockpitColor = 'var(--color-status-running)'
      statusText = isGeneratingAnswer ? '正在生成回答' : `正在${activeStepTitle}`
      opText = latestProgressMessage
        ? `当前操作：${latestProgressMessage}`
        : isGeneratingAnswer
          ? `当前操作：正在整理结果${totalToolsCount > 0 ? `（已运行 ${totalToolsCount} 个工具）` : ''}`
          : latestToolCall
            ? `当前操作：${latestToolCall.purpose || formatToolDisplayText(latestToolCall.toolName, latestToolCall.args)}`
            : '当前操作：思考分析中...'
      toolsSummaryText = `已耗时 ${formatElapsedDuration(elapsed)}${failedToolsCount > 0 ? ` · ${failedToolsCount} 个失败已恢复` : ''}`
    } else if (agentStatus === 'completed') {
      cockpitColor = 'var(--color-status-success)'
      statusText = '已完成'
      opText = `共运行 ${totalToolsCount} 个工具 · 累计耗时 ${formatElapsedDuration(elapsed)}${failedToolsCount > 0 ? ` · ${failedToolsCount} 个失败已恢复` : ''}`
      toolsSummaryText = ''
    } else if (agentStatus === 'cancelled') {
      cockpitColor = 'var(--color-status-warning)'
      statusText = '已取消'
      opText = `共运行 ${totalToolsCount} 个工具 · 累计耗时 ${formatElapsedDuration(elapsed)}${failedToolsCount > 0 ? ` · ${failedToolsCount} 个失败` : ''}`
    } else if (agentStatus === 'failed' || agentStatus === 'max_steps') {
      cockpitColor = 'var(--color-status-danger)'
      statusText = agentStatus === 'max_steps' ? '步数上限' : '执行失败'
      opText = `共运行 ${totalToolsCount} 个工具 · 累计耗时 ${formatElapsedDuration(elapsed)}${failedToolsCount > 0 ? ` · ${failedToolsCount} 个失败` : ''}`
    } else {
      statusText = '空闲'
      opText = `共运行 ${totalToolsCount} 个工具`
    }

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
                          parsedRun.steps.map((step) => {
                            return (
                              <div key={step.id} className={`agent-step-block ${step.status}`}>
                                {step.progressMessage && (
                                  <StepProgressMessage message={step.progressMessage} />
                                )}
                                <StepReasoningBlock
                                  reasoning={step.reasoning}
                                  autoOpen={shouldAutoOpenStepReasoning(step)}
                                  autoStateKey={reasoningAutoStateKey}
                                />
                                <StepToolEvents
                                  step={step}
                                  onOpenToolDetail={(toolCall) =>
                                    setSelectedToolCallId(toolCall.callId)
                                  }
                                />
                              </div>
                            )
                          })
                        ) : parsedRun.steps.length > 0 ? (
                          <div className="agent-completed-steps-simple-collapsible">
                            <button
                              type="button"
                              className={`agent-steps-simple-toggle ${isStepsExpanded ? 'expanded' : ''}`}
                              onClick={() => setIsStepsExpanded(!isStepsExpanded)}
                            >
                              <span>
                                {formatWorkedDuration(elapsed, parsedRun.steps.length)}
                                {msg.tokenSpeed ? ` · ${msg.tokenSpeed} token/s` : ''}
                              </span>
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
                                {parsedRun.steps.map((step) => {
                                  return (
                                    <div
                                      key={step.id}
                                      className={`agent-step-block ${step.status}`}
                                    >
                                      {step.progressMessage && (
                                        <StepProgressMessage message={step.progressMessage} />
                                      )}
                                      <StepReasoningBlock
                                        reasoning={step.reasoning}
                                        autoOpen={shouldAutoOpenStepReasoning(step)}
                                        autoStateKey={reasoningAutoStateKey}
                                      />
                                      <StepToolEvents
                                        step={step}
                                        onOpenToolDetail={(toolCall) =>
                                          setSelectedToolCallId(toolCall.callId)
                                        }
                                      />
                                    </div>
                                  )
                                })}
                              </div>
                            )}
                          </div>
                        ) : null}

                        {(parsedRun.finalReasoning ||
                          parsedRun.finalAnswer ||
                          msg.isRuntimeError) && (
                          <div className="agent-event-final-text">
                            <StepReasoningBlock
                              reasoning={parsedRun.finalReasoning}
                              autoOpen={latestReasoningKey === 'final'}
                              autoStateKey={reasoningAutoStateKey}
                            />
                            {parsedRun.finalAnswer ? renderedFinalAnswer : null}
                            {msg.isRuntimeError && (
                              <RuntimeErrorPanel
                                content={msg.content}
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
                          content={msg.content}
                          onRetry={() => onRegenerate(idx)}
                        />
                      ) : (
                        <>
                          {renderedCleanContent}
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
                      canEdit={!isGenerating}
                      canRegenerate={false}
                      canResume={false}
                      copied={copied}
                      onCopy={handleCopy}
                      onEdit={() => onStartEdit(msg)}
                      onRegenerate={() => onRegenerate(idx)}
                      onResume={() => onResumeAgentRun(idx)}
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
    return true
  }
)
