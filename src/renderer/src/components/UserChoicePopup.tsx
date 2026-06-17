import React, { useMemo, useState } from 'react'
import { HelpCircle } from 'lucide-react'
import { UserChoiceRequest, UserChoiceResponse } from '../../../shared/types'

interface UserChoicePopupProps {
  request: UserChoiceRequest
  onRespond: (response: UserChoiceResponse) => void
}

export const UserChoicePopup: React.FC<UserChoicePopupProps> = ({ request, onRespond }) => {
  const [customValue, setCustomValue] = useState('')
  const canSubmitCustom = request.allowCustom && customValue.trim().length > 0
  const title = request.title || '需要您选择'
  const options = useMemo(() => request.options.slice(0, 12), [request.options])

  return (
    <div className="user-choice-popup-container">
      <div className="user-choice-popup-header">
        <HelpCircle size={14} style={{ color: 'var(--color-primary)' }} />
        <span>{title}</span>
      </div>

      <div className="user-choice-popup-question">{request.question}</div>

      <div className="user-choice-options">
        {options.map((option, idx) => (
          <button
            key={option.id}
            type="button"
            className="user-choice-option"
            onClick={() =>
              onRespond({
                selectedOptionId: option.id,
                selectedLabel: option.label,
                selectedValue: option.value || option.label
              })
            }
          >
            <span className="user-choice-badge">{idx + 1}</span>
            <span className="user-choice-option-copy">
              <span className="user-choice-option-label">{option.label}</span>
              {option.description && (
                <span className="user-choice-option-desc">{option.description}</span>
              )}
            </span>
          </button>
        ))}
      </div>

      {request.allowCustom && (
        <div className="user-choice-custom-row">
          <input
            className="user-choice-custom-input"
            value={customValue}
            placeholder={request.placeholder || '输入其他选项...'}
            onChange={(event) => setCustomValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && canSubmitCustom) {
                event.preventDefault()
                onRespond({ customValue: customValue.trim() })
              }
            }}
          />
          <button
            type="button"
            className="user-choice-btn submit"
            disabled={!canSubmitCustom}
            onClick={() => onRespond({ customValue: customValue.trim() })}
          >
            提交
          </button>
        </div>
      )}

      <div className="user-choice-footer">
        <button
          type="button"
          className="user-choice-btn cancel"
          onClick={() => onRespond({ cancelled: true })}
        >
          取消
        </button>
      </div>
    </div>
  )
}
