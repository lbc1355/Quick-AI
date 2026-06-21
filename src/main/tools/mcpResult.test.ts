import { describe, expect, it } from 'vitest'
import { createMcpToolResult } from './mcpResult'

describe('mcp tool result formatter', () => {
  it('keeps MCP text, resources, and structured content visible to model and UI', () => {
    const result = createMcpToolResult({
      serverName: 'arxiv-agent',
      toolName: 'library_list',
      result: {
        content: [
          { type: 'text', text: 'Listed papers' },
          {
            type: 'resource',
            resource: {
              uri: 'file:///paper.md',
              text: 'resource part'
            }
          }
        ],
        structuredContent: {
          papers: [
            {
              id: '2601.00001',
              title: 'Example Paper'
            }
          ]
        }
      }
    })

    expect(result.resultForModel).toContain('Listed papers')
    expect(result.resultForModel).toContain('"uri": "file:///paper.md"')
    expect(result.resultForModel).toContain('"papers"')
    expect(result.resultForUi.details).toContain('resource part')
    expect(result.resultForUi.details).toContain('Example Paper')
    expect(result.resultForUi.title).toBe('MCP Tool Call: arxiv-agent / library_list')
  })
})
