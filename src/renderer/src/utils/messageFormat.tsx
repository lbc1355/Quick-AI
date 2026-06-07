import React from 'react'
import katex from 'katex'
import 'katex/dist/katex.min.css'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

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
            <code>{code}</code>
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
