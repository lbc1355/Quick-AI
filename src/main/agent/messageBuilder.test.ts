import { describe, it, expect } from 'vitest'
import { buildToolDirectorySummary, prepareChatAgentMessages } from './messageBuilder'

describe('buildToolDirectorySummary', () => {
  it('produces a non-empty summary for the full tool registry', () => {
    const summary = buildToolDirectorySummary('all')
    expect(typeof summary).toBe('string')
    expect(summary.length).toBeGreaterThan(0)
    expect(summary).toContain('Available tools')
    // Core user-facing tools are listed
    expect(summary).toContain('fetch_url')
    // search_tools is intentionally non-discoverable — the directory removes the need for it
    expect(summary).not.toContain('search_tools')
  })

  it('filters to a provided scope', () => {
    const summary = buildToolDirectorySummary(new Set(['web_search', 'fetch_url']))
    expect(summary).toContain('web_search')
    expect(summary).toContain('fetch_url')
    // Should NOT include tools outside the scope
    expect(summary).not.toContain('file_read')
  })

  it('filters denied tools', () => {
    const summary = buildToolDirectorySummary('all', { web_search: 'deny' })
    expect(summary).toContain('fetch_url')
    expect(summary).not.toContain('web_search')
  })

  it('stays within the budget cap', () => {
    const summary = buildToolDirectorySummary('all')
    expect(summary.length).toBeLessThanOrEqual(2200) // budget + some overhead
  })
})

describe('prepareChatAgentMessages tool directory injection', () => {
  it('injects the tool directory and drops mandatory search_tools', () => {
    const msgs = prepareChatAgentMessages([{ role: 'user', content: 'hi' }], undefined, undefined, {
      web_search: 'deny'
    })

    const system = msgs.find((m) => m.role === 'system')
    expect(system).toBeDefined()
    const content = system!.content as string

    // Should contain the tool directory
    expect(content).toContain('Available tools')
    // Should NOT require search_tools first
    expect(content).not.toContain('you must first search')
    // Should mention direct access
    expect(content).toContain('You may call them directly')
    // search_tools is still available
    expect(content).toContain('search_tools')
    // Denied tools are omitted
    expect(content).not.toContain('web_search')
  })

  it('works without permissions', () => {
    const msgs = prepareChatAgentMessages(
      [{ role: 'user', content: 'test' }],
      'custom system prompt'
    )
    const system = msgs.find((m) => m.role === 'system')
    const content = system!.content as string
    expect(content).toContain('custom system prompt')
    expect(content).toContain('Available tools')
  })

  it('injects resource context when provided', () => {
    const msgs = prepareChatAgentMessages([{ role: 'user', content: 'hi' }], 'test', [
      {
        id: 'abc123',
        kind: 'web',
        source: 'https://example.com',
        title: 'Test Resource',
        status: 'complete',
        chunks: [{ id: 'c1', offset: 0, endOffset: 10, text: 'hello test', createdAt: 1 }],
        createdAt: 1,
        updatedAt: 2
      }
    ])
    const systemMsgs = msgs.filter((m) => m.role === 'system')
    expect(systemMsgs.length).toBeGreaterThanOrEqual(2)
    const resourceSys = systemMsgs.find(
      (m) => typeof m.content === 'string' && m.content.includes('CONTEXT INFO')
    )
    expect(resourceSys).toBeDefined()
  })
})
