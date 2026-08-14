import React from 'react'
import { Sparkles } from 'lucide-react'

interface GenerationStatsProps {
  generationDurationText: string | null
  tokenSpeed: number | undefined
  cacheHitRateText: string | null
}

export const GenerationStats = React.memo<GenerationStatsProps>(
  ({ generationDurationText, tokenSpeed, cacheHitRateText }) => {
    if (!generationDurationText && tokenSpeed === undefined && !cacheHitRateText) {
      return null
    }

    return (
      <div
        className="msg-generation-stats"
        style={{
          fontSize: 'var(--font-size-xs)',
          color: 'var(--color-text-muted)',
          marginTop: '8px',
          display: 'flex',
          alignItems: 'center',
          gap: '4px',
          opacity: 0.7
        }}
      >
        <Sparkles size={10} style={{ color: 'var(--color-status-success)' }} />
        {generationDurationText && <span>{generationDurationText}</span>}
        {tokenSpeed !== undefined && (
          <>
            {generationDurationText && <span>·</span>}
            <span>{tokenSpeed} token/s</span>
          </>
        )}
        {cacheHitRateText && (
          <>
            {(generationDurationText || tokenSpeed !== undefined) && <span>·</span>}
            <span>{cacheHitRateText}</span>
          </>
        )}
      </div>
    )
  }
)

GenerationStats.displayName = 'GenerationStats'
