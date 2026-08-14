import React from 'react'
import { renderMessageContent } from '../../utils/messageFormat'

const getSystemGeneratedProgressText = (message: string): string | null => {
  const clean = message.trim()
  const match = clean.match(/^准备(?:调用|执行)\s+\d+\s*个工具[：:]\s*(.+?)[。.]?$/)
  if (!match) return null
  return `即将调用工具：${match[1].trim()}`
}

export const StepProgressMessage: React.FC<{ message: string }> = ({ message }) => {
  const systemText = getSystemGeneratedProgressText(message)

  if (systemText) {
    return (
      <div className="agent-step-progress-message system-generated">
        <span className="system-progress-label">系统进度</span>
        <span>{systemText}</span>
      </div>
    )
  }

  return <div className="agent-step-progress-message">{renderMessageContent(message)}</div>
}
