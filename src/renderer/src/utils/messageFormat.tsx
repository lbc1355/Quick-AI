import React from 'react'
import katex from 'katex'
import 'katex/dist/katex.min.css'

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

// Recursively parse inline formatting like bold (**bold**) and italics (*italic*)
const parseInlineMarkdown = (text: string, keyPrefix: string): React.ReactNode => {
  // 1. Bold: **text**
  const boldParts = text.split(/(\*\*[^*]+?\*\*)/g)
  return boldParts.map((bPart, bIdx) => {
    const uniqueKey = `${keyPrefix}-b-${bIdx}`
    if (bPart.startsWith('**') && bPart.endsWith('**')) {
      const content = bPart.slice(2, -2)
      return (
        <strong key={uniqueKey} style={{ fontWeight: 600 }}>
          {parseInlineMarkdown(content, uniqueKey)}
        </strong>
      )
    }

    // 2. Italic: *text*
    const italicParts = bPart.split(/(\*[^*]+?\*)/g)
    return (
      <span key={uniqueKey}>
        {italicParts.map((iPart, iIdx) => {
          const iKey = `${uniqueKey}-i-${iIdx}`
          if (iPart.startsWith('*') && iPart.endsWith('*')) {
            return (
              <em key={iKey} style={{ fontStyle: 'italic' }}>
                {iPart.slice(1, -1)}
              </em>
            )
          }
          return iPart
        })}
      </span>
    )
  })
}

