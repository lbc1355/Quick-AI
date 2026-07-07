import React, { useMemo } from 'react'
import { AlertCircle, RefreshCw } from 'lucide-react'
import { RuntimeErrorPayload } from '../../../../shared/runtimeErrors'
import { getErrorPresentation } from '../../features/errors/runtimeErrorPresenter'

interface RuntimeErrorPanelProps {
  error: string | RuntimeErrorPayload
  onRetry: () => void
}

export const RuntimeErrorPanel: React.FC<RuntimeErrorPanelProps> = ({ error, onRetry }) => {
  const analysis = useMemo(() => getErrorPresentation(error), [error])

  return (
    <div className="runtime-error-panel">
      <div className="runtime-error-header">
        <AlertCircle className="runtime-error-icon" size={16} />
        <span className="runtime-error-title">{analysis.title}</span>
      </div>
      <div className="runtime-error-body">
        <div className="runtime-error-description">{analysis.description}</div>
        <div className="runtime-error-suggestion-box">
          <div className="runtime-error-suggestion-title">您可以尝试以下排查建议：</div>
          <ul className="runtime-error-suggestions">
            {analysis.suggestion.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ul>
        </div>
      </div>
      <div className="runtime-error-retry-row">
        <button className="runtime-error-retry-btn" type="button" onClick={onRetry}>
          <RefreshCw size={12} />
          重试并发送
        </button>
      </div>
    </div>
  )
}
