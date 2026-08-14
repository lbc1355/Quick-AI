import React from 'react'
import katex from 'katex'
import 'katex/dist/katex.min.css'
import ReactMarkdown, { type Components } from 'react-markdown'
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

const renderInlineMathText = (text: string, keyPrefix: string): React.ReactNode => {
  const parts = text.split(/(\$[^$\n]+?\$|\\\(.*?\\\))/g)
  if (parts.length === 1) return text

  return parts.map((part, idx) => {
    if (!part) return null
    if (part.startsWith('$') && part.endsWith('$')) {
      return renderMath(part.slice(1, -1), false, `${keyPrefix}-math-dollar-${idx}`)
    }
    if (part.startsWith('\\(') && part.endsWith('\\)')) {
      return renderMath(part.slice(2, -2), false, `${keyPrefix}-math-paren-${idx}`)
    }
    return part
  })
}

const renderInlineMathChildren = (children: React.ReactNode, keyPrefix: string): React.ReactNode =>
  React.Children.map(children, (child, childIdx) => {
    if (typeof child === 'string') {
      return renderInlineMathText(child, `${keyPrefix}-${childIdx}`)
    }
    return child
  })

const markdownComponents: Components = {
  code: ({ className, children, node: _node, ...props }) => {
    const content = Array.isArray(children) ? children.join('') : (children as string)
    return (
      <code
        className={className}
        style={{
          background: 'var(--color-inline-code-bg)',
          padding: '2px 4px',
          borderRadius: '4px',
          fontFamily: 'var(--font-mono)',
          fontSize: 'var(--font-size-sm)',
          color: 'var(--color-danger)'
        }}
        {...props}
      >
        {content}
      </code>
    )
  },
  p: ({ children, node: _node, ...props }) => (
    <p {...props}>{renderInlineMathChildren(children, 'p')}</p>
  ),
  li: ({ children, node: _node, ...props }) => (
    <li {...props}>{renderInlineMathChildren(children, 'li')}</li>
  ),
  td: ({ children, node: _node, ...props }) => (
    <td {...props}>{renderInlineMathChildren(children, 'td')}</td>
  ),
  th: ({ children, node: _node, ...props }) => (
    <th {...props}>{renderInlineMathChildren(children, 'th')}</th>
  ),
  strong: ({ children, node: _node, ...props }) => (
    <strong {...props}>{renderInlineMathChildren(children, 'strong')}</strong>
  ),
  em: ({ children, node: _node, ...props }) => (
    <em {...props}>{renderInlineMathChildren(children, 'em')}</em>
  ),
  a: ({ href, children, node: _node, ...props }) => (
    <a href={href} target="_blank" rel="noreferrer" {...props}>
      {renderInlineMathChildren(children, 'a')}
    </a>
  )
}

const renderMarkdownPart = (markdown: string, key: string): React.ReactNode => {
  if (!markdown) return null
  return (
    <ReactMarkdown key={key} remarkPlugins={[remarkGfm]} components={markdownComponents}>
      {markdown}
    </ReactMarkdown>
  )
}

export type MessageMarkdownBlock =
  | { type: 'markdown'; text: string }
  | { type: 'code'; lang: string; code: string; closed: boolean }

