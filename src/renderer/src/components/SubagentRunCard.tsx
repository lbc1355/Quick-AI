import React from 'react'
import {
  Loader2,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  AlertCircle,
  ExternalLink
} from 'lucide-react'
import { SubagentInnerEvent } from '../../../shared/types'

export interface SubagentRunState {
  info: {
    type: 'subagent_start'
    subagentId: string
    parentToolCallId: string
    label: string
    task: string
    tools?: string[]
    maxSteps: number
  }
  events: SubagentInnerEvent[]
  status: 'running' | 'completed' | 'failed' | 'cancelled' | 'max_steps'
  finalAnswer?: string
  error?: string
  durationMs?: number
}

interface SubagentRunCardProps {
  subagent: SubagentRunState
  onClick: () => void
}

export const SubagentRunCard: React.FC<SubagentRunCardProps> = ({ subagent, onClick }) => {
  const { info, status } = subagent

  const getStatusIcon = (): React.ReactNode => {
    switch (status) {
      case 'running':
        return (
          <Loader2
            className="agent-subagent-status-spinner"
            size={13}
            style={{
              color: 'var(--color-primary)'
            }}
          />
        )
      case 'completed':
        return <CheckCircle2 size={13} style={{ color: 'var(--color-status-success, #10b981)' }} />
      case 'failed':
        return <XCircle size={13} style={{ color: 'var(--color-danger, #ef4444)' }} />
      case 'max_steps':
        return <AlertTriangle size={13} style={{ color: 'var(--color-warning, #f59e0b)' }} />
      case 'cancelled':
        return <AlertCircle size={13} style={{ color: 'var(--color-text-muted, #737d89)' }} />
      default:
        return null
    }
  }

  const getStatusText = (): string => {
    switch (status) {
      case 'running':
        return '执行中...'
      case 'completed':
        return '已完成'
      case 'failed':
        return '失败'
      case 'max_steps':
        return '步数超限'
      case 'cancelled':
        return '已取消'
      default:
        return ''
    }
  }

  return (
    <button
      type="button"
      className={`agent-subagent-card ${status}`}
      onClick={onClick}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '8px',
        padding: '5px 10px',
        background: 'var(--color-card-bg)',
        border: '1px solid var(--color-border)',
        borderRadius: '6px',
        cursor: 'pointer',
        fontSize: '12px',
        color: 'var(--color-text)',
        maxWidth: '100%',
        textAlign: 'left',
        transition: 'all 0.15s ease',
        boxShadow: '0 1px 2px rgba(0, 0, 0, 0.05)',
        margin: '4px 0'
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = 'var(--color-primary)'
        e.currentTarget.style.background =
          'color-mix(in srgb, var(--color-primary) 5%, var(--color-card-bg))'
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = 'var(--color-border)'
        e.currentTarget.style.background = 'var(--color-card-bg)'
      }}
      title="查看子 Agent 进度"
    >
      <span
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: '11px',
          background: 'color-mix(in srgb, var(--color-primary) 10%, transparent)',
          color: 'var(--color-primary)',
          padding: '1px 5px',
          borderRadius: '4px',
          fontWeight: 500
        }}
      >
        {info.label}
      </span>

      <span
        style={{
          flex: '1 1 auto',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          maxWidth: '380px'
        }}
      >
        {info.task}
      </span>

      <span
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '4px',
          color: 'var(--color-text-muted)',
          fontSize: '11px',
          marginLeft: '4px'
        }}
      >
        {getStatusIcon()}
        <span>{getStatusText()}</span>
      </span>

      <ExternalLink
        size={12}
        style={{ color: 'var(--color-text-muted)', marginLeft: '2px', opacity: 0.7 }}
      />
    </button>
  )
}
