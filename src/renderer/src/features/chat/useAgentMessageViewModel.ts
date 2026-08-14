import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import type { Message, AgentEvent, SubagentInnerEvent } from '../../../../shared/types'
import {
  parseThinkTags,
  parseAgentLogs,
  parseAgentSteps,
  ParsedAgentStep,
  ParsedToolCall
} from '../../utils/messageFormat'
import { shortBranchRunId } from '../../utils/branchDisplay'
import {
  formatCacheHitRate,
  formatToolArgsSummary,
  formatToolDisplayText
} from '../../components/message/toolDisplay'

export interface SubagentRunState {
  info: Extract<AgentEvent, { type: 'subagent_start' }>
  events: SubagentInnerEvent[]
  status: 'running' | 'completed' | 'failed' | 'cancelled' | 'max_steps'
  finalAnswer?: string
  error?: string
  durationMs?: number
}

export function parseSubagentRuns(events?: AgentEvent[]): SubagentRunState[] {
  if (!events) return []
  const runsMap: Record<string, SubagentRunState> = {}
  const order: string[] = []

  for (const ev of events) {
    if (ev.type === 'subagent_start') {
      runsMap[ev.subagentId] = { info: ev, events: [], status: 'running' }
      order.push(ev.subagentId)
    } else if (ev.type === 'subagent_event' && runsMap[ev.subagentId]) {
      runsMap[ev.subagentId].events.push(ev.event)
    } else if (ev.type === 'subagent_end' && runsMap[ev.subagentId]) {
      runsMap[ev.subagentId].status = ev.status
      runsMap[ev.subagentId].finalAnswer = ev.finalAnswer
      runsMap[ev.subagentId].error = ev.error
      runsMap[ev.subagentId].durationMs = ev.durationMs
    }
  }

  return order.map((id) => runsMap[id])
}

const formatElapsedDuration = (seconds: number): string => {
  const safeSeconds = Math.max(0, Math.round(seconds))
  const mins = Math.floor(safeSeconds / 60)
  const secs = safeSeconds % 60
  if (mins > 0) return `${mins}m${secs > 0 ? ` ${secs}s` : ''}`
  return `${secs}s`
}

const getPersistedAgentElapsedSeconds = (events?: AgentEvent[]): number => {
  if (!events || events.length === 0) return 0

  const firstTimestamp = events.find((event) => typeof event.timestamp === 'number')?.timestamp
  const lastTimestamp = [...events]
    .reverse()
    .find((event) => typeof event.timestamp === 'number')?.timestamp
  const startTimestamp =
    events.find((event) => event.type === 'agent_start' && typeof event.timestamp === 'number')
      ?.timestamp ?? firstTimestamp
  const endTimestamp =
    [...events]
      .reverse()
      .find((event) => event.type === 'agent_end' && typeof event.timestamp === 'number')
      ?.timestamp ?? lastTimestamp

  if (
    startTimestamp === undefined ||
    endTimestamp === undefined ||
    endTimestamp <= startTimestamp
  ) {
    return 0
  }

  return Math.max(1, Math.round((endTimestamp - startTimestamp) / 1000))
}

