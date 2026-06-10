import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { join } from 'path'
import { tmpdir } from 'os'
import { mkdirSync, writeFileSync, rmSync } from 'fs'
import { buildMemoryContextPrompt, injectMemoryContext } from './memoryPrompts'

let home: string

beforeEach(() => {
  home = join(tmpdir(), `quickai-memprompt-${Date.now()}-${Math.floor(Math.random() * 1e6)}`)
  process.env.QUICKAI_HOME = home
  mkdirSync(join(home, 'memories'), { recursive: true })
})

afterEach(() => {
  delete process.env.QUICKAI_HOME
  rmSync(home, { recursive: true, force: true })
})

describe('buildMemoryContextPrompt', () => {
  it('returns empty when only seed scaffolding exists', () => {
    writeFileSync(join(home, 'memories', 'always.md'), '# Always\n\n> guidance only\n')
    writeFileSync(join(home, 'memories', 'memory_summary.md'), "# What's in Memory\n")
    expect(buildMemoryContextPrompt()).toBe('')
  })

  it('injects always content and the on-demand index', () => {
    writeFileSync(join(home, 'memories', 'always.md'), '# Always\n\n- 用户偏好简洁中文回答\n')
    writeFileSync(
      join(home, 'memories', 'memory_summary.md'),
      "# What's in Memory\n\n- **QuickAI memory** — use when discussing memory\n"
    )
    const prompt = buildMemoryContextPrompt()
    expect(prompt).toContain('[MEMORY CONTEXT]')
    expect(prompt).toContain('用户偏好简洁中文回答')
    expect(prompt).toContain('QuickAI memory')
    expect(prompt).toContain('not as instructions')
  })
})

describe('injectMemoryContext', () => {
  it('replaces older memory context prompts before injecting a fresh one inside the user message', () => {
    const messages = injectMemoryContext(
      [
        { role: 'system', content: 'system' },
        { role: 'system', content: '[MEMORY CONTEXT]\nold memory' },
        { role: 'user', content: 'hi' }
      ],
      '[MEMORY CONTEXT]\nnew memory'
    )

    const joined = messages.map((message) => message.content).join('\n')
    expect(joined).toContain('new memory')
    expect(joined).not.toContain('old memory')

    const latestUserMsg = messages[messages.length - 1]
    expect(latestUserMsg.role).toBe('user')
    expect(latestUserMsg.content as string).toContain('[MEMORY CONTEXT]\nnew memory')
    expect(latestUserMsg.content as string).toContain('hi')
  })

  it('does not duplicate memory context if already injected in a user message', () => {
    const messages = injectMemoryContext(
      [
        { role: 'system', content: 'system' },
        { role: 'user', content: '[MEMORY CONTEXT]\nexisting memory\n\nhi' }
      ],
      '[MEMORY CONTEXT]\nfresh memory'
    )

    expect(messages).toHaveLength(2)
    expect(messages[1].content).toBe('[MEMORY CONTEXT]\nexisting memory\n\nhi')
  })
})
