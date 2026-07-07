import React from 'react'
import katex from 'katex'
import 'katex/dist/katex.min.css'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { AgentEvent, ToolResultUi } from '../../../shared/types'
import { renderHighlightedCode } from './codeHighlight'

// Parse reasoning process from either official API properties or local Ollama `<think>` tags
export const parseThinkTags = (
  content: string,
  reasoningContent?: string
): { content: string; reasoning: string } => {
  let finalContent = content
  let finalReasoning = reasoningContent || ''

  if (content.includes('<think>')) {
    const parts = content.split('</think>')
    if (parts.length > 1) {
      // Thinking completed
      finalReasoning = parts[0].replace('<think>', '').trim()
      finalContent = parts.slice(1).join('').trim()
    } else {
      // Thinking in progress
      finalReasoning = content.replace('<think>', '').trim()
      finalContent = ''
    }
  }

  return { content: finalContent, reasoning: finalReasoning }
}

export interface AgentLogStep {
  step: number
  maxSteps: number
  type: 'tool' | 'result' | 'error' | 'think'
  toolName?: string
  url?: string
  title?: string
  error?: string
  thought?: string
}

export const parseAgentLogs = (
  content: string
): { logs: AgentLogStep[]; cleanContent: string; skillName: string } => {
  let skillName = ''
  const logs: AgentLogStep[] = []

  const lines = content.split('\n')
  let logEndIdx = 0

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim()
    if (!line) {
      if (i === logEndIdx) logEndIdx = i + 1
      continue
    }

    if (line.startsWith('Running agent skill:')) {
      skillName = line.replace('Running agent skill:', '').trim()
      logEndIdx = i + 1
      continue
    }

    if (line.startsWith('[final]')) {
      logEndIdx = i + 1
      break
    }

    const thinkMatch = line.match(/^\[think (\d+)\/(\d+)\]\s*(.*)$/)
    if (thinkMatch) {
      const step = parseInt(thinkMatch[1])
      const maxSteps = parseInt(thinkMatch[2])
      let thought = thinkMatch[3].trim()

      let nextIdx = i + 1
      while (nextIdx < lines.length) {
        const nextLine = lines[nextIdx].trim()
        if (
          nextLine.startsWith('Running agent skill:') ||
          nextLine.startsWith('[final]') ||
          nextLine.match(/^\[tool \d+\/\d+\]/) ||
          nextLine.match(/^\[result \d+\/\d+\]/) ||
          nextLine.match(/^\[error \d+\/\d+\]/) ||
          nextLine.match(/^\[think \d+\/\d+\]/)
        ) {
          break
        }
        thought += (thought ? '\n' : '') + lines[nextIdx]
        nextIdx++
      }

      i = nextIdx - 1
      logs.push({
        step,
        maxSteps,
        type: 'think',
        thought
      })
      logEndIdx = i + 1
      continue
    }

    const toolMatch = line.match(/^\[tool (\d+)\/(\d+)\]\s+(.*)$/)
    if (toolMatch) {
      const step = parseInt(toolMatch[1])
      const maxSteps = parseInt(toolMatch[2])
      const toolName = toolMatch[3].trim()
      let url = ''
      let nextIdx = i + 1
      while (nextIdx < lines.length && !lines[nextIdx].trim()) {
        nextIdx++
      }
      if (nextIdx < lines.length) {
        // Ensure we don't accidentally treat [final] as a URL
        const nextLine = lines[nextIdx].trim()
        if (!nextLine.startsWith('[final]')) {
          url = nextLine
          i = nextIdx
        }
      }
      logs.push({
        step,
        maxSteps,
        type: 'tool',
        toolName,
        url
      })
      logEndIdx = i + 1
      continue
    }

    const resultMatch = line.match(/^\[result (\d+)\/(\d+)\]\s+(.*)$/)
    if (resultMatch) {
      const step = parseInt(resultMatch[1])
      const maxSteps = parseInt(resultMatch[2])
      const title = resultMatch[3].trim()
      let url = ''
      let nextIdx = i + 1
      while (nextIdx < lines.length && !lines[nextIdx].trim()) {
        nextIdx++
      }
      if (nextIdx < lines.length) {
        const nextLine = lines[nextIdx].trim()
        if (!nextLine.startsWith('[final]')) {
          url = nextLine
          i = nextIdx
        }
      }
      logs.push({
        step,
        maxSteps,
        type: 'result',
        title,
        url
      })
      logEndIdx = i + 1
      continue
    }

    const errorMatch = line.match(/^\[error (\d+)\/(\d+)\]\s+(.*)$/)
    if (errorMatch) {
      const step = parseInt(errorMatch[1])
      const maxSteps = parseInt(errorMatch[2])
      const error = errorMatch[3].trim()
      logs.push({
        step,
        maxSteps,
        type: 'error',
        error
      })
      logEndIdx = i + 1
      continue
    }

    break
  }

  const cleanContent = lines.slice(logEndIdx).join('\n').trim()
  return { logs, cleanContent, skillName }
}

