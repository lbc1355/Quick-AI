

// Parse reasoning process from either official API properties or local Ollama `<think>` tags
export const parseThinkTags = (content: string, reasoningContent?: string) => {
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

// Custom text formatter
export const renderMessageContent = (text: string) => {
  if (!text) return null
  const parts = text.split(/(```[\s\S]*?```)/g)
  return parts.map((part, idx) => {
    if (part.startsWith('```')) {
      const match = part.match(/```(\w*)\n([\s\S]*?)```/)
      const lang = match ? match[1] : ''
      const code = match ? match[2] : part.slice(3, -3)
      return (
        <div key={idx} className="code-block-container" style={{ margin: '8px 0', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '8px', overflow: 'hidden' }}>
          <div style={{ background: 'rgba(255,255,255,0.03)', padding: '6px 12px', fontSize: '11.5px', borderBottom: '1px solid rgba(255,255,255,0.06)', color: '#9ca3af', display: 'flex', justifyContent: 'space-between', userSelect: 'none' }}>
            <span>{lang || 'code'}</span>
            <span style={{ cursor: 'pointer', color: '#3b82f6' }} onClick={() => navigator.clipboard.writeText(code)}>复制</span>
          </div>
          <pre style={{ margin: 0, padding: '10px', overflowX: 'auto', background: 'rgba(10,10,12,0.45)', fontFamily: 'Consolas, monospace', fontSize: '12px' }}>
            <code>{code}</code>
          </pre>
        </div>
      )
    } else {
      const formattedText = part.split(/(`[^`\n]+`)/g)
      return (
        <span key={idx} style={{ whiteSpace: 'pre-wrap' }}>
          {formattedText.map((subPart, subIdx) => {
            if (subPart.startsWith('`') && subPart.endsWith('`')) {
              return (
                <code key={subIdx} style={{ background: 'var(--color-inline-code-bg)', padding: '2px 4px', borderRadius: '4px', fontFamily: 'Consolas, monospace', fontSize: '12px', color: '#f43f5e' }}>
                  {subPart.slice(1, -1)}
                </code>
              )
            }
            return subPart
          })}
        </span>
      )
    }
  })
}

// Get the visual tag badge colors for the autocomplete triggers
export const getTriggerColor = (type: string) => {
  if (type === 'command') return '#f59e0b' // Amber/Orange for system commands
  if (type === 'delete-session') return '#ef4444' // Red for session deletion
  if (type === 'session') return '#3b82f6' // Blue for history session
  if (type === 'model') return '#a855f7'   // Purple for switching model
  if (type === 'provider') return '#06b6d4' // Cyan for provider switching
  return '#10b981'                         // Green for prompt skills
}
