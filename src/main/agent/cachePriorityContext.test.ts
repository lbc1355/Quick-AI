import { describe, expect, it } from 'vitest'
import { ChatCompletionMessage } from '../../shared/types'
import {
  extractNativeToolContextMessages,
  insertCachePriorityToolContext
} from './cachePriorityContext'
import { RunCheckpoint } from './runCheckpoint'

const checkpoint = (messages: ChatCompletionMessage[]): RunCheckpoint => ({
  version: 1,
  sessionId: 'session-1',
  reqId: 'run-1',
  updatedAt: 1,
  step: 2,
  messages,
  activeTools: []
})

describe('cache-priority native tool context', () => {
  it('extracts assistant tool_calls and following tool messages from a checkpoint', () => {
    const cp = checkpoint([
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'task 1' },
      {
        role: 'assistant',
        content: '',
        tool_calls: [
          { id: 'read-1', type: 'function', function: { name: 'file_read', arguments: '{}' } }
        ]
      },
      { role: 'tool', tool_call_id: 'read-1', name: 'file_read', content: 'read result' },
      {
        role: 'assistant',
        content: 'next tool',
        tool_calls: [
          { id: 'shell-1', type: 'function', function: { name: 'shell', arguments: '{}' } }
        ]
      },
      { role: 'tool', tool_call_id: 'shell-1', name: 'shell', content: 'shell result' }
    ])

    expect(extractNativeToolContextMessages(cp)).toEqual([
      {
        role: 'assistant',
        content: '',
        tool_calls: [
          { id: 'read-1', type: 'function', function: { name: 'file_read', arguments: '{}' } }
        ]
      },
      { role: 'tool', tool_call_id: 'read-1', name: 'file_read', content: 'read result' },
      {
        role: 'assistant',
        content: 'next tool',
        tool_calls: [
          { id: 'shell-1', type: 'function', function: { name: 'shell', arguments: '{}' } }
        ]
      },
      { role: 'tool', tool_call_id: 'shell-1', name: 'shell', content: 'shell result' }
    ])
  })

  it('inserts retained native tool context before the visible final assistant answer', () => {
    const base: ChatCompletionMessage[] = [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'task 1' },
      { role: 'assistant', content: 'final answer 1' },
      { role: 'user', content: 'task 2' }
    ]
    const cp = checkpoint([
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'task 1' },
      {
        role: 'assistant',
        content: '',
        tool_calls: [
          { id: 'read-1', type: 'function', function: { name: 'file_read', arguments: '{}' } }
        ]
      },
      { role: 'tool', tool_call_id: 'read-1', name: 'file_read', content: 'read result' }
    ])

    const merged = insertCachePriorityToolContext(base, {
      sessionId: 'session-1',
      retainedRuns: [{ runId: 'run-1', assistantMessageIndex: 2 }],
      loadRunCheckpoint: () => cp
    })

    expect(merged.map((message) => message.role)).toEqual([
      'system',
      'user',
      'assistant',
      'tool',
      'assistant',
      'user'
    ])
    expect(merged[2].tool_calls?.[0].id).toBe('read-1')
    expect(merged[3]).toMatchObject({ role: 'tool', tool_call_id: 'read-1' })
    expect(merged[4]).toEqual({ role: 'assistant', content: 'final answer 1' })
  })

  it('inserts retained context into history messages without a system prefix', () => {
    const base: ChatCompletionMessage[] = [
      { role: 'user', content: 'task 1' },
      { role: 'assistant', content: 'final answer 1' },
      { role: 'user', content: 'task 2' }
    ]
    const cp = checkpoint([
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'task 1' },
      {
        role: 'assistant',
        content: '',
        tool_calls: [
          { id: 'read-1', type: 'function', function: { name: 'file_read', arguments: '{}' } }
        ]
      },
      { role: 'tool', tool_call_id: 'read-1', name: 'file_read', content: 'read result' }
    ])

    const merged = insertCachePriorityToolContext(base, {
      sessionId: 'session-1',
      retainedRuns: [{ runId: 'run-1', assistantMessageIndex: 1 }],
      loadRunCheckpoint: () => cp
    })

    expect(merged.map((message) => message.role)).toEqual([
      'user',
      'assistant',
      'tool',
      'assistant',
      'user'
    ])
    expect(merged[1].tool_calls?.[0].id).toBe('read-1')
    expect(merged[2]).toMatchObject({ role: 'tool', tool_call_id: 'read-1' })
    expect(merged[3]).toEqual({ role: 'assistant', content: 'final answer 1' })
  })
  it('accepts retained assistant indexes from visible history when the payload has a system prefix', () => {
    const base: ChatCompletionMessage[] = [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'task 1' },
      { role: 'assistant', content: 'final answer 1' },
      { role: 'user', content: 'task 2' }
    ]
    const cp = checkpoint([
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'task 1' },
      {
        role: 'assistant',
        content: '',
        tool_calls: [
          {
            id: 'mcp-1',
            type: 'function',
            function: { name: 'mcp_codebase-memory-mcp_list_projects', arguments: '{}' }
          }
        ]
      },
      {
        role: 'tool',
        tool_call_id: 'mcp-1',
        name: 'mcp_codebase-memory-mcp_list_projects',
        content: 'mcp result'
      }
    ])

    const merged = insertCachePriorityToolContext(base, {
      sessionId: 'session-1',
      retainedRuns: [{ runId: 'run-1', assistantMessageIndex: 1 }],
      loadRunCheckpoint: () => cp
    })

    expect(merged.map((message) => message.role)).toEqual([
      'system',
      'user',
      'assistant',
      'tool',
      'assistant',
      'user'
    ])
    expect(merged[2].tool_calls?.[0].function.name).toBe('mcp_codebase-memory-mcp_list_projects')
    expect(merged[3]).toMatchObject({ role: 'tool', tool_call_id: 'mcp-1' })
  })
  it('does not re-extract retained native tool context inherited from older runs', () => {
    const cp = checkpoint([
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'task 1' },
      {
        role: 'assistant',
        content: 'old tool',
        tool_calls: [
          { id: 'old-1', type: 'function', function: { name: 'file_read', arguments: '{}' } }
        ]
      },
      { role: 'tool', tool_call_id: 'old-1', name: 'file_read', content: 'old result' },
      { role: 'assistant', content: 'final answer 1' },
      { role: 'user', content: 'task 2' },
      {
        role: 'assistant',
        content: 'current tool',
        tool_calls: [
          {
            id: 'mcp-1',
            type: 'function',
            function: { name: 'mcp_codebase-memory-mcp_search_graph', arguments: '{}' }
          }
        ]
      },
      {
        role: 'tool',
        tool_call_id: 'mcp-1',
        name: 'mcp_codebase-memory-mcp_search_graph',
        content: 'current mcp result'
      },
      { role: 'assistant', content: 'final answer 2' }
    ])

    expect(extractNativeToolContextMessages(cp)).toEqual([
      {
        role: 'assistant',
        content: 'current tool',
        tool_calls: [
          {
            id: 'mcp-1',
            type: 'function',
            function: { name: 'mcp_codebase-memory-mcp_search_graph', arguments: '{}' }
          }
        ]
      },
      {
        role: 'tool',
        tool_call_id: 'mcp-1',
        name: 'mcp_codebase-memory-mcp_search_graph',
        content: 'current mcp result'
      }
    ])
  })

  it('keeps image_read tool context before synthetic visual attachment user messages', () => {
    const cp = checkpoint([
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'task with image' },
      {
        role: 'assistant',
        content: '',
        tool_calls: [
          { id: 'image-1', type: 'function', function: { name: 'image_read', arguments: '{}' } }
        ]
      },
      { role: 'tool', tool_call_id: 'image-1', name: 'image_read', content: 'image result' },
      {
        role: 'user',
        content: [{ type: 'text', text: 'Visual context from image_read: image result' }] as any
      },
      {
        role: 'assistant',
        content: '',
        tool_calls: [
          { id: 'read-1', type: 'function', function: { name: 'file_read', arguments: '{}' } }
        ]
      },
      { role: 'tool', tool_call_id: 'read-1', name: 'file_read', content: 'read result' }
    ])

    expect(extractNativeToolContextMessages(cp).map((message) => message.role)).toEqual([
      'assistant',
      'tool',
      'assistant',
      'tool'
    ])
    expect(extractNativeToolContextMessages(cp)[0].tool_calls?.[0].function.name).toBe('image_read')
  })
})