const renderMath = (math: string, block = false, key?: string): React.ReactNode => {
  let html = ''
  let hasError = false
  try {
    html = katex.renderToString(math, {
      displayMode: block,
      throwOnError: false
    })
  } catch (error) {
    console.error('KaTeX error:', error)
    hasError = true
  }

  if (hasError) {
    return <code key={key}>{math}</code>
  }
  return <span key={key} dangerouslySetInnerHTML={{ __html: html }} />
}

// Custom text formatter — uses react-markdown with GFM support for rich rendering,
// while preserving custom code-block (with copy button) and KaTeX math rendering.
export const renderMessageContent = (text: string): React.ReactNode => {
  if (!text) return null
  const parts = text.split(/(```[\s\S]*?```)/g)

  return parts.map((part, idx) => {
    if (part.startsWith('```')) {
      const match = part.match(/```(\w*)\n([\s\S]*?)```/)
      const lang = match ? match[1] : ''
      const code = match ? match[2] : part.slice(3, -3)
      return (
        <div
          key={`code-blk-${idx}`}
          className="code-block-container"
          style={{
            margin: '8px 0',
            border: '1px solid var(--color-code-block-border)',
            borderRadius: '8px',
            overflow: 'hidden'
          }}
        >
          <div
            style={{
              background: 'var(--color-code-block-header-bg)',
              padding: '6px 12px',
              fontSize: '11.5px',
              borderBottom: '1px solid var(--color-code-block-border)',
              color: 'var(--color-code-block-header-text)',
              display: 'flex',
              justifyContent: 'space-between',
              userSelect: 'none'
            }}
          >
            <span>{lang || 'code'}</span>
            <span
              style={{ cursor: 'pointer', color: 'var(--color-primary)' }}
              onClick={(): Promise<void> => navigator.clipboard.writeText(code)}
            >
              复制
            </span>
          </div>
          <pre
            style={{
              margin: 0,
              padding: '10px',
              overflowX: 'auto',
              background: 'var(--color-code-block-bg)',
              color: 'var(--color-code-block-text)',
              fontFamily: 'Consolas, monospace',
              fontSize: '12px'
            }}
          >
            <code>{renderHighlightedCode(code, lang)}</code>
          </pre>
        </div>
      )
    } else {
      // Split by block math $$...$$ and \[...\]
      const blockParts = part.split(/(\$\$[\s\S]*?\$\$|\\\[[\s\S]*?\\\])/g)
      return (
        <span key={`text-blk-${idx}`}>
          {blockParts.map((blockPart, bIdx) => {
            if (blockPart.startsWith('$$') && blockPart.endsWith('$$')) {
              const math = blockPart.slice(2, -2)
              return renderMath(math, true, `math-b-${bIdx}`)
            } else if (blockPart.startsWith('\\[') && blockPart.endsWith('\\]')) {
              const math = blockPart.slice(2, -2)
              return renderMath(math, true, `math-b-${bIdx}`)
            } else {
              // Split by inline math $...$ and \(...\)
              const inlineParts = blockPart.split(/(\$[^$\n]+?\$|\\\(.*?\\\))/g)
              // Rejoin segments so react-markdown receives the largest contiguous text blocks
              const segments: Array<{ type: 'text' | 'math'; value: string }> = []
              for (const ip of inlineParts) {
                if (ip.startsWith('$') && ip.endsWith('$')) {
                  segments.push({ type: 'math', value: ip.slice(1, -1) })
                } else if (ip.startsWith('\\(') && ip.endsWith('\\)')) {
                  segments.push({ type: 'math', value: ip.slice(2, -2) })
                } else {
                  if (segments.length > 0 && segments[segments.length - 1].type === 'text') {
                    segments[segments.length - 1].value += ip
                  } else {
                    segments.push({ type: 'text', value: ip })
                  }
                }
              }

              return (
                <span key={`inline-blk-${bIdx}`}>
                  {segments.map((seg, sIdx) => {
                    if (seg.type === 'math') {
                      return renderMath(seg.value, false, `math-i-${sIdx}`)
                    }
                    return (
                      <ReactMarkdown
                        key={`rm-${sIdx}`}
                        remarkPlugins={[remarkGfm]}
                        components={{
                          code: ({ className, children, ...props }) => {
                            // Inline code: no language class means it's an inline `<code>`
                            const content = Array.isArray(children)
                              ? children.join('')
                              : (children as string)
                            return (
                              <code
                                className={className}
                                style={{
                                  background: 'var(--color-inline-code-bg)',
                                  padding: '2px 4px',
                                  borderRadius: '4px',
                                  fontFamily: 'Consolas, monospace',
                                  fontSize: '12px',
                                  color: '#f43f5e'
                                }}
                                {...props}
                              >
                                {content}
                              </code>
                            )
                          },
                          a: ({ href, children, ...props }) => (
                            <a href={href} target="_blank" rel="noreferrer" {...props}>
                              {children}
                            </a>
                          )
                        }}
                      >
                        {seg.value}
                      </ReactMarkdown>
                    )
                  })}
                </span>
              )
            }
          })}
        </span>
      )
    }
  })
}

