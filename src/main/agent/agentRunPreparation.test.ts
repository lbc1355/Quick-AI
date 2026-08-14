import { describe, expect, it, vi } from 'vitest'

import { ChatCompletionMessage } from '../../shared/types'
import { ActionLog } from './actionLog'
import { prepareAgentRun } from './agentRunPreparation'
import { RunCheckpoint } from './runCheckpoint'

vi.mock('electron', () => ({
  app: {
    getPath: () => 'test-user-data'
  }
}))

const createActionLog = vi.fn(() => new ActionLog())

describe('prepareAgentRun', () => {
  it('prepares a dynamic free-chat run with directory and resource tools active', () => {
    const chatMessages: ChatCompletionMessage[] = [
      { role: 'system', content: 'prepared' },
      { role: 'user', content: 'hello' }
    ]

    const result = prepareAgentRun({
      reqId: 'req-1',
      options: {
        apiUrl: 'https://api.example.com',
        apiKey: 'key',
        model: 'model',
        messages: [{ role: 'user', content: 'hello' }],
        sessionId: 'session-1',
        resources: [
          {
            id: 'res-1',
            kind: 'web',
            source: 'https://example.com',
            status: 'complete',
            title: 'Example',
            chunks: [],
            createdAt: 1,
            updatedAt: 1
          }
        ]
      },
      dependencies: {
        createActionLog,
        prepareChatAgentMessages: () => chatMessages,
        searchToolDefinitions: () => [
          {
            name: 'file_read',
            title: 'Read',
            description: 'Read files',
            category: 'file',
            risk: 'low',
            permission: 'allow'
          },
          {
            name: 'web_search',
            title: 'Search',
            description: 'Search web',
            category: 'web',
            risk: 'low',
            permission: 'allow'
          }
        ]
      }
    })

    expect(result.isSkill).toBe(false)
    expect(result.toolDiscovery).toBe('dynamic')
    expect(result.maxSteps).toBe(Infinity)
    expect(result.conversationId).toBe('session-1')
    expect(result.toolScope).toBe('all')
    expect(result.skillTools).toEqual([])
    expect(result.messages).toBe(chatMessages)
    expect(result.initialActiveTools).toEqual([
      'search_tools',
      'file_read',
      'web_search',
      'list_cached_resources',
      'read_cached_resource',
      'search_cached_resource'
    ])
    expect(result.resumeLoadError).toBeUndefined()
    expect(createActionLog).toHaveBeenCalledWith('session-1')
  })

  it('prepares a static skill run with clamped max steps and resource tools in scope', () => {
    const skillMessages: ChatCompletionMessage[] = [{ role: 'user', content: 'skill request' }]

    const result = prepareAgentRun({
      reqId: 'req-2',
      options: {
        apiUrl: 'https://api.example.com',
        apiKey: 'key',
        model: 'model',
        userInput: 'run skill',
        resources: [
          {
            id: 'res-1',
            kind: 'web',
            source: 'https://example.com',
            status: 'complete',
            chunks: [],
            createdAt: 1,
            updatedAt: 1
          }
        ],
        skill: {
          id: 'skill-1',
          name: 'Skill',
          trigger: 'skill',
          prompt: 'do it',
          tools: ['file_read'],
          toolDiscovery: 'static',
          maxSteps: 99
        }
      },
      dependencies: {
        createActionLog,
        buildSkillMessages: () => skillMessages,
        searchToolDefinitions: () => []
      }
    })

    expect(result.isSkill).toBe(true)
    expect(result.toolDiscovery).toBe('static')
    expect(result.maxSteps).toBe(30)
    expect(result.skillTools).toEqual([
      'file_read',
      'list_cached_resources',
      'read_cached_resource',
      'search_cached_resource'
    ])
    expect(result.initialActiveTools).toEqual(result.skillTools)
    expect(result.toolScope).toBeInstanceOf(Set)
    expect(Array.from(result.toolScope as Set<string>)).toEqual(result.skillTools)
    expect(result.messages).toBe(skillMessages)
  })

  it('loads a resume checkpoint and uses messages directly without injecting a resume prompt', () => {
    const checkpoint: RunCheckpoint = {
      version: 1,
      sessionId: 'source-session',
      reqId: 'old-run',
      updatedAt: 1,
      step: 4,
      messages: [{ role: 'user', content: 'original request' }],
      activeTools: ['file_read'],
      ambiguousActions: [
        {
          callId: 'call-1',
          toolName: 'shell',
          args: { command: 'npm install' },
          reason: 'interrupted',
          timestamp: 1
        }
      ]
    }

    const result = prepareAgentRun({
      reqId: 'req-3',
      options: {
        apiUrl: 'https://api.example.com',
        apiKey: 'key',
        model: 'model',
        sessionId: 'target-session',
        resumeSourceSessionId: 'source-session',
        resumeFromRunId: 'old-run'
      },
      dependencies: {
        createActionLog,
        loadRunCheckpoint: () => checkpoint,
        searchToolDefinitions: () => []
      }
    })

    expect(result.resumeCheckpoint).toBe(checkpoint)
    expect(result.resumeLoadError).toBeUndefined()
    expect(result.messages).toEqual([{ role: 'user', content: 'original request' }])
    expect(result.initialActiveTools).toEqual(['search_tools', 'file_read'])
    expect(result.ambiguousActions).toEqual(checkpoint.ambiguousActions)
  })

  it('returns a resume load error when the requested checkpoint is missing', () => {
    const result = prepareAgentRun({
      reqId: 'req-4',
      options: {
        apiUrl: 'https://api.example.com',
        apiKey: 'key',
        model: 'model',
        resumeFromRunId: 'missing-run'
      },
      dependencies: {
        createActionLog,
        loadRunCheckpoint: () => undefined,
        searchToolDefinitions: () => []
      }
    })

    expect(result.resumeCheckpoint).toBeUndefined()
    expect(result.messages).toEqual([])
    expect(result.resumeLoadError).toContain('No resumable checkpoint found for run missing-run')
  })
})
