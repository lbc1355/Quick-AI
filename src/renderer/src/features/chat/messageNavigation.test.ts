import { describe, expect, it } from 'vitest'
import { buildMessageNavPreview } from './messageNavigation'

describe('buildMessageNavPreview', () => {
  it('strips markdown, code fences, links, and thinking tags', () => {
    const preview = buildMessageNavPreview(`
      <think>hidden</think>
      # Title
      [Open docs](https://example.com)
      \`\`\`ts
      const secret = true
      \`\`\`
      **visible** text
    `)

    expect(preview).toBe('Title Open docs visible text')
  })

  it('uses attached file names when the message has no text', () => {
    const preview = buildMessageNavPreview('', [
      { name: 'first.png', content: '', type: 'image/png' },
      { name: 'second.txt', content: '', type: 'text/plain' },
      { name: 'third.md', content: '', type: 'text/markdown' }
    ])

    expect(preview).toContain('first.png')
    expect(preview).toContain('second.txt')
    expect(preview).toContain('3')
  })

  it('returns a stable fallback for empty messages', () => {
    expect(buildMessageNavPreview('').trim().length).toBeGreaterThan(0)
  })
})
