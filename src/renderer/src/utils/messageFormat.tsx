import React from 'react'
import katex from 'katex'
import 'katex/dist/katex.min.css'

// Parse reasoning process from either official API properties or local Ollama `<think>` tags
export const parseThinkTags = (content: string, reasoningContent?: string): { content: string; reasoning: string } => {
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

// Parse block-level markdown structures: headings, bullet lists, ordered lists, and paragraphs
const parseBlockMarkdown = (text: string, blockKey: string): React.ReactNode => {
  const lines = text.split('\n')
  return (
    <div key={blockKey} style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
      {lines.map((line, lIdx) => {
        const lineKey = `${blockKey}-line-${lIdx}`

        // 1. Headers: e.g. "### Header"
        const headerMatch = line.match(/^(#{1,6})\s+(.*)$/)
        if (headerMatch) {
          const level = headerMatch[1].length
          const title = headerMatch[2]
          const fontSize = `${22 - level * 2}px`
          const HeadingTag = `h${level}` as 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6'
          return (
            <HeadingTag key={lineKey} style={{ fontSize, fontWeight: 600, margin: '12px 0 6px 0', color: 'var(--color-text-title)', lineHeight: '1.3' }}>
              {parseInlineMarkdown(title, lineKey)}
            </HeadingTag>
          )
        }

        // 2. Unordered List Items: e.g. "- Item" or "* Item"
        const listMatch = line.match(/^([-*])\s+(.*)$/)
        if (listMatch) {
          const content = listMatch[2]
          return (
            <div key={lineKey} style={{ display: 'flex', gap: '8px', paddingLeft: '12px', alignItems: 'flex-start', margin: '2px 0' }}>
              <span style={{ color: 'var(--color-primary)', userSelect: 'none', lineHeight: '1.4' }}>•</span>
              <span style={{ flex: 1, lineHeight: '1.4' }}>{parseInlineMarkdown(content, lineKey)}</span>
            </div>
          )
        }

        // 3. Ordered List Items: e.g. "1. Item"
        const ordListMatch = line.match(/^(\d+)\.\s+(.*)$/)
        if (ordListMatch) {
          const num = ordListMatch[1]
          const content = ordListMatch[2]
          return (
            <div key={lineKey} style={{ display: 'flex', gap: '8px', paddingLeft: '12px', alignItems: 'flex-start', margin: '2px 0' }}>
              <span style={{ color: 'var(--color-primary)', fontWeight: 500, userSelect: 'none', lineHeight: '1.4' }}>{num}.</span>
              <span style={{ flex: 1, lineHeight: '1.4' }}>{parseInlineMarkdown(content, lineKey)}</span>
            </div>
          )
        }

        // 4. Plain Paragraph Line
        return (
          <div key={lineKey} style={{ minHeight: '1.2em', lineHeight: '1.5', margin: '2px 0' }}>
            {parseInlineMarkdown(line, lineKey)}
          </div>
        )
      })}
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
        <div key={`code-blk-${idx}`} className="code-block-container" style={{ margin: '8px 0', border: '1px solid var(--color-code-block-border)', borderRadius: '8px', overflow: 'hidden' }}>
          <div style={{ background: 'var(--color-code-block-header-bg)', padding: '6px 12px', fontSize: '11.5px', borderBottom: '1px solid var(--color-code-block-border)', color: 'var(--color-code-block-header-text)', display: 'flex', justifyContent: 'space-between', userSelect: 'none' }}>
            <span>{lang || 'code'}</span>
            <span style={{ cursor: 'pointer', color: 'var(--color-primary)' }} onClick={(): Promise<void> => navigator.clipboard.writeText(code)}>复制</span>
          </div>
          <pre style={{ margin: 0, padding: '10px', overflowX: 'auto', background: 'var(--color-code-block-bg)', color: 'var(--color-code-block-text)', fontFamily: 'Consolas, monospace', fontSize: '12px' }}>
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
                                <code key={`code-i-${cIdx}`} style={{ background: 'var(--color-inline-code-bg)', padding: '2px 4px', borderRadius: '4px', fontFamily: 'Consolas, monospace', fontSize: '12px', color: '#f43f5e' }}>
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
  if (type === 'model') return '#a855f7'   // Purple for switching model
  if (type === 'provider') return '#06b6d4' // Cyan for provider switching
  return '#10b981'                         // Green for prompt skills
}
