export const MODEL_CONTEXT_SIZES: Record<string, number> = {
  'deepseek-chat': 64000,
  'deepseek-reasoner': 64000,
  'moonshot-v1-8k': 8000,
  'moonshot-v1-32k': 32000,
  'moonshot-v1-128k': 128000,
  'gpt-4o': 128000,
  'gpt-4o-mini': 128000
}

export const DEFAULT_CONTEXT_SIZE = 128000

export type ContextWindowSource = 'configured' | 'model-name' | 'default'

export interface ContextWindowInfo {
  tokens: number
  source: ContextWindowSource
}

export function getContextWindowInfo(modelName: string): ContextWindowInfo {
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
    if (tokens >= 2000 && tokens <= 10000000) {
      return { tokens, source: 'model-name' }
    }
  }

  return { tokens: DEFAULT_CONTEXT_SIZE, source: 'default' }
}

export function getContextWindowSize(modelName: string): number {
  return getContextWindowInfo(modelName).tokens
}
