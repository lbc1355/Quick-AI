import { ChatCompletionMessage } from '../../shared/types'
import {
  ACTION_HISTORY_RESUME_LIMIT,
  cloneMessagesForCheckpoint as defaultCloneMessagesForCheckpoint
} from './resumePrompts'
import { AmbiguousAction, saveRunCheckpoint as defaultSaveRunCheckpoint } from './runCheckpoint'
import { appendRunCheckpoint as defaultAppendRunCheckpoint } from './runManifest'

export interface PersistAgentRunCheckpointDependencies {
  saveRunCheckpoint?: typeof defaultSaveRunCheckpoint
  appendRunCheckpoint?: typeof defaultAppendRunCheckpoint
  cloneMessagesForCheckpoint?: typeof defaultCloneMessagesForCheckpoint
  warn?: typeof console.warn
}

export interface PersistAgentRunCheckpointOptions {
  conversationId: string
  reqId: string
  step: number
  messages: ChatCompletionMessage[]
  activeTools: Iterable<string>
  lastCompletedCallId?: string
  ambiguousActions: AmbiguousAction[]
  dependencies?: PersistAgentRunCheckpointDependencies
}

export function persistAgentRunCheckpoint(options: PersistAgentRunCheckpointOptions): void {
  const dependencies = options.dependencies || {}
  const saveRunCheckpoint = dependencies.saveRunCheckpoint || defaultSaveRunCheckpoint
  const appendRunCheckpoint = dependencies.appendRunCheckpoint || defaultAppendRunCheckpoint
  const cloneMessagesForCheckpoint =
    dependencies.cloneMessagesForCheckpoint || defaultCloneMessagesForCheckpoint
  const warn = dependencies.warn || console.warn

  try {
    saveRunCheckpoint({
      sessionId: options.conversationId,
      reqId: options.reqId,
      step: options.step,
      messages: cloneMessagesForCheckpoint(options.messages),
      activeTools: Array.from(options.activeTools),
      lastCompletedCallId: options.lastCompletedCallId,
      ambiguousActions: options.ambiguousActions.slice(-ACTION_HISTORY_RESUME_LIMIT)
    })
    appendRunCheckpoint(options.conversationId, options.reqId, options.reqId)
  } catch (err) {
    warn('Failed to save run checkpoint:', (err as Error).message)
  }
}
