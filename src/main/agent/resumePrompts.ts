import { ChatCompletionMessage, ToolArgs } from '../../shared/types'
import { ActionLog } from './actionLog'
import { AmbiguousAction, RunCheckpoint } from './runCheckpoint'

export const ACTION_HISTORY_RESUME_LIMIT = 12
export const RESUME_MODE_PROMPT_PREFIX = '[RESUME MODE]'

const truncateForPrompt = (value: string, maxChars: number): string => {
  if (value.length <= maxChars) return value
  return `${value.slice(0, Math.max(0, maxChars - 3))}...`
}

const compactJsonForPrompt = (value: unknown, maxChars = 220): string => {
  try {
    return truncateForPrompt(JSON.stringify(value), maxChars)
  } catch {
    return '[unserializable]'
  }
}

export const buildResumeActionHistoryPrompt = (actionLog: ActionLog): string => {
  if (actionLog.size === 0) return ''

  const actions = actionLog.list({ limit: ACTION_HISTORY_RESUME_LIMIT })
  if (actions.length === 0) return ''

  const lines = [
    '[RESUME CONTEXT]',
    'Recent tool actions already completed in this conversation are listed below. Use this before deciding whether to call tools again.',
    'Do not repeat successful reads, searches, fetches, or shell commands unless the user explicitly asked to regenerate, verify again, or the prior result is insufficient for the current request.',
    'If you need exact details for an earlier action, call get_past_action with its callId instead of repeating the original tool call.',
    '',
    `Recent actions (${actions.length} shown, newest first):`
  ]

  actions.forEach((action, index) => {
    const record = actionLog.get(action.callId)
    lines.push(
      `${index + 1}. [Turn ${action.turnIndex}] ${action.toolName} - ${action.resultStatus} (${action.durationMs}ms, ${action.resultSize} chars)`
    )
    lines.push(`   callId: ${action.callId}`)
    if (record) {
      lines.push(`   args: ${compactJsonForPrompt(record.args)}`)
    }
    lines.push(`   summary: ${truncateForPrompt(action.resultSummary.replace(/\s+/g, ' '), 260)}`)
  })

  return lines.join('\n')
}

export const injectPromptBeforeLatestUser = (
  messages: ChatCompletionMessage[],
  prompt: string
): ChatCompletionMessage[] => {
  if (!prompt) return messages
  const insertAt = Math.max(1, messages.length - 1)
  messages.splice(insertAt, 0, {
    role: 'system',
    content: prompt
  })
  return messages
}

const isResumeModePrompt = (message: ChatCompletionMessage): boolean =>
  message.role === 'system' &&
  typeof message.content === 'string' &&
  message.content.startsWith(RESUME_MODE_PROMPT_PREFIX)

export const cloneMessagesForCheckpoint = (
  messages: ChatCompletionMessage[]
): ChatCompletionMessage[] => {
  return JSON.parse(
    JSON.stringify(messages.filter((message) => !isResumeModePrompt(message)))
  ) as ChatCompletionMessage[]
}

export const buildCheckpointResumePrompt = (
  checkpoint: RunCheckpoint,
  actionLog: ActionLog
): string => {
  const lines = [
    RESUME_MODE_PROMPT_PREFIX,
    'This is an automatic continuation of the same agent task after a previous execution failure.',
    'No new user request was added. Continue the original task from the completed tool observations already present in the message history.',
    'The failed or incomplete model step was discarded. Do not restart the task and do not repeat successful actions unless verification is necessary.',
    'If a prior side-effecting action is marked ambiguous, do not run it again blindly. Inspect the current workspace/process state first, or ask the user before repeating it.',
    '',
    `Resuming from run: ${checkpoint.reqId}`,
    `Checkpoint step: ${checkpoint.step}`,
    `Last completed call: ${checkpoint.lastCompletedCallId || 'none'}`
  ]

  const ambiguousActionEntries = [
    ...(checkpoint.ambiguousActions || []),
    ...actionLog
      .list({ limit: ACTION_HISTORY_RESUME_LIMIT })
      .filter((action) => action.resultStatus === 'ambiguous')
      .map((action): AmbiguousAction => {
        const record = actionLog.get(action.callId)
        return {
          callId: action.callId,
          toolName: action.toolName,
          args: (record?.args || {}) as ToolArgs,
          reason: action.resultSummary,
          timestamp: record?.timestamp || Date.now()
        }
      })
  ]
  const ambiguousActions = Array.from(
    new Map(ambiguousActionEntries.map((action) => [action.callId, action])).values()
  )

  if (ambiguousActions.length > 0) {
    lines.push('', 'Ambiguous side-effecting actions:')
    ambiguousActions.slice(0, ACTION_HISTORY_RESUME_LIMIT).forEach((action, index) => {
      lines.push(`${index + 1}. ${action.toolName} (${action.callId})`)
      lines.push(`   args: ${compactJsonForPrompt(action.args)}`)
      lines.push(`   reason: ${truncateForPrompt(action.reason.replace(/\s+/g, ' '), 260)}`)
    })
  }

  return lines.join('\n')
}

export const buildBranchForkPrompt = (branchOf: {
  sessionId: string
  messageId: string
  runId?: string
}): string => {
  return [
    '[BRANCH MODE]',
    'This run was forked from an older point in the conversation history.',
    'The visible conversation branch starts from that older checkpoint, but the real workspace may still include side effects from later discarded or sibling runs.',
    'Do not assume files, dependencies, git state, memories, or external systems were rolled back. Inspect current state before relying on it.',
    '',
    `Fork source session: ${branchOf.sessionId}`,
    `Fork source message: ${branchOf.messageId}`,
    `Fork source run: ${branchOf.runId || 'none'}`
  ].join('\n')
}
