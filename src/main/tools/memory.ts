import { ToolDefinition } from './types'
import { memoryActionTools } from './memoryActionTools'
import { memoryReadTools } from './memoryReadTools'
import { memoryWriteTools } from './memoryWriteTools'

export const memoryTools: Record<string, ToolDefinition> = {
  ...memoryActionTools,
  ...memoryReadTools,
  ...memoryWriteTools
}