// Get the visual tag badge colors for the autocomplete triggers
export const getTriggerColor = (type: string): string => {
  if (type === 'command') return '#f59e0b' // Amber/Orange for system commands
  if (type === 'delete-session') return '#ef4444' // Red for session deletion
  if (type === 'session') return '#3b82f6' // Blue for history session
  if (type === 'model') return '#a855f7' // Purple for switching model
  if (type === 'provider') return '#06b6d4' // Cyan for provider switching
  return '#10b981' // Green for prompt skills
}

export interface ParsedToolCall {
  callId: string
  toolName: string
  args: unknown
  purpose?: string
  permissionState?: 'pending' | 'approved' | 'denied'
  output?: string
  result?: ToolResultUi
  error?: string
  status: 'pending' | 'running' | 'completed' | 'failed' | 'denied'
}

export interface ParsedAgentStep {
  id: string
  stepNumber: number
  title?: string
  status: 'running' | 'completed' | 'failed' | 'cancelled'
  progressMessage: string
  toolCalls: ParsedToolCall[]
  reasoning: string
}

export interface ParsedAgentRun {
  steps: ParsedAgentStep[]
  finalAnswer: string
  finalReasoning: string
  status: 'idle' | 'running' | 'completed' | 'cancelled' | 'failed' | 'max_steps'
  totalToolsCount: number
  failedToolsCount: number
}

const MAX_TOOL_OUTPUT_PREVIEW_CHARS = 64 * 1024

