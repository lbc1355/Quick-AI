import React, { useEffect, useState } from 'react'
import { Loader2, X } from 'lucide-react'

const formatElapsed = (seconds: number): string => {
  const mins = Math.floor(seconds / 60)
  const secs = seconds % 60
  return mins > 0 ? `${mins}m${secs}s` : `${secs}s`
}

/**
 * Non-intrusive /compact progress dock: a live elapsed timer plus a cancel action. Lives above the
 * composer instead of a phantom transcript message, so the conversation history and scroll
 * position stay untouched while the summary is generated.
 */
export const CompactionDock: React.FC<{
  startedAt: number
  onCancel: () => void
}> = ({ startedAt, onCancel }) => {
  const [elapsed, setElapsed] = useState(0)

  useEffect(() => {
    setElapsed(Math.max(0, Math.round((Date.now() - startedAt) / 1000)))
    const timer = window.setInterval(() => {
      setElapsed(Math.max(0, Math.round((Date.now() - startedAt) / 1000)))
    }, 1000)
    return () => window.clearInterval(timer)
  }, [startedAt])

  return (
    <div className="compaction-dock" role="status">
      <div className="compaction-dock-copy">
        <Loader2 size={14} className="animate-spin" />
        <span>正在压缩上下文… 已用时 {formatElapsed(elapsed)}</span>
      </div>
      <button type="button" onClick={onCancel} title="取消压缩">
        <X size={12} />
        取消
      </button>
    </div>
  )
}

CompactionDock.displayName = 'CompactionDock'
