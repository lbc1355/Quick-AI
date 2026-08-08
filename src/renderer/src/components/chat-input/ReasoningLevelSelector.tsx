import React, { useEffect, useId, useRef, useState } from 'react'
import { Brain, Check, ChevronDown } from 'lucide-react'
import type { ModelReasoningControl, ReasoningPreference } from '../../../../shared/types'
import { getAvailableReasoningPreferences } from '../../../../shared/reasoningControl'

const LABELS: Record<ReasoningPreference, string> = {
  auto: '自动',
  off: '关闭',
  on: '开启',
  minimal: '极低',
  low: '低',
  medium: '中',
  high: '高',
  xhigh: '极高',
  max: '最大'
}

export interface ReasoningLevelSelectorProps {
  control?: ModelReasoningControl
  value: ReasoningPreference
  onChange: (value: ReasoningPreference) => void
  disabled?: boolean
  showNextRequestHint?: boolean
}

export const ReasoningLevelSelector: React.FC<ReasoningLevelSelectorProps> = ({
  control,
  value,
  onChange,
  disabled,
  showNextRequestHint
}) => {
  const options = getAvailableReasoningPreferences(control)
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const listId = useId()

  useEffect(() => {
    if (!open) return

    const onPointerDown = (event: MouseEvent): void => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false)
    }

    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  useEffect(() => {
    if (disabled) setOpen(false)
  }, [disabled])

  if (!control || control.mode === 'fixed' || options.length <= 1) {
    return null
  }

  const title = showNextRequestHint ? '思考强度（仅影响下一次请求）' : '思考强度'

  return (
    <div className="reasoning-level-selector" ref={rootRef}>
      <button
        type="button"
        className={`reasoning-level-trigger${open ? ' open' : ''}`}
        title={title}
        aria-label="思考强度"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
      >
        <Brain size={13} className="reasoning-level-icon" aria-hidden />
        <span className="reasoning-level-value">{LABELS[value]}</span>
        <ChevronDown size={12} className="reasoning-level-caret" aria-hidden />
      </button>

      {open ? (
        <div className="reasoning-level-menu" role="listbox" id={listId} aria-label="思考强度">
          <div className="reasoning-level-menu-header">思考强度</div>
          <div className="reasoning-level-menu-list">
            {options.map((option) => {
              const selected = option === value
              return (
                <button
                  key={option}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  className={`reasoning-level-option${selected ? ' selected' : ''}`}
                  onClick={() => {
                    onChange(option)
                    setOpen(false)
                  }}
                >
                  <span>{LABELS[option]}</span>
                  {selected ? (
                    <Check size={14} className="reasoning-level-check" aria-hidden />
                  ) : null}
                </button>
              )
            })}
          </div>
          {showNextRequestHint ? (
            <div className="reasoning-level-menu-footer">仅影响下一次请求</div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
