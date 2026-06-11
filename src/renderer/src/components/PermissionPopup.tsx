import React from 'react'
import { Terminal } from 'lucide-react'
import { PopupOption, getPopupOptions, getArgsText } from '../utils/autocompleteHelpers'

interface PendingPermission {
  msgId: string
  agentRunId: string
  callId: string
  toolName: string
  args: unknown
}

interface PermissionPopupProps {
  pending: PendingPermission
  selectedOptionIndex: number
  onResponse: (
    payload:
      | boolean
      | {
          approved: boolean
          scope?: 'prefix' | 'tool'
          prefix?: string
          prefixes?: string[]
          tool?: string
        }
  ) => void
}

export const PermissionPopup: React.FC<PermissionPopupProps> = ({
  pending,
  selectedOptionIndex,
  onResponse
}) => {
  const argsText = getArgsText(pending.toolName, pending.args)
  const options: PopupOption[] = getPopupOptions(pending)

  return (
    <div className="permission-popup-container">
      <div className="permission-popup-header">
        <Terminal size={14} style={{ color: 'var(--color-primary)' }} />
        <span>是否允许执行此工具？</span>
      </div>

      {argsText && (
        <div className="permission-popup-code">
          {pending.toolName} {argsText}
        </div>
      )}

      <div className="permission-popup-options">
        {options.map((opt, idx) => (
          <div
            key={idx}
            className={`permission-popup-option ${selectedOptionIndex === idx ? 'selected' : ''}`}
            onClick={() => onResponse(opt.payload)}
          >
            <span className="permission-popup-badge">{idx + 1}</span>
            <span>{opt.label}</span>
          </div>
        ))}
      </div>

      <div className="permission-popup-footer">
        <button
          className="permission-popup-btn skip"
          onClick={() => {
            const denyOption = options.find((o) => {
              if (typeof o.payload === 'boolean') return !o.payload
              return !o.payload.approved
            })
            onResponse(denyOption ? denyOption.payload : false)
          }}
        >
          Skip
        </button>
        <button
          className="permission-popup-btn submit"
          onClick={() => {
            if (options[selectedOptionIndex]) {
              onResponse(options[selectedOptionIndex].payload)
            }
          }}
        >
          Submit
        </button>
      </div>
    </div>
  )
}