const appendToolOutputPreview = (
  existing: string | undefined,
  stream: 'stdout' | 'stderr',
  content: string
): string => {
  const prefix = stream === 'stderr' ? 'Stderr' : 'Stdout'
  const next = `${existing || ''}${existing ? '\n' : ''}${prefix}:\n${content.trimEnd()}`
  if (next.length <= MAX_TOOL_OUTPUT_PREVIEW_CHARS) return next
  return `[Output preview truncated to last ${MAX_TOOL_OUTPUT_PREVIEW_CHARS} chars]\n${next.slice(-MAX_TOOL_OUTPUT_PREVIEW_CHARS)}`
}

export const parseAgentSteps = (
  events: AgentEvent[] | undefined,
  legacyContent?: string
): ParsedAgentRun => {
  const run: ParsedAgentRun = {
    steps: [],
    finalAnswer: '',
    finalReasoning: '',
    status: 'idle',
    totalToolsCount: 0,
    failedToolsCount: 0
  }

  if (events && events.length > 0) {
    const hasStructuredTimeline = events.some(
      (event) => event.type === 'agent_step' || event.type === 'agent_message_delta'
    )

    if (hasStructuredTimeline) {
      interface ExplicitGroup {
        id: string
        stepNumber: number
        title?: string
        progressMessage: string
        messageDeltaTexts: string[]
        reasoningTexts: string[]
        toolCalls: Map<string, ParsedToolCall>
        explicitStatus?: ParsedAgentStep['status']
        hasAgentStep?: boolean
      }

      const groups: ExplicitGroup[] = []
      const groupsById = new Map<string, ExplicitGroup>()
      const callToGroupId = new Map<string, string>()
      const errorCountedCallIds = new Set<string>()
      const finalizedMessageStepIds = new Set<string>()
      let latestStepId: string | undefined

      const getStepMeta = (event: AgentEvent): { stepId?: string; step?: number } => ({
        stepId: 'stepId' in event && typeof event.stepId === 'string' ? event.stepId : undefined,
        step: 'step' in event && typeof event.step === 'number' ? event.step : undefined
      })

      const getOrCreateGroup = (stepId: string, stepNum?: number): ExplicitGroup => {
        const existing = groupsById.get(stepId)
        if (existing) {
          if (stepNum !== undefined) existing.stepNumber = stepNum
          return existing
        }
        const g: ExplicitGroup = {
          id: stepId,
          stepNumber: stepNum ?? groups.length + 1,
          progressMessage: '',
          messageDeltaTexts: [],
          reasoningTexts: [],
          toolCalls: new Map()
        }
        groups.push(g)
        groupsById.set(stepId, g)
        return g
      }

      const getGroupForEvent = (event: AgentEvent): ExplicitGroup => {
        const meta = getStepMeta(event)
        if (meta.stepId) return getOrCreateGroup(meta.stepId, meta.step)
        if (latestStepId) return getOrCreateGroup(latestStepId, meta.step)
        return getOrCreateGroup(`implicit-step-${groups.length + 1}`, meta.step)
      }

      const getGroupForCallResult = (
        event: Extract<AgentEvent, { type: 'tool_result' | 'tool_error' | 'tool_output_delta' }>
      ): ExplicitGroup => {
        const meta = getStepMeta(event)
        if (meta.stepId) return getOrCreateGroup(meta.stepId, meta.step)
        const mappedGroupId = callToGroupId.get(event.callId)
        const mappedGroup = mappedGroupId ? groupsById.get(mappedGroupId) : undefined
        return mappedGroup || getGroupForEvent(event)
      }

      events.forEach((event) => {
        if (event.type === 'agent_end') {
          run.status = event.status
          return
        }

        if (event.type === 'agent_step') {
          const g = getOrCreateGroup(event.stepId, event.step)
          g.title = event.title
          g.progressMessage = event.message || g.messageDeltaTexts.join('')
          g.explicitStatus = event.status
          g.hasAgentStep = true
          latestStepId = event.stepId
          return
        }

        if (event.type === 'agent_step_end') {
          const g = getOrCreateGroup(event.stepId)
          g.explicitStatus = event.status
          return
        }

        if (event.type === 'final') {
          const meta = getStepMeta(event)
          if (meta.stepId) finalizedMessageStepIds.add(meta.stepId)
          run.finalAnswer += event.content
          return
        }

        if (event.type === 'agent_message_delta') {
          const g = getGroupForEvent(event)
          g.messageDeltaTexts.push(event.content)
          latestStepId = event.stepId
          return
        }

        if (event.type === 'reasoning') {
          const meta = getStepMeta(event)
          if (!meta.stepId && meta.step === undefined) {
            run.finalReasoning += event.content
            return
          }
          const g = getGroupForEvent(event)
          g.reasoningTexts.push(event.content)
          return
        }

        if (event.type === 'tool_call') {
          const g = getGroupForEvent(event)
          callToGroupId.set(event.callId, g.id)
          run.totalToolsCount++
          let status: ParsedToolCall['status'] = 'running'
          if (event.permissionState === 'pending') status = 'pending'
          else if (event.permissionState === 'denied') status = 'denied'

          g.toolCalls.set(event.callId, {
            callId: event.callId,
            toolName: event.toolName,
            args: event.args,
            purpose: event.purpose,
            permissionState: event.permissionState,
            status
          })
          return
        }

        if (event.type === 'tool_result') {
          const g = getGroupForCallResult(event)
          const tc = g.toolCalls.get(event.callId)
          if (tc) {
            tc.result = event.result
            tc.status = 'completed'
          }
          return
        }

        if (event.type === 'tool_output_delta') {
          const g = getGroupForCallResult(event)
          const tc = g.toolCalls.get(event.callId)
          if (tc) {
            tc.output = event.replace
              ? event.content
              : appendToolOutputPreview(tc.output, event.stream, event.content)
          }
          return
        }

        if (event.type === 'tool_error') {
          const g = getGroupForCallResult(event)
          let tc = g.toolCalls.get(event.callId)
          if (!tc) {
            tc = {
              callId: event.callId,
              toolName: 'tool',
              args: {},
              status: 'failed'
            }
            g.toolCalls.set(event.callId, tc)
            run.totalToolsCount++
          }
          tc.error = event.error
          tc.status = 'failed'
          if (!errorCountedCallIds.has(event.callId)) {
            run.failedToolsCount++
            errorCountedCallIds.add(event.callId)
          }
        }
      })

      run.steps = groups
        .map((g): ParsedAgentStep | null => {
          const toolCallsList = Array.from(g.toolCalls.values())
          const streamedMessage = g.messageDeltaTexts.join('')
          const progressMessage = g.progressMessage || streamedMessage
          const isUnclassifiedModelMessage =
            !g.hasAgentStep && toolCallsList.length === 0 && streamedMessage.length > 0

          if (isUnclassifiedModelMessage) {
            run.finalReasoning += g.reasoningTexts.join('')
            if (!finalizedMessageStepIds.has(g.id) && !run.finalAnswer) {
              run.finalAnswer = streamedMessage
            }
            return null
          }

          let stepStatus: ParsedAgentStep['status'] = 'completed'
          if (g.explicitStatus === 'cancelled') {
            stepStatus = 'cancelled'
          } else if (
            g.explicitStatus === 'failed' ||
            toolCallsList.some((tc) => tc.status === 'failed' || tc.status === 'denied')
          ) {
            stepStatus = 'failed'
          } else if (
            g.explicitStatus === 'running' ||
            toolCallsList.some((tc) => tc.status === 'running' || tc.status === 'pending')
          ) {
            stepStatus = 'running'
          }

          return {
            id: g.id,
            stepNumber: g.stepNumber,
            title: g.title,
            status: stepStatus,
            progressMessage,
            toolCalls: toolCallsList,
            reasoning: g.reasoningTexts.join('')
          }
        })
        .filter((step): step is ParsedAgentStep => step !== null)
        .sort((a, b) => a.stepNumber - b.stepNumber)

      if (run.status === 'cancelled') {
        run.steps = run.steps.map((step, idx) =>
          idx === run.steps.length - 1 && step.status === 'running'
            ? { ...step, status: 'cancelled' }
            : step
        )
      }
    } else {
      interface RawGroup {
        stepNumber: number
        finalTexts: string[]
        reasoningTexts: string[]
        toolCalls: Map<string, ParsedToolCall>
      }

      const groups: RawGroup[] = []

      const getOrCreateGroup = (stepNum: number): RawGroup => {
        let g = groups.find((x) => x.stepNumber === stepNum)
        if (!g) {
          g = {
            stepNumber: stepNum,
            finalTexts: [],
            reasoningTexts: [],
            toolCalls: new Map()
          }
          groups.push(g)
        }
        return g
      }

      // Fallback counter for legacy events
      let legacyStepCounter = 1
      let legacyHasToolCallInCurrentStep = false

      events.forEach((event) => {
        let stepNum = 'step' in event && typeof event.step === 'number' ? event.step : undefined

        if (stepNum === undefined || stepNum === null) {
          if (event.type === 'final') {
            if (legacyHasToolCallInCurrentStep) {
              legacyStepCounter++
              legacyHasToolCallInCurrentStep = false
            }
            stepNum = legacyStepCounter
          } else if (event.type === 'tool_call') {
            legacyHasToolCallInCurrentStep = true
            stepNum = legacyStepCounter
          } else if (
            event.type === 'tool_result' ||
            event.type === 'tool_output_delta' ||
            event.type === 'tool_error' ||
            event.type === 'reasoning'
          ) {
            stepNum = legacyStepCounter
          }
        } else {
          legacyStepCounter = stepNum
        }

        if (event.type === 'agent_end') {
          run.status = event.status
        }

        if (stepNum === undefined) {
          return
        }

        const g = getOrCreateGroup(stepNum)

        if (event.type === 'reasoning') {
          g.reasoningTexts.push(event.content)
        } else if (event.type === 'final') {
          g.finalTexts.push(event.content)
        } else if (event.type === 'tool_call') {
          run.totalToolsCount++
          let status: ParsedToolCall['status'] = 'running'
          if (event.permissionState === 'pending') status = 'pending'
          else if (event.permissionState === 'denied') status = 'denied'
          else if (event.permissionState === 'approved') status = 'running'

          g.toolCalls.set(event.callId, {
            callId: event.callId,
            toolName: event.toolName,
            args: event.args,
            purpose: event.purpose,
            permissionState: event.permissionState,
            status
          })
        } else if (event.type === 'tool_result') {
          const tc = g.toolCalls.get(event.callId)
          if (tc) {
            tc.result = event.result
            tc.status = 'completed'
          } else {
            for (const otherG of groups) {
              const otherTc = otherG.toolCalls.get(event.callId)
              if (otherTc) {
                otherTc.result = event.result
                otherTc.status = 'completed'
                break
              }
            }
          }
        } else if (event.type === 'tool_output_delta') {
          const tc = g.toolCalls.get(event.callId)
          if (tc) {
            tc.output = event.replace
              ? event.content
              : appendToolOutputPreview(tc.output, event.stream, event.content)
          } else {
            for (const otherG of groups) {
              const otherTc = otherG.toolCalls.get(event.callId)
              if (otherTc) {
                otherTc.output = event.replace
                  ? event.content
                  : appendToolOutputPreview(otherTc.output, event.stream, event.content)
                break
              }
            }
          }
        } else if (event.type === 'tool_error') {
          run.failedToolsCount++
          const tc = g.toolCalls.get(event.callId)
          if (tc) {
            tc.error = event.error
            tc.status = 'failed'
          } else {
            for (const otherG of groups) {
              const otherTc = otherG.toolCalls.get(event.callId)
              if (otherTc) {
                otherTc.error = event.error
                otherTc.status = 'failed'
                break
              }
            }
          }
        }
      })

      const steps: ParsedAgentStep[] = groups
        .map((g) => {
          const toolCallsList = Array.from(g.toolCalls.values())
          let stepStatus: ParsedAgentStep['status'] = 'completed'
          if (toolCallsList.some((tc) => tc.status === 'running' || tc.status === 'pending')) {
            stepStatus = 'running'
          } else if (toolCallsList.some((tc) => tc.status === 'failed' || tc.status === 'denied')) {
            stepStatus = 'failed'
          }

          return {
            id: `step-${g.stepNumber}`,
            stepNumber: g.stepNumber,
            status: stepStatus,
            progressMessage: g.finalTexts.join(''),
            toolCalls: toolCallsList,
            reasoning: g.reasoningTexts.join('')
          }
        })
        .sort((a, b) => a.stepNumber - b.stepNumber)

      if (steps.length > 0) {
        const lastStep = steps[steps.length - 1]
        if (lastStep.toolCalls.length === 0) {
          run.finalAnswer = lastStep.progressMessage
          run.finalReasoning = lastStep.reasoning
          steps.pop()
        }
      }

      run.steps = steps
    }
  } else if (legacyContent) {
    const parsed = parseAgentLogs(legacyContent)
    run.finalAnswer = parsed.cleanContent

    interface LegacyGroup {
      stepNumber: number
      thoughtText: string
      toolCalls: Map<string, ParsedToolCall>
    }
    const groups: LegacyGroup[] = []

    const getOrCreateGroup = (stepNum: number): LegacyGroup => {
      let g = groups.find((x) => x.stepNumber === stepNum)
      if (!g) {
        g = {
          stepNumber: stepNum,
          thoughtText: '',
          toolCalls: new Map()
        }
        groups.push(g)
      }
      return g
    }

    parsed.logs.forEach((log) => {
      const g = getOrCreateGroup(log.step)
      if (log.type === 'think' && log.thought) {
        g.thoughtText = log.thought
      } else if (log.type === 'tool' && log.toolName) {
        run.totalToolsCount++
        g.toolCalls.set(log.url || log.toolName, {
          callId: `legacy-tc-${log.step}-${log.toolName}`,
          toolName: log.toolName,
          args: { url: log.url },
          status: 'running'
        })
      } else if (log.type === 'result') {
        const tc = g.toolCalls.get(log.url || '')
        if (tc) {
          tc.result = { title: log.title, url: log.url }
          tc.status = 'completed'
        }
      } else if (log.type === 'error') {
        run.failedToolsCount++
        for (const tc of g.toolCalls.values()) {
          if (tc.status === 'running') {
            tc.error = log.error
            tc.status = 'failed'
          }
        }
      }
    })

    run.steps = groups
      .map((g) => {
        const toolCallsList = Array.from(g.toolCalls.values())
        let stepStatus: ParsedAgentStep['status'] = 'completed'
        if (toolCallsList.some((tc) => tc.status === 'running' || tc.status === 'pending')) {
          stepStatus = 'running'
        } else if (toolCallsList.some((tc) => tc.status === 'failed' || tc.status === 'denied')) {
          stepStatus = 'failed'
        }
        return {
          id: `legacy-step-${g.stepNumber}`,
          stepNumber: g.stepNumber,
          status: stepStatus,
          progressMessage: g.thoughtText,
          toolCalls: toolCallsList,
          reasoning: ''
        }
      })
      .sort((a, b) => a.stepNumber - b.stepNumber)
  }

  return run
}
