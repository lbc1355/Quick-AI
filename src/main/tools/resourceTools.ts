import { ToolDefinition } from './types'
import { cachedResourceTools } from './cachedResourceTools'
import { resourceSearchTools } from './resourceSearchTools'
import { toolOutputTools } from './toolOutputTools'

export const resourceTools: Record<string, ToolDefinition> = {
  ...cachedResourceTools,
  ...resourceSearchTools,
  ...toolOutputTools
}