// Parse block-level markdown structures: headings, bullet lists, ordered lists, tables, and paragraphs
const parseBlockMarkdown = (text: string, blockKey: string): React.ReactNode => {
  const lines = text.split('\n')
  const blocks: React.ReactNode[] = []

  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    const trimmed = line.trim()

    if (!trimmed) {
      i++
      continue
    }

    // 1. Headers: e.g. "### Header"
    const headerMatch = trimmed.match(/^(#{1,6})\s+(.*)$/)
    if (headerMatch) {
      const level = headerMatch[1].length
      const title = headerMatch[2]
      const fontSize = `${22 - level * 2}px`
      const HeadingTag = `h${level}` as 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6'
      const key = `${blockKey}-h-${i}`
      blocks.push(
        <HeadingTag
          key={key}
          style={{
            fontSize,
            fontWeight: 600,
            margin: '12px 0 6px 0',
            color: 'var(--color-text-title)',
            lineHeight: '1.3'
          }}
        >
          {parseInlineMarkdown(title, key)}
        </HeadingTag>
      )
      i++
      continue
    }

    // 2. Table Block: starts with '|' and ends with '|'
    if (trimmed.startsWith('|') && trimmed.endsWith('|')) {
      const tableLines: string[] = []
      while (i < lines.length && lines[i].trim().startsWith('|') && lines[i].trim().endsWith('|')) {
        tableLines.push(lines[i].trim())
        i++
      }

      if (tableLines.length >= 2) {
        // Parse header
        const headerRow = tableLines[0]
        const headers = headerRow
          .slice(1, -1)
          .split('|')
          .map((s) => s.trim())

        // Parse alignments from the second row (separator)
        const sepRow = tableLines[1]
        const sepParts = sepRow
          .slice(1, -1)
          .split('|')
          .map((s) => s.trim())
        const alignments = sepParts.map((part) => {
          const left = part.startsWith(':')
          const right = part.endsWith(':')
          if (left && right) return 'center'
          if (right) return 'right'
          return 'left' // default
        })

        // Parse data rows
        const rows: string[][] = []
        for (let r = 2; r < tableLines.length; r++) {
          const rowLine = tableLines[r]
          const cells = rowLine
            .slice(1, -1)
            .split('|')
            .map((s) => s.trim())
          // Fill missing cells if row has fewer cells than headers
          while (cells.length < headers.length) {
            cells.push('')
          }
          rows.push(cells)
        }

        const key = `${blockKey}-table-${i}`
        blocks.push(
          <div
            key={key}
            style={{
              overflowX: 'auto',
              margin: '12px 0',
              border: '1px solid var(--color-border)',
              borderRadius: '6px'
            }}
          >
            <table
              style={{
                width: '100%',
                borderCollapse: 'collapse',
                fontSize: '12.5px',
                textAlign: 'left'
              }}
            >
              <thead>
                <tr
                  style={{
                    background: 'var(--color-card-bg)',
                    borderBottom: '1px solid var(--color-border)'
                  }}
                >
                  {headers.map((h, colIdx) => (
                    <th
                      key={`th-${colIdx}`}
                      style={{
                        padding: '8px 12px',
                        fontWeight: 600,
                        color: 'var(--color-text-title)',
                        textAlign: alignments[colIdx] || 'left'
                      }}
                    >
                      {parseInlineMarkdown(h, `${key}-th-${colIdx}`)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, rowIdx) => (
                  <tr
                    key={`tr-${rowIdx}`}
                    style={{
                      borderBottom:
                        rowIdx === rows.length - 1 ? 'none' : '1px solid var(--color-border)',
                      background: rowIdx % 2 === 1 ? 'rgba(255, 255, 255, 0.01)' : 'transparent'
                    }}
                  >
                    {row.map((cell, colIdx) => (
                      <td
                        key={`td-${rowIdx}-${colIdx}`}
                        style={{
                          padding: '8px 12px',
                          color: 'var(--color-text)',
                          textAlign: alignments[colIdx] || 'left',
                          whiteSpace: 'normal',
                          wordBreak: 'break-word'
                        }}
                      >
                        {parseInlineMarkdown(cell, `${key}-td-${rowIdx}-${colIdx}`)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
        continue
      } else {
        // Fallback: it's not a valid table (e.g. only 1 line).
        // Render it as a normal text line and continue, consuming the line.
        const fallbackKey = `${blockKey}-tbl-fallback-${i}`
        blocks.push(
          <div key={fallbackKey} style={{ minHeight: '1.2em', lineHeight: '1.5', margin: '4px 0' }}>
            {parseInlineMarkdown(tableLines[0], fallbackKey)}
          </div>
        )
        continue
      }
    }

    // 3. Unordered List Items: e.g. "- Item" or "* Item"
    const listMatch = trimmed.match(/^([-*])\s+(.*)$/)
    if (listMatch) {
      const listKey = `${blockKey}-ul-${i}`
      const listItems: string[] = []
      while (i < lines.length) {
        const nextTrimmed = lines[i].trim()
        const match = nextTrimmed.match(/^([-*])\s+(.*)$/)
        if (match) {
          listItems.push(match[2])
          i++
        } else {
          break
        }
      }
      blocks.push(
        <div
          key={listKey}
          style={{ display: 'flex', flexDirection: 'column', gap: '4px', margin: '6px 0' }}
        >
          {listItems.map((item, itemIdx) => {
            const itemKey = `${listKey}-item-${itemIdx}`
            return (
              <div
                key={itemKey}
                style={{
                  display: 'flex',
                  gap: '8px',
                  paddingLeft: '12px',
                  alignItems: 'flex-start'
                }}
              >
                <span
                  style={{ color: 'var(--color-primary)', userSelect: 'none', lineHeight: '1.4' }}
                >
                  •
                </span>
                <span style={{ flex: 1, lineHeight: '1.4' }}>
                  {parseInlineMarkdown(item, itemKey)}
                </span>
              </div>
            )
          })}
        </div>
      )
      continue
    }

    // 4. Ordered List Items: e.g. "1. Item"
    const ordListMatch = trimmed.match(/^(\d+)\.\s+(.*)$/)
    if (ordListMatch) {
      const listKey = `${blockKey}-ol-${i}`
      const listItems: { num: string; content: string }[] = []
      while (i < lines.length) {
        const nextTrimmed = lines[i].trim()
        const match = nextTrimmed.match(/^(\d+)\.\s+(.*)$/)
        if (match) {
          listItems.push({ num: match[1], content: match[2] })
          i++
        } else {
          break
        }
      }
      blocks.push(
        <div
          key={listKey}
          style={{ display: 'flex', flexDirection: 'column', gap: '4px', margin: '6px 0' }}
        >
          {listItems.map((item, itemIdx) => {
            const itemKey = `${listKey}-item-${itemIdx}`
            return (
              <div
                key={itemKey}
                style={{
                  display: 'flex',
                  gap: '8px',
                  paddingLeft: '12px',
                  alignItems: 'flex-start'
                }}
              >
                <span
                  style={{
                    color: 'var(--color-primary)',
                    fontWeight: 500,
                    userSelect: 'none',
                    lineHeight: '1.4'
                  }}
                >
                  {item.num}.
                </span>
                <span style={{ flex: 1, lineHeight: '1.4' }}>
                  {parseInlineMarkdown(item.content, itemKey)}
                </span>
              </div>
            )
          })}
        </div>
      )
      continue
    }

    // 5. Plain Paragraph: group consecutive plain lines together
    const paraKey = `${blockKey}-p-${i}`
    const paraLines: string[] = []
    while (i < lines.length) {
      const nextTrimmed = lines[i].trim()
      if (!nextTrimmed) break
      if (
        nextTrimmed.match(/^(#{1,6})\s+/) ||
        nextTrimmed.match(/^([-*])\s+/) ||
        nextTrimmed.match(/^(\d+)\.\s+/) ||
        (nextTrimmed.startsWith('|') && nextTrimmed.endsWith('|'))
      ) {
        break
      }
      paraLines.push(lines[i])
      i++
    }

    blocks.push(
      <div
        key={paraKey}
        style={{ display: 'flex', flexDirection: 'column', gap: '2px', margin: '4px 0' }}
      >
        {paraLines.map((pLine, pIdx) => {
          const lineKey = `${paraKey}-l-${pIdx}`
          return (
            <div key={lineKey} style={{ minHeight: '1.2em', lineHeight: '1.5' }}>
              {parseInlineMarkdown(pLine, lineKey)}
            </div>
          )
        })}
      </div>
    )
  }

  return (
    <div key={blockKey} style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
      {blocks}
    </div>
  )
}

// Custom text formatter
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
              return (
                <span key={`inline-blk-${bIdx}`}>
                  {inlineParts.map((inlinePart, iIdx) => {
                    if (inlinePart.startsWith('$') && inlinePart.endsWith('$')) {
                      const math = inlinePart.slice(1, -1)
                      return renderMath(math, false, `math-i-${iIdx}`)
                    } else if (inlinePart.startsWith('\\(') && inlinePart.endsWith('\\)')) {
                      const math = inlinePart.slice(2, -2)
                      return renderMath(math, false, `math-i-${iIdx}`)
                    } else {
                      // Split by inline code `...`
                      const codeParts = inlinePart.split(/(`[^`\n]+`)/g)
                      return (
                        <span key={`code-parts-${iIdx}`}>
                          {codeParts.map((codePart, cIdx) => {
                            if (codePart.startsWith('`') && codePart.endsWith('`')) {
                              return (
                                <code
                                  key={`code-i-${cIdx}`}
                                  style={{
                                    background: 'var(--color-inline-code-bg)',
                                    padding: '2px 4px',
                                    borderRadius: '4px',
                                    fontFamily: 'Consolas, monospace',
                                    fontSize: '12px',
                                    color: '#f43f5e'
                                  }}
                                >
                                  {codePart.slice(1, -1)}
                                </code>
                              )
                            }
                            return parseBlockMarkdown(codePart, `block-md-${cIdx}`)
                          })}
                        </span>
                      )
                    }
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
