import { describe, expect, it } from 'vitest'
import {
  buildBranchFamilyInfo,
  buildBranchChildIndex,
  getBranchDisplayInfo,
  getBranchFamilyRootId,
  getBranchSourceKey,
  shortBranchRunId
} from './branchDisplay'

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

describe('buildBranchChildIndex', () => {
  it('groups branch sessions by their source message', () => {
    const index = buildBranchChildIndex([
      {
        id: 'root',
        title: 'Root',
        messages: [{ id: 'm1', role: 'user', content: 'hi' }],
        lastActiveTime: 1
      },
      {
        id: 'branch-a',
        title: 'Branch A',
        messages: [],
        lastActiveTime: 2,
        branchOf: { sessionId: 'root', messageId: 'm1', runId: 'run-123456789' }
      }
    ])

    expect(index[getBranchSourceKey('root', 'm1')]).toEqual([
      {
        sessionId: 'branch-a',
        title: 'Branch A',
        messageCount: 0,
        lastActiveTime: 2,
        sourceRunId: 'run-123456789',
        shortRunId: 'run-1234'
      }
    ])
  })

  it('sorts branch children newest first', () => {
    const index = buildBranchChildIndex([
      {
        id: 'old',
        title: 'Old branch',
        messages: [],
        lastActiveTime: 1,
        branchOf: { sessionId: 'root', messageId: 'm1' }
      },
      {
        id: 'new',
        title: 'New branch',
        messages: [],
        lastActiveTime: 10,
        branchOf: { sessionId: 'root', messageId: 'm1' }
      }
    ])

    expect(index[getBranchSourceKey('root', 'm1')].map((child) => child.sessionId)).toEqual([
      'new',
      'old'
    ])
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

describe('getBranchFamilyRootId', () => {
  it('walks nested branch sessions back to the root conversation', () => {
    const sessions = [
      { id: 'root' },
      { id: 'branch-a', branchOf: { sessionId: 'root', messageId: 'm1' } },
      { id: 'branch-b', branchOf: { sessionId: 'branch-a', messageId: 'm2' } }
    ]

    expect(getBranchFamilyRootId('branch-b', sessions)).toBe('root')
  })

  it('keeps the current session as root when the source session is missing', () => {
    expect(
      getBranchFamilyRootId('orphan', [
        { id: 'orphan', branchOf: { sessionId: 'missing', messageId: 'm1' } }
      ])
    ).toBe('orphan')
  })
})

describe('buildBranchFamilyInfo', () => {
  it('returns the root first and labels branch members newest first', () => {
    const info = buildBranchFamilyInfo('root', [
      {
        id: 'root',
        title: 'Conversation A',
        messages: [{ id: 'm1', role: 'user', content: 'hi' }],
        lastActiveTime: 1
      },
      {
        id: 'branch-old',
        title: 'Conversation A',
        messages: [],
        lastActiveTime: 2,
        branchOf: { sessionId: 'root', messageId: 'm1', runId: 'run-old' }
      },
      {
        id: 'branch-new',
        title: 'Conversation A',
        messages: [],
        lastActiveTime: 10,
        branchOf: { sessionId: 'root', messageId: 'm1', runId: 'run-new-123456' }
      }
    ])

    expect(info?.rootTitle).toBe('Conversation A')
    expect(info?.branchCount).toBe(2)
    expect(info?.members.map((member) => member.sessionId)).toEqual([
      'root',
      'branch-new',
      'branch-old'
    ])
    expect(info?.members.map((member) => member.branchIndex)).toEqual([undefined, 1, 2])
    expect(info?.members[1]).toMatchObject({
      isRoot: false,
      sourceSessionId: 'root',
      sourceTitle: 'Conversation A',
      shortRunId: 'run-new-'
    })
  })

  it('includes nested descendants in the same family', () => {
    const info = buildBranchFamilyInfo('root', [
      { id: 'root', title: 'Root', messages: [], lastActiveTime: 1 },
      {
        id: 'branch-a',
        title: 'Branch A',
        messages: [],
        lastActiveTime: 2,
        branchOf: { sessionId: 'root', messageId: 'm1' }
      },
      {
        id: 'branch-b',
        title: 'Branch B',
        messages: [],
        lastActiveTime: 3,
        branchOf: { sessionId: 'branch-a', messageId: 'm2' }
      }
    ])

    expect(info?.members.map((member) => [member.sessionId, member.depth])).toEqual([
      ['root', 0],
      ['branch-b', 2],
      ['branch-a', 1]
    ])
  })
})
