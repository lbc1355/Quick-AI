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
                        <span key={`code-parts-${iIdx}`} style={{ whiteSpace: 'pre-wrap' }}>
                          {codeParts.map((codePart, cIdx) => {
                            if (codePart.startsWith('`') && codePart.endsWith('`')) {
                              return (
                                <code key={`code-i-${cIdx}`} style={{ background: 'var(--color-inline-code-bg)', padding: '2px 4px', borderRadius: '4px', fontFamily: 'Consolas, monospace', fontSize: '12px', color: '#f43f5e' }}>
                                  {codePart.slice(1, -1)}
                                </code>
                              )
                            }
                            return codePart
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
