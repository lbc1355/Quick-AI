import { ChatCompletionMessage, ToolArgs } from '../../shared/types'
import { ToolRegistryView } from '../tools/registryView'
import { evaluateToolGuard, DEFAULT_CONSTITUTION } from './constitution'
import { LoopGuard } from './loopGuard'
import { isToolCallConcurrencySafe } from '../tools/toolConcurrency'

export type ToolPermission = 'allow' | 'ask' | 'deny'
export type ToolCallClassification = 'ask' | 'direct' | 'blocked'
export type RawToolCall = NonNullable<ChatCompletionMessage['tool_calls']>[number]

export interface PreparedToolCall {
  index: number
  toolCall: RawToolCall
  toolName: string
  callId: string
  args: ToolArgs
  purpose?: string
  permission: ToolPermission
  isValid: boolean
  isDeadlock: boolean
  /** Set when the loop guard blocks this call; answered with this message, never executed. */
  loopBlock?: string
  /** Set when a guardrail escalates/blocks this call; surfaced to the model on block. */
  blockReason?: string
  classification: ToolCallClassification
  /** Safe calls may overlap only other safe calls; exclusive calls are ordering barriers. */
  concurrencySafe?: boolean
}

export interface PreparedToolCallGroups {
  prepared: PreparedToolCall[]
  askCalls: PreparedToolCall[]
  directCalls: PreparedToolCall[]
  blockedCalls: PreparedToolCall[]
}

export const getShellApprovalCommand = (
  toolName: string,
  toolArgs: ToolArgs
): string | undefined => {
  if (toolName === 'shell' && typeof toolArgs.command === 'string') return toolArgs.command
  return undefined
}

export const getFetchUrlCallKey = (toolArgs: ToolArgs): string | undefined => {
  const url = typeof toolArgs.url === 'string' ? toolArgs.url : ''
  if (!url) return undefined

  const rawOffset = typeof toolArgs.offset === 'number' ? toolArgs.offset : 0
  const rawMaxChars = typeof toolArgs.maxChars === 'number' ? toolArgs.maxChars : undefined
  const offset = Number.isFinite(rawOffset) ? Math.max(0, Math.floor(rawOffset)) : 0
  const maxChars =
    rawMaxChars !== undefined && Number.isFinite(rawMaxChars)
      ? Math.min(16000, Math.max(1000, Math.floor(rawMaxChars)))
      : 'default'
  const mode = toolArgs.render === true ? 'rendered' : 'static'

  return `fetch_url:${url}:mode=${mode}:offset=${offset}:maxChars=${maxChars}`
}

export function prepareToolCalls(input: {
  toolCalls: RawToolCall[]
  permissions?: Record<string, ToolPermission>
  isToolWhitelisted: (toolName: string) => boolean
  isToolApproved: (toolName: string) => boolean
  isCommandPrefixApproved: (command: string) => boolean
  hasExecuted: (callKey: string) => boolean
  loopGuard: LoopGuard
  projectRoot?: string
  additionalRoots?: string[]
  toolRegistry: ToolRegistryView
}): PreparedToolCallGroups {
  const seenFetchCallsThisTurn = new Set<string>()

  const prepared = input.toolCalls.map((toolCall, index): PreparedToolCall => {
    const toolName = toolCall.function.name
    const callId = toolCall.id
    const permission = input.permissions?.[toolName] || 'allow'

    let args: ToolArgs = {}
    try {
      args = JSON.parse(toolCall.function.arguments) as ToolArgs
    } catch {
      console.warn('Failed to parse tool call arguments:', toolCall.function.arguments)
    }

    const purpose = typeof args.purpose === 'string' ? args.purpose : undefined
    if (purpose !== undefined) {
      delete args.purpose
    }

    const toolDef = input.toolRegistry.get(toolName)
    const isValid = !!toolDef && toolDef.implemented && input.isToolWhitelisted(toolName)

    let effectivePermission = permission
    let blockReason: string | undefined
    if (isValid && permission !== 'deny' && toolDef) {
      const runApproved = input.isToolApproved(toolName)
      const verdict = evaluateToolGuard(
        toolName,
        args,
        permission,
        toolDef.risk,
        DEFAULT_CONSTITUTION,
        runApproved,
        { projectRoot: input.projectRoot, additionalRoots: input.additionalRoots }
      )
      effectivePermission = verdict.action
      if (verdict.action !== permission && verdict.reason) {
        blockReason = verdict.reason
      }
    }

    if (effectivePermission === 'ask') {
      const shellApprovalCommand = getShellApprovalCommand(toolName, args)
      // workspace_add_root expands the trusted-root set, so a blanket run/session tool approval
      // must never auto-allow it — every call surfaces a fresh confirmation.
      if (input.isToolApproved(toolName) && toolName !== 'workspace_add_root') {
        effectivePermission = 'allow'
      } else if (shellApprovalCommand && input.isCommandPrefixApproved(shellApprovalCommand)) {
        effectivePermission = 'allow'
      }
    }

    let isDeadlock = false
    if (isValid && effectivePermission !== 'deny' && toolName === 'fetch_url') {
      const callKey = getFetchUrlCallKey(args)
      if (callKey) {
        if (input.hasExecuted(callKey) || seenFetchCallsThisTurn.has(callKey)) {
          isDeadlock = true
        } else {
          seenFetchCallsThisTurn.add(callKey)
        }
      }
    }

    let classification: ToolCallClassification
    let loopBlock: string | undefined
    if (isDeadlock) {
      classification = 'direct'
    } else if (!isValid || effectivePermission === 'deny') {
      classification = 'blocked'
    } else {
      const repeat = input.loopGuard.recordCall(input.loopGuard.signature(toolName, args))
      if (repeat.blocked) {
        loopBlock = `Loop guard: "${toolName}" has been called with identical arguments ${repeat.count} times in this run. The previous result still applies; do not repeat this call. Use that result, change the arguments, or try a different approach.`
        classification = 'direct'
      } else if (effectivePermission === 'ask') {
        classification = 'ask'
      } else {
        classification = 'direct'
      }
    }

    const concurrencySafe = !!toolDef && isValid && isToolCallConcurrencySafe(toolDef, args)

    return {
      index,
      toolCall,
      toolName,
      callId,
      args,
      purpose,
      permission: effectivePermission,
      isValid,
      isDeadlock,
      loopBlock,
      blockReason,
      classification,
      concurrencySafe
    }
  })

  return {
    prepared,
    askCalls: prepared.filter((p) => p.classification === 'ask'),
    directCalls: prepared.filter((p) => p.classification === 'direct'),
    blockedCalls: prepared.filter((p) => p.classification === 'blocked')
  }
}
