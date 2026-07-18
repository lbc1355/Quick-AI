import { createHash } from 'crypto'
import type { Client } from '@modelcontextprotocol/sdk/client/index.js'

export type McpToolInfo = Awaited<ReturnType<Client['listTools']>>['tools'][number]

const MAX_TOOL_LIST_PAGES = 1000
const MAX_MODEL_TOOL_NAME_LENGTH = 64

export async function listAllMcpTools(client: Client, timeout: number): Promise<McpToolInfo[]> {
  const tools: McpToolInfo[] = []
  const cursors = new Set<string>()
  let cursor: string | undefined

  for (let page = 0; page < MAX_TOOL_LIST_PAGES; page += 1) {
    const result = await client.listTools(cursor ? { cursor } : undefined, { timeout })
    tools.push(...result.tools)
    if (!result.nextCursor) return tools
    if (cursors.has(result.nextCursor)) {
      throw new Error('MCP tools/list returned a duplicate cursor: ' + result.nextCursor)
    }
    cursors.add(result.nextCursor)
    cursor = result.nextCursor
  }

  throw new Error('MCP tools/list exceeded ' + MAX_TOOL_LIST_PAGES + ' pages')
}

const sanitizeNameSegment = (value: string): string =>
  value.replace(/[^a-zA-Z0-9_-]/g, '_') || 'unnamed'

export function toMcpModelToolName(serverName: string, toolName: string): string {
  const raw = 'mcp_' + serverName + '_' + toolName
  const sanitized = 'mcp_' + sanitizeNameSegment(serverName) + '_' + sanitizeNameSegment(toolName)
  if (raw === sanitized && sanitized.length <= MAX_MODEL_TOOL_NAME_LENGTH) return sanitized

  const digest = createHash('sha256')
    .update(serverName + String.fromCharCode(0) + toolName)
    .digest('hex')
    .slice(0, 8)
  const prefixLength = MAX_MODEL_TOOL_NAME_LENGTH - digest.length - 1
  return sanitized.slice(0, prefixLength) + '_' + digest
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

export function getMcpErrorMessage(result: unknown): string | undefined {
  if (!isRecord(result) || result.isError !== true) return undefined
  if (Array.isArray(result.content)) {
    const text = result.content
      .flatMap((item) =>
        isRecord(item) && item.type === 'text' && typeof item.text === 'string' ? [item.text] : []
      )
      .filter((item) => item.trim())
      .join('\n\n')
    if (text) return text
  }
  return 'MCP tool returned an error'
}