export interface UseAgentMessageViewModelProps {
  msg: Message
  isGenerating: boolean
}

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
export function useAgentMessageViewModel({ msg, isGenerating }: UseAgentMessageViewModelProps) {
  const [isExpanded, setIsExpanded] = useState(true)
  const [activeSubagentId, setActiveSubagentId] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [isStepsExpanded, setIsStepsExpandedState] = useState(() => isGenerating)
  const [selectedToolCallId, setSelectedToolCallId] = useState<string | null>(null)
  const wasAgentTimelineActiveRef = useRef(isGenerating)
  const userChangedStepsExpandedRef = useRef(false)

  const setIsStepsExpanded = useCallback((next: boolean | ((current: boolean) => boolean)) => {
    userChangedStepsExpandedRef.current = true
    setIsStepsExpandedState(next)
  }, [])

  const [elapsed, setElapsed] = useState<number>(() => {
    const persistedElapsed = getPersistedAgentElapsedSeconds(msg.agentEvents)
    if (!isGenerating && persistedElapsed > 0) return persistedElapsed
    return isGenerating && msg.role === 'assistant'
      ? Math.round((Date.now() - (parseInt(msg.id) || Date.now())) / 1000)
      : 0
  })

  useEffect(() => {
    if (!isGenerating) {
      const persistedElapsed = getPersistedAgentElapsedSeconds(msg.agentEvents)
      if (persistedElapsed > 0) {
        setElapsed(persistedElapsed)
      }
      return undefined
    }

    if (isGenerating && msg.role === 'assistant') {
      const startTime = parseInt(msg.id) || Date.now()
      const timer = setInterval(() => {
        setElapsed(Math.round((Date.now() - startTime) / 1000))
      }, 500)
      return () => clearInterval(timer)
    }
    return undefined
  }, [isGenerating, msg.agentEvents, msg.id, msg.role])

  const subagents = useMemo(() => {
    return parseSubagentRuns(msg.agentEvents)
  }, [msg.agentEvents])

  const activeSubagent = useMemo(() => {
    if (!activeSubagentId) return null
    return subagents.find((s) => s.info.subagentId === activeSubagentId) || null
  }, [subagents, activeSubagentId])

  const { content: displayContent, reasoning: displayReasoning } = useMemo(
    () => parseThinkTags(msg.content, msg.reasoning_content),
    [msg.content, msg.reasoning_content]
  )

  const hasStructuredEvents = Boolean(msg.agentEvents && msg.agentEvents.length > 0)

  const cleanContent = useMemo(
    () => (hasStructuredEvents ? displayContent : parseAgentLogs(displayContent).cleanContent),
    [hasStructuredEvents, displayContent]
  )

  const isBranchForkMessage = Boolean(msg.isBranchFork || msg.forkedFrom)
  const branchRunId = shortBranchRunId(msg.forkedFrom?.runId)
  const hasLogs = hasStructuredEvents || Boolean(msg.content && msg.content.includes('[tool '))

  const agentEndEvent = useMemo(
    () =>
      msg.agentEvents?.reduce<Extract<AgentEvent, { type: 'agent_end' }> | null>(
        (last, e) => (e.type === 'agent_end' ? e : last),
        null
      ) || null,
    [msg.agentEvents]
  )

  const lastProgressEvent = useMemo(
    () =>
      msg.agentEvents?.reduce<Extract<AgentEvent, { type: 'agent_progress' }> | null>(
        (last, e) => (e.type === 'agent_progress' ? e : last),
        null
      ) || null,
    [msg.agentEvents]
  )

  const latestProgressMessage = lastProgressEvent?.message?.trim() || ''

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
  const maxSteps = lastProgressEvent?.maxSteps ?? Infinity

  const parsedRun = useMemo(() => {
    return parseAgentSteps(msg.agentEvents, msg.content)
  }, [msg.agentEvents, msg.content])

  const isTerminalAgentTimeline =
    !isGenerating &&
    parsedRun.steps.length > 0 &&
    (agentStatus === 'completed' ||
      agentStatus === 'cancelled' ||
      agentStatus === 'failed' ||
      agentStatus === 'max_steps')

  useEffect(() => {
    if (isGenerating || agentStatus === 'running') {
      wasAgentTimelineActiveRef.current = true
      userChangedStepsExpandedRef.current = false
      return
    }

    if (
      wasAgentTimelineActiveRef.current &&
      isTerminalAgentTimeline &&
      !userChangedStepsExpandedRef.current
    ) {
      setIsStepsExpandedState(false)
    }

    wasAgentTimelineActiveRef.current = false
  }, [agentStatus, isGenerating, isTerminalAgentTimeline])

  const selectedToolCall = useMemo(() => {
    if (!selectedToolCallId) return null
    for (const step of parsedRun.steps) {
      const match = step.toolCalls.find((toolCall) => toolCall.callId === selectedToolCallId)
      if (match) return match
    }
    return null
  }, [parsedRun.steps, selectedToolCallId])

  const finalReplyText = hasStructuredEvents ? parsedRun.finalAnswer : cleanContent

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
    activeParsedStep?.toolCalls.find((tc) => tc.status === 'pending' || tc.status === 'running') ||
    activeParsedStep?.toolCalls[activeParsedStep.toolCalls.length - 1]

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
    if (!Number.isFinite(maxSteps) || maxSteps <= 0) {
      return `第 ${currentStep} 步`
    }
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
          : '当前操作：正在连接模型并等待响应...'
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

  return {
    isExpanded,
    setIsExpanded,
    activeSubagentId,
    setActiveSubagentId,
    copied,
    setCopied,
    isStepsExpanded,
    setIsStepsExpanded,
    selectedToolCallId,
    setSelectedToolCallId,
    elapsed,
    subagents,
    activeSubagent,
    displayContent,
    displayReasoning,
    hasStructuredEvents,
    cleanContent,
    isBranchForkMessage,
    branchRunId,
    hasLogs,
    agentEndEvent,
    lastProgressEvent,
    latestProgressMessage,
    agentStatus,
    currentStep,
    maxSteps,
    parsedRun,
    selectedToolCall,
    finalReplyText,
    handleCopy,
    totalToolsCount,
    failedToolsCount,
    cacheHitRateText,
    generationDurationText,
    activeParsedStep,
    latestToolCall,
    tasks,
    inProgressTask,
    pendingToolCall,
    hasActiveToolCall,
    isGeneratingAnswer,
    latestReasoningKey,
    reasoningAutoStateKey,
    shouldAutoOpenStepReasoning,
    activeStepTitle,
    statusText,
    opText,
    toolsSummaryText,
    cockpitColor
  }
}
