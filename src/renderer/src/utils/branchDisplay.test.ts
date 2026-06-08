import { describe, expect, it } from 'vitest'
import { getBranchDisplayInfo, shortBranchRunId } from './branchDisplay'

describe('shortBranchRunId', () => {
  it('keeps short run ids unchanged', () => {
    expect(shortBranchRunId('abc123')).toBe('abc123')
  })

  it('trims long run ids to eight characters', () => {
    expect(shortBranchRunId('1234567890abcdef')).toBe('12345678')
  })

  it('returns undefined for empty run ids', () => {
    expect(shortBranchRunId('  ')).toBeUndefined()
  })
})

describe('getBranchDisplayInfo', () => {
  it('returns null when there is no branch reference', () => {
    expect(getBranchDisplayInfo(undefined, [])).toBeNull()
  })

  it('resolves the source session title and run label', () => {
    const info = getBranchDisplayInfo(
      { sessionId: 'source-1', messageId: 'msg-1', runId: 'run-123456789' },
      [{ id: 'source-1', title: 'Original task' }]
    )

    expect(info).toMatchObject({
      sourceSessionId: 'source-1',
      sourceMessageId: 'msg-1',
      sourceTitle: 'Original task',
      shortRunId: 'run-1234',
      sourceLabel: 'Original task · run run-1234',
      sourceExists: true
    })
  })

  it('uses a fallback title when the source session is missing', () => {
    const info = getBranchDisplayInfo({ sessionId: 'missing', messageId: 'msg-1' }, [], '源会话')

    expect(info).toMatchObject({
      sourceTitle: '源会话',
      sourceLabel: '源会话',
      sourceExists: false
    })
  })
})
