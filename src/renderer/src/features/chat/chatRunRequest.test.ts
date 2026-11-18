import { describe, expect, it } from 'vitest'
import type { Project, Session } from '../../../../shared/types'
import {
  buildAgentSkillRunOptions,
  buildChatRunOptions,
  hasAgentMention,
  needsApiKeyBeforeRun,
  resolveEffectiveRunMode,
  type ChatRequestConfig
} from './chatRunRequest'

const project: Project = {
  id: 'project-1',
  name: 'QuickAI',
  path: '/repo/quickai',
  createdAt: 1,
  updatedAt: 1
}

const config = (over: Partial<ChatRequestConfig> = {}): ChatRequestConfig => ({
  apiKey: 'key',
  apiUrl: 'https://api.deepseek.com/v1',
  selectedModel: 'deepseek-chat',
  contextRetentionMode: 'default',
  systemPrompt: 'you are a helper',
  projects: [project],
  ...over
})

const session = (over: Partial<Session> = {}): Session => ({
  id: 'session-1',
  title: 'Session',
  messages: [{ id: 'user-1', role: 'user', content: 'hi' }],
  ...over
})

describe('needsApiKeyBeforeRun', () => {
  it('flags a DeepSeek endpoint with no key', () => {
    expect(needsApiKeyBeforeRun({ apiKey: '', apiUrl: 'https://api.deepseek.com/v1' })).toBe(true)
  })

  it('accepts a DeepSeek endpoint once a key is present', () => {
    expect(needsApiKeyBeforeRun({ apiKey: 'sk-1', apiUrl: 'https://api.deepseek.com/v1' })).toBe(
      false
    )
  })

  it('does not block keyless providers such as a local Ollama', () => {
    expect(needsApiKeyBeforeRun({ apiKey: '', apiUrl: 'http://localhost:11434/v1' })).toBe(false)
  })
})

describe('resolveEffectiveRunMode', () => {
  it.each([
    ['@reader summarise', true],
    ['   @reader summarise', true],
    ['email me @someone', false],
    ['@', false]
  ])('detects a leading skill mention in %o', (prompt, expected) => {
    expect(hasAgentMention(prompt)).toBe(expected)
  })

  it('forces agent mode for a leading mention even when the toggle says chat', () => {
    expect(resolveEffectiveRunMode('@reader go', 'chat')).toBe('agent')
  })

  it('keeps the current toggle when there is no mention', () => {
    expect(resolveEffectiveRunMode('plain question', 'chat')).toBe('chat')
    expect(resolveEffectiveRunMode('plain question', 'agent')).toBe('agent')
  })
})

describe('buildChatRunOptions', () => {
  const base = {
    config: config(),
    session: session({ projectId: 'project-1', resources: [] }),
    messages: [{ role: 'user', content: 'hi' }],
    historyForCachePriority: [{ id: 'user-1', role: 'user' as const, content: 'hi' }],
    runMode: 'agent' as const,
    contextEpoch: 3,
    sourceMessageId: 'user-1',
    assistantMessageId: 'assistant-1'
  }

  it('carries the provider configuration and session scope onto the payload', () => {
    const options = buildChatRunOptions(base)

    expect(options).toMatchObject({
      apiUrl: 'https://api.deepseek.com/v1',
      apiKey: 'key',
      model: 'deepseek-chat',
      runMode: 'agent',
      sessionId: 'session-1',
      contextEpoch: 3,
      sourceMessageId: 'user-1',
      assistantMessageId: 'assistant-1',
      projectRoot: '/repo/quickai',
      projectName: 'QuickAI'
    })
  })

  it('omits optional run scopes that were not requested', () => {
    const options = buildChatRunOptions(base)

    expect(options).not.toHaveProperty('branchOf')
    expect(options).not.toHaveProperty('promptAdmissionId')
    expect(options).not.toHaveProperty('resumeFromRunId')
    expect(options).not.toHaveProperty('resumeSourceSessionId')
    expect(options).not.toHaveProperty('startupTiming')
  })

  it('carries numeric renderer startup measurements across IPC', () => {
    const startupTiming = { startedAt: 100, persistedAt: 200, paintWaitMs: 16, persistenceMs: 84 }
    expect(buildChatRunOptions({ ...base, startupTiming }).startupTiming).toEqual(startupTiming)
  })

  it('expands a resume request into both checkpoint fields', () => {
    const options = buildChatRunOptions({
      ...base,
      messages: [],
      resume: { fromRunId: 'run-9', sourceSessionId: 'session-origin' }
    })

    expect(options.resumeFromRunId).toBe('run-9')
    expect(options.resumeSourceSessionId).toBe('session-origin')
    expect(options.messages).toEqual([])
  })

  it('passes the durable admission id through for an inbox-drained run', () => {
    const options = buildChatRunOptions({ ...base, promptAdmissionId: 'admission-1' })
    expect(options.promptAdmissionId).toBe('admission-1')
  })

  it('leaves the project scope off a session with no project', () => {
    const options = buildChatRunOptions({ ...base, session: session() })
    expect(options.projectRoot).toBeUndefined()
    expect(options.projectName).toBeUndefined()
  })
})

describe('buildAgentSkillRunOptions', () => {
  it('includes the system prompt and skill payload', () => {
    const skill = {
      id: 'skill-1',
      name: 'Reader',
      trigger: 'reader',
      prompt: 'read carefully'
    }
    const options = buildAgentSkillRunOptions({
      config: config(),
      session: session({ projectId: 'project-1' }),
      historyForCachePriority: [],
      skill,
      userInput: 'this doc',
      contextEpoch: 1,
      sourceMessageId: 'user-1',
      assistantMessageId: 'assistant-1'
    })

    expect(options.systemPrompt).toBe('you are a helper')
    expect(options.skill).toBe(skill)
    expect(options.userInput).toBe('this doc')
    expect(options.sessionId).toBe('session-1')
    expect(options.projectRoot).toBe('/repo/quickai')
  })
})
