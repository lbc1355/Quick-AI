import { fitReasoningPreference, normalizeReasoningPreference } from '../../shared/reasoningControl'
import type {
  ModelReasoningControl,
  ModelTransportId,
  ReasoningPreference,
  ReasoningRequestEncoding
} from '../../shared/types'

export interface ApplyReasoningRequestInput {
  body: Record<string, unknown>
  transportId: ModelTransportId
  control?: ModelReasoningControl
  requested: ReasoningPreference
  /** Optional total output token ceiling used to keep budget room for the final answer. */
  outputTokenLimit?: number
}

export interface ApplyReasoningRequestResult {
  body: Record<string, unknown>
  requested: ReasoningPreference
  effective: ReasoningPreference
  applied: boolean
  encoding?: ReasoningRequestEncoding
}

const FINAL_ANSWER_RESERVE_TOKENS = 1024

export function applyReasoningRequest(
  input: ApplyReasoningRequestInput
): ApplyReasoningRequestResult {
  const requested = normalizeReasoningPreference(input.requested)
  const effective = fitReasoningPreference(input.control, requested)
  const body = { ...input.body }

  if (effective === 'auto' || !input.control || input.control.mode === 'fixed') {
    return { body, requested, effective, applied: false }
  }

  if (input.control.mode === 'toggle') {
    if (effective === 'on') {
      applyToggle(body, input.control.encoding, true)
      return {
        body,
        requested,
        effective,
        applied: true,
        encoding: input.control.encoding
      }
    }
    if (effective === 'off' && input.control.supportsOff) {
      applyToggle(body, input.control.encoding, false)
      return {
        body,
        requested,
        effective,
        applied: true,
        encoding: input.control.encoding
      }
    }
    return { body, requested, effective: 'auto', applied: false }
  }

  if (input.control.mode === 'effort') {
    if (effective === 'off' && input.control.offValue) {
      applyEffort(body, input.control.encoding, input.transportId, input.control.offValue)
      return {
        body,
        requested,
        effective,
        applied: true,
        encoding: input.control.encoding
      }
    }
    if (effective === 'off' || effective === 'on') {
      return { body, requested, effective: 'auto', applied: false }
    }
    const mapped = input.control.levelMap?.[effective] || effective
    applyEffort(body, input.control.encoding, input.transportId, mapped)
    return {
      body,
      requested,
      effective,
      applied: true,
      encoding: input.control.encoding
    }
  }

  // budget
  if (effective === 'off') {
    if (!input.control.supportsOff) {
      return { body, requested, effective: 'auto', applied: false }
    }
    mergeReasoningObject(body, { max_tokens: 0 })
    return {
      body,
      requested,
      effective,
      applied: true,
      encoding: input.control.encoding
    }
  }
  if (effective === 'on') {
    return { body, requested, effective: 'auto', applied: false }
  }

  const rawBudget = input.control.budgets[effective]
  if (typeof rawBudget !== 'number' || !Number.isFinite(rawBudget) || rawBudget <= 0) {
    return { body, requested, effective: 'auto', applied: false }
  }

  let budget = Math.floor(rawBudget)
  if (input.control.minBudget !== undefined) {
    budget = Math.max(budget, input.control.minBudget)
  }
  if (input.control.maxBudget !== undefined) {
    budget = Math.min(budget, input.control.maxBudget)
  }
  if (input.outputTokenLimit && input.outputTokenLimit > FINAL_ANSWER_RESERVE_TOKENS) {
    budget = Math.min(budget, input.outputTokenLimit - FINAL_ANSWER_RESERVE_TOKENS)
  }
  if (budget <= 0) {
    return { body, requested, effective: 'auto', applied: false }
  }

  mergeReasoningObject(body, { max_tokens: budget })
  return {
    body,
    requested,
    effective,
    applied: true,
    encoding: input.control.encoding
  }
}

function applyToggle(
  body: Record<string, unknown>,
  encoding: Extract<ReasoningRequestEncoding, 'qwen-enable-thinking' | 'deepseek-thinking-toggle'>,
  enabled: boolean
): void {
  if (encoding === 'qwen-enable-thinking') {
    body.enable_thinking = enabled
    return
  }
  body.thinking = { type: enabled ? 'enabled' : 'disabled' }
}

function applyEffort(
  body: Record<string, unknown>,
  encoding: Extract<ReasoningRequestEncoding, 'openai-effort' | 'openrouter-reasoning'>,
  transportId: ModelTransportId,
  effort: string
): void {
  if (encoding === 'openai-effort' && transportId === 'openai-chat-completions') {
    body.reasoning_effort = effort
    return
  }
  if (encoding === 'openai-effort' && transportId === 'openai-responses') {
    const existing =
      body.reasoning && typeof body.reasoning === 'object' && !Array.isArray(body.reasoning)
        ? (body.reasoning as Record<string, unknown>)
        : {}
    mergeReasoningObject(body, {
      effort,
      ...(existing.summary === undefined ? { summary: 'auto' } : {})
    })
    return
  }
  // openrouter-reasoning (and openai-effort fallbacks that nest reasoning)
  mergeReasoningObject(body, { effort })
}

function mergeReasoningObject(body: Record<string, unknown>, patch: Record<string, unknown>): void {
  const existing =
    body.reasoning && typeof body.reasoning === 'object' && !Array.isArray(body.reasoning)
      ? { ...(body.reasoning as Record<string, unknown>) }
      : {}
  body.reasoning = { ...existing, ...patch }
}

export function isUnsupportedReasoningParameterError(message: string): boolean {
  const text = message.toLowerCase()
  return (
    text.includes('reasoning_effort') ||
    text.includes('enable_thinking') ||
    (text.includes('unknown') && text.includes('reasoning')) ||
    (text.includes('unexpected') && text.includes('thinking'))
  )
}

export const REASONING_UNSUPPORTED_USER_MESSAGE =
  '当前服务商端点不接受所选思考强度参数，请改为“自动”或检查模型兼容配置。'