const FENCE_START_PATTERN = /(^|\n)[\t ]{0,3}(`{3,}|~{3,})[\t ]*([^\r\n]*)(?:\r?\n|$)/g

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * Split fenced code from prose while accepting an unfinished trailing fence.
 * Open and closed fences deliberately have the same block shape so completing a
 * streamed response does not replace the code block's DOM structure.
 */
export const parseMessageMarkdownBlocks = (text: string): MessageMarkdownBlock[] => {
  if (!text) return []

  const blocks: MessageMarkdownBlock[] = []
  let cursor = 0
  FENCE_START_PATTERN.lastIndex = 0

  for (let match = FENCE_START_PATTERN.exec(text); match; match = FENCE_START_PATTERN.exec(text)) {
    const openerStart = match.index + match[1].length
    if (openerStart > cursor) {
      blocks.push({ type: 'markdown', text: text.slice(cursor, openerStart) })
    }

    const fence = match[2]
    const fenceCharacter = escapeRegExp(fence[0])
    const closePattern = new RegExp(
      `^[\\t ]{0,3}${fenceCharacter}{${fence.length},}[\\t ]*(?:\\r?$)`,
      'm'
    )
    const codeStart = FENCE_START_PATTERN.lastIndex
    const remaining = text.slice(codeStart)
    const closeMatch = closePattern.exec(remaining)
    const lang = match[3].trim().split(/\s+/, 1)[0] || ''

    if (!closeMatch) {
      blocks.push({ type: 'code', lang, code: remaining, closed: false })
      cursor = text.length
      break
    }

    const closeStart = codeStart + closeMatch.index
    blocks.push({
      type: 'code',
      lang,
      code: text.slice(codeStart, closeStart),
      closed: true
    })
    cursor = closeStart + closeMatch[0].length
    FENCE_START_PATTERN.lastIndex = cursor
  }

  if (cursor < text.length) {
    blocks.push({ type: 'markdown', text: text.slice(cursor) })
  }

  return blocks
}

const MessageCodeBlock = React.memo<{
  block: Extract<MessageMarkdownBlock, { type: 'code' }>
}>(({ block }) => {
  const label = block.lang || 'code'

  return (
    <div
      className="code-block-container"
      data-streaming={!block.closed ? 'true' : undefined}
      aria-busy={!block.closed}
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
        <span>{label}</span>
        <button
          type="button"
          style={{
            appearance: 'none',
            padding: 0,
            border: 0,
            background: 'transparent',
            cursor: 'pointer',
            color: 'var(--color-primary)',
            font: 'inherit'
          }}
          onClick={(): Promise<void> => navigator.clipboard.writeText(block.code)}
        >
          复制
        </button>
      </div>
      <pre
        style={{
          margin: 0,
          padding: '12px',
          overflowX: 'auto',
          background: 'var(--color-code-block-bg)',
          color: 'var(--color-code-block-text)',
          fontFamily: 'var(--font-mono)',
          fontSize: 'var(--font-size-sm)',
          lineHeight: '1.6'
        }}
      >
        <code>{renderHighlightedCode(block.code, block.lang)}</code>
      </pre>
    </div>
  )
})
MessageCodeBlock.displayName = 'MessageCodeBlock'

const renderMarkdownWithMath = (markdown: string, blockIndex: number): React.ReactNode => {
  const blockParts = markdown.split(/(\$\$[\s\S]*?\$\$|\\\[[\s\S]*?\\\])/g)
  return blockParts.map((blockPart, mathIndex) => {
    if (!blockPart) return null
    if (blockPart.startsWith('$$') && blockPart.endsWith('$$')) {
      return (
        <div key={`math-dollar-${blockIndex}-${mathIndex}`} className="math-block">
          {renderMath(blockPart.slice(2, -2), true)}
        </div>
      )
    }
    if (blockPart.startsWith('\\[') && blockPart.endsWith('\\]')) {
      return (
        <div key={`math-bracket-${blockIndex}-${mathIndex}`} className="math-block">
          {renderMath(blockPart.slice(2, -2), true)}
        </div>
      )
    }
    return renderMarkdownPart(blockPart, `md-${blockIndex}-${mathIndex}`)
  })
}

export interface MessageMarkdownProps {
  text: string
  streaming?: boolean
}

/** A single Markdown renderer shared by streaming and completed assistant messages. */
export const MessageMarkdown = React.memo<MessageMarkdownProps>(({ text }) => {
  const blocks = React.useMemo(() => parseMessageMarkdownBlocks(text), [text])
  if (blocks.length === 0) return null

  return (
    <>
      {blocks.map((block, index) => {
        if (block.type === 'code') {
          return <MessageCodeBlock key={`code-${index}`} block={block} />
        }
        return (
          <React.Fragment key={`markdown-${index}`}>
            {renderMarkdownWithMath(block.text, index)}
          </React.Fragment>
        )
      })}
    </>
  )
})
MessageMarkdown.displayName = 'MessageMarkdown'

// Compatibility helper for non-streaming call sites.
export const renderMessageContent = (text: string): React.ReactNode => {
  if (!text) return null
  return <MessageMarkdown text={text} />
}

// Get the visual tag badge colors for the autocomplete triggers
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
  status: 'idle' | 'running' | 'completed' | 'cancelled' | 'failed' | 'max_steps' | 'safety_stop'
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

      const hasCommittedFinalAnswer = events.some((event) => event.type === 'final')

      run.steps = groups
        .map((g): ParsedAgentStep | null => {
          const toolCallsList = Array.from(g.toolCalls.values())
          const streamedMessage = g.messageDeltaTexts.join('')
          const progressMessage = g.progressMessage || streamedMessage
          const isUnclassifiedModelMessage =
            !g.hasAgentStep && toolCallsList.length === 0 && streamedMessage.length > 0

          if (isUnclassifiedModelMessage) {
            run.finalReasoning += g.reasoningTexts.join('')
            if (!hasCommittedFinalAnswer && !finalizedMessageStepIds.has(g.id)) {
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

  // Defensive compatibility for providers that put a normal answer exclusively in their
  // reasoning field. Without this fallback the answer is visible while streaming, then the
  // completed agent bubble has no finalAnswer and disappears entirely. This also repairs the
  // display of messages persisted before the model-response normalizer was added.
  if (run.status === 'completed' && !run.finalAnswer.trim() && run.finalReasoning.trim()) {
    run.finalAnswer = run.finalReasoning
    run.finalReasoning = ''
  }

  return run
}
