import React from 'react'
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
  if (!control || control.mode === 'fixed' || options.length <= 1) {
    return null
  }

  return (
    <div className="reasoning-level-selector" title="思考强度">
      <label className="reasoning-level-label">
        <span>思考强度</span>
        <select
          value={value}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value as ReasoningPreference)}
          aria-label="思考强度"
        >
          {options.map((option) => (
            <option key={option} value={option}>
              {LABELS[option]}
            </option>
          ))}
        </select>
      </label>
      {showNextRequestHint ? <span className="reasoning-level-hint">仅影响下一次请求</span> : null}
    </div>
  )
}
