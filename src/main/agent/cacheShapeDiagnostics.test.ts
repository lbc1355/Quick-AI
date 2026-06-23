import { describe, expect, it, beforeEach } from 'vitest'
import { ChatCompletionMessage, ChatToolDeclaration } from '../../shared/types'
import {
  captureCacheShape,
  commitCacheShapeForSession,
  compareCacheShape,
  previewCacheShapeForSession,
  resetCacheShapeDiagnosticsForTests
} from './cacheShapeDiagnostics'

const tool = (name: string): ChatToolDeclaration => ({
  type: 'function',
  function: {
    name,
    description: `${name} tool`,
    parameters: { type: 'object', properties: { path: { type: 'string' } } }
  }
})

const baseMessages = (): ChatCompletionMessage[] => [
  { role: 'system', content: 'stable system' },
  { role: 'user', content: 'task 1' }
]

describe('cache shape diagnostics', () => {
  beforeEach(() => {
    resetCacheShapeDiagnosticsForTests()
  })

  it('normalizes tool declaration order before hashing', () => {
    const first = captureCacheShape({
      messages: baseMessages(),
      toolsToDeclare: [tool('file_read'), tool('shell')]
    })
    const second = captureCacheShape({
      messages: baseMessages(),
      toolsToDeclare: [tool('shell'), tool('file_read')]
    })

    expect(first.toolsHash).toBe(second.toolsHash)
    expect(first.prefixHash).toBe(second.prefixHash)
  })

  it('treats append-only message growth as cache-stable', () => {
    const previous = captureCacheShape({
      messages: [
        ...baseMessages(),
        {
          role: 'assistant',
          content: '',
          tool_calls: [
            { id: 'call-1', type: 'function', function: { name: 'file_read', arguments: '{}' } }
          ]
        },
        { role: 'tool', tool_call_id: 'call-1', name: 'file_read', content: 'result' }
      ],
      toolsToDeclare: [tool('file_read')],
      contextRetentionMode: 'cache-priority'
    })
    const current = captureCacheShape({
      messages: [
        ...baseMessages(),
        {
          role: 'assistant',
          content: '',
          tool_calls: [
            { id: 'call-1', type: 'function', function: { name: 'file_read', arguments: '{}' } }
          ]
        },
        { role: 'tool', tool_call_id: 'call-1', name: 'file_read', content: 'result' },
        { role: 'assistant', content: 'done' },
        { role: 'user', content: 'task 2' }
      ],
      toolsToDeclare: [tool('file_read')],
      contextRetentionMode: 'cache-priority'
    })

    expect(compareCacheShape(previous, current)).toMatchObject({
      prefixChanged: false,
      prefixChangeReasons: [],
      appendOnlyFromPrevious: true,
      contentAppendOnlyFromPrevious: true,
      firstDifferentMessageIndex: 4,
      addedMessageCount: 2
    })
  })

  it('reports message content changes when roles are unchanged but text is rewritten', () => {
    const previous = captureCacheShape({
      messages: [
        ...baseMessages(),
        { role: 'assistant', content: 'answer 1' },
        { role: 'user', content: 'task 2' }
      ]
    })
    const current = captureCacheShape({
      messages: [
        ...baseMessages(),
        { role: 'assistant', content: 'changed answer' },
        { role: 'user', content: 'task 2' }
      ]
    })

    expect(compareCacheShape(previous, current)).toMatchObject({
      prefixChanged: true,
      prefixChangeReasons: ['message_content'],
      appendOnlyFromPrevious: true,
      contentAppendOnlyFromPrevious: false,
      firstDifferentMessageIndex: 2
    })
  })
  it('reports message shape changes when history is rewritten or trimmed', () => {
    const previous = captureCacheShape({
      messages: [
        ...baseMessages(),
        { role: 'assistant', content: 'answer 1' },
        { role: 'user', content: 'task 2' }
      ]
    })
    const current = captureCacheShape({
      messages: [
        { role: 'system', content: 'stable system' },
        { role: 'user', content: 'task 2' }
      ]
    })

    expect(compareCacheShape(previous, current).prefixChangeReasons).toContain('message_shape')
  })

  it('reports duplicated tool call ids beyond the normal assistant/tool pair', () => {
    const current = captureCacheShape({
      messages: [
        ...baseMessages(),
        {
          role: 'assistant',
          content: '',
          tool_calls: [
            { id: 'call-1', type: 'function', function: { name: 'file_read', arguments: '{}' } }
          ]
        },
        { role: 'tool', tool_call_id: 'call-1', name: 'file_read', content: 'result' },
        { role: 'tool', tool_call_id: 'call-1', name: 'file_read', content: 'duplicated' }
      ]
    })

    expect(compareCacheShape(undefined, current)).toMatchObject({
      prefixChanged: true,
      prefixChangeReasons: ['tool_call_duplication'],
      duplicateToolCallIds: ['call-1']
    })
  })

  it('tracks previous shapes by session for preview and commit', () => {
    const previous = captureCacheShape({ messages: baseMessages() })
    const current = captureCacheShape({
      messages: [
        { role: 'system', content: 'changed system' },
        { role: 'user', content: 'task' }
      ]
    })

    expect(previewCacheShapeForSession('s1', previous).prefixChanged).toBe(false)
    commitCacheShapeForSession('s1', previous)
    expect(previewCacheShapeForSession('s1', current).prefixChangeReasons).toEqual(['system'])
  })
})
