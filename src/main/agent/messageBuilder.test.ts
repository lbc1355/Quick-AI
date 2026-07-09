import { describe, it, expect } from 'vitest'
import { join } from 'path'
import { existsSync, promises as fs } from 'fs'
import {
  buildToolDirectorySummary,
  prepareChatAgentMessages,
  buildDateLine,
  buildSkillMessages,
  buildAvailableSkillsSummary
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
  it('keeps the general agent system prompt free of daily-changing date text', () => {
    const msgs = prepareChatAgentMessages([{ role: 'user', content: 'hi' }])
    const system = msgs.find((m) => m.role === 'system')
    expect(system).toBeDefined()
    expect(system!.content as string).not.toContain('Current date:')
  })

  it('injects the current date into skill user request context', () => {
    const msgs = buildSkillMessages({
      apiUrl: 'https://api.example.com',
      apiKey: 'key',
      model: 'test-model',
      skill: {
        id: 'skill-date',
        name: 'Date Skill',
        trigger: 'date',
        prompt: 'Use the date.',
        rawMarkdown: '# Date Skill\n\nUse the date.'
      },
      userInput: 'run it'
    })
    const user = msgs.find((m) => m.role === 'user')
    expect(user!.content as string).toContain('<date_context>')
    expect(user!.content as string).toContain('Current date:')
    expect(user!.content as string).toContain('</date_context>')
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

  it('injects installed skill summaries and points the agent at load_skill', async () => {
    const testDir = join(__dirname, '../../../temp-message-builder-skills-test')
    const originalQuickAiHome = process.env.QUICKAI_HOME
    process.env.QUICKAI_HOME = testDir

    try {
      if (existsSync(testDir)) {
        await fs.rm(testDir, { recursive: true, force: true })
      }
      const skillRoot = join(testDir, 'skill')
      await fs.mkdir(skillRoot, { recursive: true })
      const readerDir = join(skillRoot, 'reader')
      await fs.mkdir(join(readerDir, 'agents'), { recursive: true })
      await fs.writeFile(
        join(readerDir, 'SKILL.md'),
        '---\nname: Reader Skill\ntrigger: reader\ndescription: Internal reader description\n---\nReader instructions',
        'utf-8'
      )
      await fs.writeFile(
        join(readerDir, 'agents', 'quickai.yaml'),
        'interface:\n  display_name: "Reader Display"\n  short_description: "Read documents carefully"\n',
        'utf-8'
      )

      const summary = buildAvailableSkillsSummary()
      expect(summary).toContain('## Skills')
      expect(summary).toContain('@reader')
      expect(summary).toContain('Reader Display')
      expect(summary).toContain('Read documents carefully')
      expect(summary).toContain('load_skill')

      const msgs = prepareChatAgentMessages([{ role: 'user', content: '@reader analyze this' }])
      const content = msgs.find((m) => m.role === 'system')!.content as string
      expect(content).toContain('## Skills')
      expect(content).toContain('@reader')
      expect(content).toContain('call load_skill')
    } finally {
      process.env.QUICKAI_HOME = originalQuickAiHome
      if (existsSync(testDir)) {
        await fs.rm(testDir, { recursive: true, force: true })
      }
    }
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

  it('prevents duplication if globalSystemPrompt is already the system message content', () => {
    const msgs = prepareChatAgentMessages(
      [
        { role: 'system', content: 'custom system prompt' },
        { role: 'user', content: 'hi' }
      ],
      'custom system prompt'
    )
    const system = msgs.find((m) => m.role === 'system')
    const content = system!.content as string

    // Check that it contains "custom system prompt" exactly once
    const matches = content.match(/custom system prompt/g)
    expect(matches).toHaveLength(1)
    expect(content).toContain('Global system prompt:\ncustom system prompt')
  })

  it('describes the operation/cache layer and its tools as a base capability', () => {
    const msgs = prepareChatAgentMessages([{ role: 'user', content: 'hi' }])
    const content = msgs.find((m) => m.role === 'system')!.content as string
    // The two-track framing
    expect(content).toContain('Operation history')
    // The tools that access the operation layer are named in the first system message
    expect(content).toContain('list_past_actions')
    expect(content).toContain('get_past_action')
    expect(content).toContain('list_cached_resources')
    expect(content).toContain('read_cached_resource')
  })

  it('does not inject resource context into user messages when resources are provided', () => {
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
    expect(userMsg!.content).toBe('hi')
  })

  it('keeps the latest user message byte-stable when resources change', () => {
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
    expect(latestUserMsg.content).toBe('q2 (current)')
  })
})
