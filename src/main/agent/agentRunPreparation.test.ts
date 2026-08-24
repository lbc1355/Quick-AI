import { describe, expect, it, vi } from 'vitest'

import { ChatCompletionMessage } from '../../shared/types'
import { ActionLog } from './actionLog'
import { prepareAgentRun } from './agentRunPreparation'
import {
  createModelRequestContextPolicy,
  createModelRequestRecord,
  type ModelRequestJournalRecord
} from './modelRequestRecord'
import { RunCheckpoint } from './runCheckpoint'

vi.mock('electron', () => ({
  app: {
    getPath: () => 'test-user-data'
  }
}))

const createActionLog = vi.fn(() => new ActionLog())

const createPendingRequest = (): ModelRequestJournalRecord =>
  createModelRequestRecord({
    runId: 'old-run',
    sessionId: 'source-session',
    contextEpoch: 2,
    step: 5,
    stepId: 'old-run:step:5',
    modelConfig: {
      apiUrl: 'https://api.example.com',
      apiKey: 'secret',
      model: 'model'
    },
    messages: [
      { role: 'user', content: 'original request' },
      { role: 'assistant', content: 'I will inspect the file.' },
      { role: 'tool', tool_call_id: 'call-1', content: 'latest durable tool result' }
    ],
    tools: [
      {
        type: 'function',
        function: {
          name: 'file_edit',
          description: 'Edit a file',
          parameters: { type: 'object', properties: {} }
        }
      }
    ],
    requestedReasoningPreference: 'auto',
    effectiveReasoningPreference: 'auto',
    contextPolicy: createModelRequestContextPolicy({
      contextWindowTokens: 32_000,
      beforeMessages: [{ role: 'user', content: 'original request' }],
      afterMessages: [{ role: 'user', content: 'original request' }],
      compactedStaleToolResults: 0,
      compactedStaleToolResultChars: 0
    }),
    capturedAt: 10
  })

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

  it('prefers a verified pending request over an older checkpoint when resuming', () => {
    const checkpoint: RunCheckpoint = {
      version: 1,
      sessionId: 'source-session',
      reqId: 'old-run',
      updatedAt: 1,
      step: 4,
      messages: [{ role: 'user', content: 'older checkpoint' }],
      activeTools: ['file_read'],
      ambiguousActions: []
    }
    const pendingRequest = createPendingRequest()

    const result = prepareAgentRun({
      reqId: 'req-resume',
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
        loadAgentEventJournal: () => ({
          version: 1,
          runId: 'old-run',
          sessionId: 'source-session',
          status: 'interrupted',
          events: [],
          latestModelRequest: pendingRequest,
          lastSequence: 0,
          startedAt: 1,
          updatedAt: 2
        }),
        searchToolDefinitions: () => []
      }
    })

    expect(result.resumeRequestRecord).toBe(pendingRequest)
    expect(result.messages).toEqual(pendingRequest.payload?.messages)
    expect(result.messages).not.toBe(pendingRequest.payload?.messages)
    expect(result.initialActiveTools).toEqual(['search_tools', 'file_read', 'file_edit'])
  })

  it('resumes from a verified pending request even when no checkpoint was written', () => {
    const pendingRequest = createPendingRequest()

    const result = prepareAgentRun({
      reqId: 'req-resume',
      options: {
        apiUrl: 'https://api.example.com',
        apiKey: 'key',
        model: 'model',
        resumeFromRunId: 'old-run'
      },
      dependencies: {
        createActionLog,
        loadRunCheckpoint: () => undefined,
        loadAgentEventJournal: () => ({
          version: 1,
          runId: 'old-run',
          sessionId: 'source-session',
          status: 'interrupted',
          events: [],
          latestModelRequest: pendingRequest,
          lastSequence: 0,
          startedAt: 1,
          updatedAt: 2
        }),
        searchToolDefinitions: () => []
      }
    })

    expect(result.resumeCheckpoint).toBeUndefined()
    expect(result.resumeLoadError).toBeUndefined()
    expect(result.messages).toEqual(pendingRequest.payload?.messages)
  })

  it('ignores a tampered pending request instead of replaying it', () => {
    const tamperedRequest = createPendingRequest()
    tamperedRequest.payload!.messages[0].content = 'tampered'

    const result = prepareAgentRun({
      reqId: 'req-resume',
      options: {
        apiUrl: 'https://api.example.com',
        apiKey: 'key',
        model: 'model',
        resumeFromRunId: 'old-run'
      },
      dependencies: {
        createActionLog,
        loadRunCheckpoint: () => undefined,
        loadAgentEventJournal: () => ({
          version: 1,
          runId: 'old-run',
          sessionId: 'source-session',
          status: 'interrupted',
          events: [],
          latestModelRequest: tamperedRequest,
          lastSequence: 0,
          startedAt: 1,
          updatedAt: 2
        }),
        searchToolDefinitions: () => []
      }
    })

    expect(result.resumeRequestRecord).toBeUndefined()
    expect(result.messages).toEqual([])
    expect(result.resumeLoadError).toContain('No resumable checkpoint found')
  })

  it('refuses exact reconstruction when the selected model no longer matches', () => {
    const pendingRequest = createPendingRequest()

    const result = prepareAgentRun({
      reqId: 'req-resume',
      options: {
        apiUrl: 'https://api.example.com',
        apiKey: 'key',
        model: 'different-model',
        resumeFromRunId: 'old-run'
      },
      dependencies: {
        createActionLog,
        loadRunCheckpoint: () => undefined,
        loadAgentEventJournal: () => ({
          version: 1,
          runId: 'old-run',
          sessionId: 'source-session',
          status: 'interrupted',
          events: [],
          latestModelRequest: pendingRequest,
          lastSequence: 0,
          startedAt: 1,
          updatedAt: 2
        }),
        searchToolDefinitions: () => []
      }
    })

    expect(result.resumeRequestRecord).toBeUndefined()
    expect(result.resumeLoadError).toContain('different provider or model')
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
