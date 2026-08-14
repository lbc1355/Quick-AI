import { useEffect, useState } from 'react'
import type { ReactElement } from 'react'

interface StepReasoningBlockProps {
  reasoning: string
  autoOpen?: boolean
  autoStateKey?: string
}

export const StepReasoningBlock = ({
  reasoning,
  autoOpen = false,
  autoStateKey
}: StepReasoningBlockProps): ReactElement | null => {
  const [isOpen, setIsOpen] = useState(autoOpen)

  useEffect(() => {
    setIsOpen(autoOpen)
  }, [autoOpen, autoStateKey])

  if (!reasoning.trim()) return null

  return (
    <details
      className="agent-step-reasoning"
      open={autoOpen || isOpen}
      onToggle={(event) => setIsOpen(event.currentTarget.open)}
    >
      <summary>思考</summary>
      <div className="agent-step-reasoning-content">{reasoning}</div>
    </details>
  )
}
