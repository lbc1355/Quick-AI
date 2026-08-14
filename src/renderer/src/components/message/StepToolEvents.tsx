import React, { useState } from 'react'
import { AlertCircle, ChevronRight } from 'lucide-react'
import type { ParsedAgentStep, ParsedToolCall } from '../../utils/messageFormat'
import { formatToolArgsSummary } from './toolDisplay'

const getToolEventVerb = (toolCall: ParsedToolCall): string => {
  if (toolCall.status === 'failed') return 'Failed'
  if (toolCall.status === 'denied') return 'Denied'
  if (toolCall.status === 'pending') return 'Waiting'
  if (toolCall.status === 'running') return 'Running'

  const name = toolCall.toolName.toLowerCase()
  if (name.includes('search')) return 'Searched'
  if (name.includes('read') || name.includes('fetch') || name.includes('open')) return 'Read'
  if (name.includes('write') || name.includes('edit') || name.includes('patch')) return 'Edited'
  if (name.includes('list')) return 'Listed'
  if (name.includes('shell') || name.includes('command') || name.includes('run')) return 'Ran'
  return 'Used'
}

const getToolChipText = (toolCall: ParsedToolCall): string => {
  return (
    toolCall.purpose || formatToolArgsSummary(toolCall.toolName, toolCall.args) || toolCall.toolName
  )
}

const getToolFailurePreview = (toolCall: ParsedToolCall): string => {
  if (toolCall.status !== 'failed' && toolCall.status !== 'denied') return ''
  const fallback = toolCall.status === 'denied' ? 'Permission denied' : 'Tool failed'
  const text = (toolCall.error || fallback).replace(/\s+/g, ' ').trim()
  return text.length > 120 ? text.substring(0, 117) + '...' : text
}

interface ToolEventGroup {
  id: string
  verb: string
  calls: ParsedToolCall[]
}

const groupConsecutiveToolCalls = (step: ParsedAgentStep): ToolEventGroup[] => {
  const groups: ToolEventGroup[] = []

  step.toolCalls.forEach((toolCall) => {
    const verb = getToolEventVerb(toolCall)
    const latestGroup = groups[groups.length - 1]
    if (
      latestGroup &&
      latestGroup.calls[0].toolName === toolCall.toolName &&
      latestGroup.verb === verb
    ) {
      latestGroup.calls.push(toolCall)
      return
    }

    groups.push({
      id: `${step.id}-${toolCall.callId}-${verb}`,
      verb,
      calls: [toolCall]
    })
  })

  return groups
}

interface StepToolEventsProps {
  step: ParsedAgentStep
  onOpenToolDetail: (toolCall: ParsedToolCall) => void
}

export const StepToolEvents = React.memo<StepToolEventsProps>(({ step, onOpenToolDetail }) => {
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({})

  if (step.toolCalls.length === 0) return null

  const toolGroups = groupConsecutiveToolCalls(step)

  const toggleGroup = (groupId: string): void => {
    setExpandedGroups((prev) => ({
      ...prev,
      [groupId]: !prev[groupId]
    }))
  }

  const renderToolEvent = (tc: ParsedToolCall, hideName = false): React.ReactNode => {
    const isFocused = tc.status === 'running' || tc.status === 'pending'
    const failurePreview = getToolFailurePreview(tc)
    const hasFailure = Boolean(failurePreview)
    return (
      <button
        key={tc.callId}
        type="button"
        className={`agent-tool-event ${tc.status} ${isFocused ? 'focused' : ''} ${hasFailure ? 'has-failure' : ''}`}
        onClick={() => onOpenToolDetail(tc)}
        title="查看工具详情"
      >
        <span className="agent-tool-event-line">
          {hasFailure && <AlertCircle size={12} className="agent-tool-failure-icon" />}
          {!hideName && <span className="agent-tool-name">{tc.toolName}</span>}
          <span className="agent-tool-chip">{getToolChipText(tc)}</span>
          {tc.result?.readStartLine !== undefined && tc.result?.readEndLine !== undefined && (
            <span className="agent-tool-line-range">{`#L${tc.result.readStartLine}-${tc.result.readEndLine}`}</span>
          )}
          {tc.result?.addedLines !== undefined && (
            <span className="agent-tool-diff-added">{`+${tc.result.addedLines}`}</span>
          )}
          {tc.result?.removedLines !== undefined && (
            <span className="agent-tool-diff-removed">{`-${tc.result.removedLines}`}</span>
          )}
          <span className="agent-tool-verb">{getToolEventVerb(tc)}</span>
        </span>
        {failurePreview && <span className="agent-tool-failure-preview">{failurePreview}</span>}
      </button>
    )
  }

  return (
    <div className="agent-tool-events">
      {toolGroups.map((group) => {
        if (group.calls.length === 1) return renderToolEvent(group.calls[0])

        const isFocused = group.calls.some(
          (tc) => tc.status === 'running' || tc.status === 'pending'
        )
        const hasFailure = group.calls.some(
          (tc) => tc.status === 'failed' || tc.status === 'denied'
        )
        const groupStatus = hasFailure ? 'failed' : isFocused ? 'running' : 'completed'
        const isExpanded = expandedGroups[group.id] ?? isFocused
        const failedCallsCount = group.calls.filter(
          (tc) => tc.status === 'failed' || tc.status === 'denied'
        ).length

        return (
          <div key={group.id} className="agent-tool-group">
            <button
              type="button"
              className={`agent-tool-group-toggle ${groupStatus} ${isFocused ? 'focused' : ''} ${isExpanded ? 'expanded' : ''}`}
              onClick={() => toggleGroup(group.id)}
              title={isExpanded ? 'Collapse tool group' : 'Expand tool group'}
            >
              <ChevronRight size={12} className="agent-tool-group-caret" />
              {hasFailure && <AlertCircle size={12} className="agent-tool-failure-icon" />}
              <span className="agent-tool-name">{group.calls[0].toolName}</span>
              <span className="agent-tool-group-count">{group.calls.length}</span>
              {failedCallsCount > 0 && (
                <span className="agent-tool-group-failure">{failedCallsCount} failed</span>
              )}
              <span className="agent-tool-verb">{group.verb}</span>
            </button>
            {isExpanded && (
              <div className="agent-tool-group-items">
                {group.calls.map((tc) => renderToolEvent(tc, true))}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
})

StepToolEvents.displayName = 'StepToolEvents'
