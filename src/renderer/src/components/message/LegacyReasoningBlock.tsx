import React from 'react'
import { Sparkles } from 'lucide-react'

interface LegacyReasoningBlockProps {
  reasoning: string
  isThinking: boolean
  isExpanded: boolean
  onToggle: () => void
}

export const LegacyReasoningBlock = React.memo<LegacyReasoningBlockProps>(
  ({ reasoning, isThinking, isExpanded, onToggle }) => {
    return (
      <div
        className="reasoning-block"
        style={{
          marginBottom: '10px'
        }}
      >
        <div
          onClick={onToggle}
          style={{
            fontSize: 'var(--font-size-sm)',
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
              animation: isThinking ? 'spin 3s linear infinite' : 'none'
            }}
          />
          <span>
            {isThinking ? '正在思考中..' : isExpanded ? '思考过程 (收起)' : '思考过程 (展开)'}
          </span>
        </div>
        <div
          style={{
            display: isExpanded ? 'block' : 'none',
            fontSize: 'var(--font-size-sm)',
            color: 'var(--color-text-muted)',
            borderLeft: '2px solid color-mix(in srgb, var(--color-primary) 35%, transparent)',
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
          {reasoning}
        </div>
      </div>
    )
  }
)

LegacyReasoningBlock.displayName = 'LegacyReasoningBlock'
