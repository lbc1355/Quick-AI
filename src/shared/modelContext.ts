export const MODEL_CONTEXT_SIZES: Record<string, number> = {
  'deepseek-chat': 64000,
  'deepseek-reasoner': 64000,
  'deepseek-v4-flash': 1000000,
  'deepseek-v4-flash-free': 200000,
  'deepseek-v4-pro': 1000000,
  'qwen3-coder-plus': 128000,
  'glm-4.5-air': 128000,
  'glm-4.5': 128000,
  'glm-4.6': 128000,
  'glm-4.7': 128000,
  'glm-5': 128000,
  'glm-4-flash': 128000,
  'moonshot-v1-8k': 8000,
  'moonshot-v1-32k': 32000,
  'moonshot-v1-128k': 128000,
  'kimi-k2-0711-preview': 128000,
  'mimo-v2.5-pro': 1000000,
  'mimo-v2.5': 1000000,
  'mimo-v2-pro': 1000000,
  'mimo-v2-flash': 128000,
  'gpt-4o': 128000,
  'gpt-4o-mini': 128000
}

export const DEFAULT_CONTEXT_SIZE = 128000
const MIN_CONTEXT_SIZE = 2000
const MAX_CONTEXT_SIZE = 10000000

export type ContextWindowSource = 'model-catalog' | 'configured' | 'model-name' | 'default'

export interface ContextWindowInfo {
  tokens: number
  source: ContextWindowSource
}

export function normalizeContextWindowTokens(value: unknown): number | undefined {
  const numericValue = typeof value === 'string' ? Number(value.trim()) : value
  if (typeof numericValue !== 'number' || !Number.isFinite(numericValue)) {
    return undefined
  }

  const tokens = Math.round(numericValue)
  if (tokens < MIN_CONTEXT_SIZE || tokens > MAX_CONTEXT_SIZE) {
    return undefined
  }
  return tokens
}

export function getContextWindowInfo(
  modelName: string,
  configuredTokens?: number
): ContextWindowInfo {
  const configured = normalizeContextWindowTokens(configuredTokens)
  if (configured) {
    return { tokens: configured, source: 'configured' }
  }

  if (!modelName) {
    return { tokens: DEFAULT_CONTEXT_SIZE, source: 'default' }
  }
  const lower = modelName.toLowerCase()

  if (MODEL_CONTEXT_SIZES[lower]) {
    return { tokens: MODEL_CONTEXT_SIZES[lower], source: 'configured' }
  }

  const sizeMatch = lower.match(/[-_](\d+)(k|m)\b/)
  if (sizeMatch) {
    const num = parseInt(sizeMatch[1], 10)
    const unit = sizeMatch[2]
    const tokens = unit === 'm' ? num * 1000000 : num * 1000
    if (normalizeContextWindowTokens(tokens)) {
      return { tokens, source: 'model-name' }
    }
  }

  return { tokens: DEFAULT_CONTEXT_SIZE, source: 'default' }
}

export function getContextWindowSize(modelName: string): number {
  return getContextWindowInfo(modelName).tokens
}
