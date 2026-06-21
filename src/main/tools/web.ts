import { ToolDefinition } from './types'
import { webFetchTool } from './webFetchTool'
import { webPageTools } from './webPageTools'
import { webSearchTool } from './webSearchTool'

export const webTools: Record<string, ToolDefinition> = {
  fetch_url: webFetchTool,
  ...webPageTools,
  web_search: webSearchTool
}
