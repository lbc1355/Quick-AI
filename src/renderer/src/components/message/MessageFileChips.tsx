import React from 'react'
import { Paperclip } from 'lucide-react'
import type { Message } from '../../../../shared/types'

export const MessageFileChips = React.memo<{ files: NonNullable<Message['files']> }>(
  ({ files }) => {
    if (files.length === 0) return null

    return (
      <div
        style={{
          display: 'flex',
          gap: '6px',
          flexWrap: 'wrap',
          marginBottom: '8px'
        }}
      >
        {files.map((f, fileIdx) => (
          <div
            key={fileIdx}
            style={{
              fontSize: 'var(--font-size-xs)',
              background: 'var(--color-overlay-soft)',
              padding: '2px 6px',
              borderRadius: '4px',
              display: 'flex',
              alignItems: 'center',
              gap: '4px'
            }}
          >
            <Paperclip size={10} />
            <span>{f.name}</span>
          </div>
        ))}
      </div>
    )
  }
)

MessageFileChips.displayName = 'MessageFileChips'
