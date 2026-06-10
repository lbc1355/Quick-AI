import { describe, it, expect } from 'vitest'
import {
  buildToolDirectorySummary,
  prepareChatAgentMessages,
  buildDateLine,
  buildSkillMessages
} from './messageBuilder'

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

describe('buildDateLine', () => {
  it('renders a date-level (not clock-level) anchor with weekday', () => {
    // 2026-06-08 is a Monday.
    const line = buildDateLine(new Date('2026-06-08T15:42:00'))
    expect(line).toContain('2026-06-08')
    expect(line).toContain('Monday')
    // Must not leak a clock time into the stable prefix.
    expect(line).not.toMatch(/\d{1,2}:\d{2}/)
  })

  it('is stable across different times of the same day (cache-friendly)', () => {
    const morning = buildDateLine(new Date('2026-06-08T08:00:00'))
    const evening = buildDateLine(new Date('2026-06-08T23:00:00'))
    expect(morning).toBe(evening)
  })
})

describe('prepareChatAgentMessages date injection', () => {
  it('injects the current date into the system prompt', () => {
    const msgs = prepareChatAgentMessages([{ role: 'user', content: 'hi' }])
    const system = msgs.find((m) => m.role === 'system')
    expect(system).toBeDefined()
    expect(system!.content as string).toContain('Current date:')
  })

  it('injects the platform hint into the system prompt', () => {
    const msgs = prepareChatAgentMessages([{ role: 'user', content: 'hi' }])
    const system = msgs.find((m) => m.role === 'system')
    expect(system).toBeDefined()
    expect(system!.content as string).toContain('Platform:')
  })
})

describe('buildSkillMessages package files', () => {
  it('includes installed folder files alongside SKILL.md', () => {
    const msgs = buildSkillMessages({
      apiUrl: 'https://api.example.com',
      apiKey: 'key',
      model: 'test-model',
      skill: {
        id: 'skill-folder',
        name: 'Folder Skill',
        trigger: 'folder',
        prompt: 'Use the helper script.',
        rawMarkdown: '# Folder Skill\n\nUse the helper script.',
        source: 'folder',
        entryPath: 'SKILL.md',
        packageFiles: [
          { path: 'SKILL.md', content: '# Folder Skill\n\nUse the helper script.', size: 39 },
          { path: 'scripts/helper.py', content: 'print("helper")', size: 15 }
        ]
      },
      userInput: 'run it'
    })

    const userContent = msgs.find((m) => m.role === 'user')!.content as string
    expect(userContent).toContain('Installed SKILL.md')
    expect(userContent).toContain('Installed skill package files')
    expect(userContent).toContain('Path: scripts/helper.py')
    expect(userContent).toContain('print("helper")')
    expect(userContent.match(/Path: SKILL\.md/g)).toBeNull()
  })
})

describe('prepareChatAgentMessages memory capability hint', () => {
  it('describes the on-disk memory library and its read/write tools', () => {
    const msgs = prepareChatAgentMessages([{ role: 'user', content: 'hi' }])
    const content = msgs.find((m) => m.role === 'system')!.content as string
    expect(content).toContain('Memory Lifecycle')
    expect(content).toContain('read_memory')
    expect(content).toContain('write_memory')
    expect(content).toContain('list_memory')
    expect(content).toContain('On-Demand Memory')
  })
})

describe('prepareChatAgentMessages environment awareness hint', () => {
  it('tells the agent to probe the machine and consult memory', () => {
    const msgs = prepareChatAgentMessages([{ role: 'user', content: 'hi' }])
    const content = msgs.find((m) => m.role === 'system')!.content as string
    expect(content).toContain('Environment & machine awareness')
    expect(content).toContain('inspect_environment')
    // The concrete Windows encoding lesson that motivated this feature.
    expect(content).toContain('GBK')
    expect(content).toContain('Never persist secrets')
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

  it('describes the operation/cache layer and its tools as a base capability', () => {
    const msgs = prepareChatAgentMessages([{ role: 'user', content: 'hi' }])
    const content = msgs.find((m) => m.role === 'system')!.content as string
    // The two-track framing
    expect(content).toContain('Operation history')
    // The tools that access the operation layer are named in the first system message
    expect(content).toContain('list_past_actions')
    expect(content).toContain('get_past_action')
    expect(content).toContain('read_cached_resource')
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
    const userMsg = msgs.find((m) => m.role === 'user')
    expect(userMsg).toBeDefined()
    expect(userMsg!.content as string).toContain('CONTEXT INFO')
    expect(userMsg!.content as string).toContain('hi')
  })

  it('places the resource summary inside the latest user message (cache-friendly tail)', () => {
    const msgs = prepareChatAgentMessages(
      [
        { role: 'user', content: 'q1' },
        { role: 'assistant', content: 'a1' },
        { role: 'user', content: 'q2 (current)' }
      ],
      undefined,
      [
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
      ]
    )
    const latestUserMsg = msgs[msgs.length - 1]
    expect(latestUserMsg).toBeDefined()
    expect(latestUserMsg.role).toBe('user')
    expect(latestUserMsg.content as string).toContain('CONTEXT INFO')
    expect(latestUserMsg.content as string).toContain('q2 (current)')
  })
})
