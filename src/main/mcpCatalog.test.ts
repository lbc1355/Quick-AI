import type { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { describe, expect, it, vi } from 'vitest'

import {
  getMcpErrorMessage,
  listAllMcpTools,
  type McpToolInfo,
  toMcpModelToolName
} from './mcpCatalog'

const mcpTool = (name: string): McpToolInfo => ({
  name,
  description: name + ' description',
  inputSchema: { type: 'object' as const, properties: {} }
})

describe('mcpCatalog', () => {
  it('collects every tools/list page in order', async () => {
    const listTools = vi
      .fn()
      .mockResolvedValueOnce({ tools: [mcpTool('first')], nextCursor: 'page-2' })
      .mockResolvedValueOnce({ tools: [mcpTool('second')] })
    const client = { listTools } as unknown as Client

    await expect(listAllMcpTools(client, 321)).resolves.toEqual([
      mcpTool('first'),
      mcpTool('second')
    ])
    expect(listTools).toHaveBeenNthCalledWith(1, undefined, { timeout: 321 })
    expect(listTools).toHaveBeenNthCalledWith(2, { cursor: 'page-2' }, { timeout: 321 })
  })

  it('rejects a repeated tools/list cursor', async () => {
    const listTools = vi
      .fn()
      .mockResolvedValueOnce({ tools: [], nextCursor: 'same' })
      .mockResolvedValueOnce({ tools: [], nextCursor: 'same' })
    const client = { listTools } as unknown as Client

    await expect(listAllMcpTools(client, 100)).rejects.toThrow('duplicate cursor: same')
  })

  it('keeps valid names and deterministically sanitizes invalid or long names', () => {
    expect(toMcpModelToolName('git', 'status')).toBe('mcp_git_status')

    const sanitized = toMcpModelToolName('server.with spaces', 'tool/' + 'x'.repeat(80))
    expect(sanitized).toMatch(/^[a-zA-Z0-9_-]+$/)
    expect(sanitized.length).toBeLessThanOrEqual(64)
    expect(toMcpModelToolName('server.with spaces', 'tool/' + 'x'.repeat(80))).toBe(sanitized)
  })

  it('extracts protocol-level MCP tool errors', () => {
    expect(
      getMcpErrorMessage({
        isError: true,
        content: [
          { type: 'text', text: 'remote failure' },
          { type: 'image', data: 'ignored' }
        ]
      })
    ).toBe('remote failure')
    expect(getMcpErrorMessage({ isError: false, content: [] })).toBeUndefined()
    expect(getMcpErrorMessage({ isError: true, content: [] })).toBe('MCP tool returned an error')
  })
})
