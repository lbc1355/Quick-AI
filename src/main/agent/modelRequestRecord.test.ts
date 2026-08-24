import { describe, expect, it } from 'vitest'
import type { CallModelOptions } from './modelCallTypes'
import {
  createModelRequestContextPolicy,
  createModelRequestRecord,
  isModelRequestTargetCompatible,
  settleModelRequestRecord,
  verifyModelRequestRecord
} from './modelRequestRecord'

const modelConfig = (): CallModelOptions => ({
  providerConnection: {
    accountId: 'custom:account-1',
    providerId: 'custom',
    baseUrl: 'https://user:password@example.com/openai/v1?api_key=query-secret',
    auth: { type: 'bearer', token: 'provider-secret' },
    headers: {
      Authorization: 'Bearer header-secret',
      'X-Tenant': 'tenant-1'
    }
  },
  model: 'display-model',
  modelRuntime: {
    providerId: 'custom',
    providerType: 'custom',
    endpointType: 'custom',
    modelId: 'model-1',
    apiModel: 'wire-model',
    transportId: 'openai-chat-completions',
    apiFormat: 'chat-completions',
    requestBodyOverrides: {
      temperature: 0.2,
      apiKey: 'body-secret',
      nested: { access_token: 'nested-secret' }
    }
  },
  reasoningPreference: 'high'
})

const contextPolicy = createModelRequestContextPolicy({
  contextWindowTokens: 32_000,
  contextRetentionMode: 'cache-priority',
  beforeMessages: [
    { role: 'system', content: 'system' },
    { role: 'user', content: 'hello' },
    { role: 'tool', content: 'large old result' }
  ],
  afterMessages: [
    { role: 'system', content: 'system' },
    { role: 'user', content: 'hello' }
  ],
  compactedStaleToolResults: 1,
  compactedStaleToolResultChars: 2000
})

describe('model request records', () => {
  it('captures a verifiable semantic request without provider secrets', () => {
    const messages = [{ role: 'user', content: 'hello' }]
    const tools = [
      {
        type: 'function' as const,
        function: {
          name: 'file_read',
          description: 'Read a file',
          parameters: { type: 'object' as const, properties: {} }
        }
      }
    ]
    const record = createModelRequestRecord({
      runId: 'run-1',
      sessionId: 'session-1',
      contextEpoch: 3,
      step: 2,
      stepId: 'run-1:step:2',
      modelConfig: modelConfig(),
      messages,
      tools,
      requestedReasoningPreference: 'max',
      effectiveReasoningPreference: 'high',
      contextPolicy,
      capturedAt: 123
    })

    expect(record).toMatchObject({
      requestId: 'run-1:request:2',
      state: 'prepared',
      reconstructable: true,
      capturedAt: 123,
      target: {
        accountId: 'custom:account-1',
        providerId: 'custom',
        endpoint: 'https://example.com/openai/v1',
        authType: 'bearer',
        headerNames: ['Authorization', 'X-Tenant'],
        apiModel: 'wire-model',
        transportId: 'openai-chat-completions'
      },
      modelRuntime: {
        requestBodyOverrides: {
          temperature: 0.2,
          apiKey: '[REDACTED]',
          nested: { access_token: '[REDACTED]' }
        }
      }
    })
    expect(record.redactedPaths).toEqual([
      'modelRuntime.requestBodyOverrides.apiKey',
      'modelRuntime.requestBodyOverrides.nested.access_token',
      'target.endpoint.credentials',
      'target.endpoint.query'
    ])
    expect(verifyModelRequestRecord(record)).toBe(true)
    expect(isModelRequestTargetCompatible(record, modelConfig())).toBe(true)
    expect(
      isModelRequestTargetCompatible(record, {
        ...modelConfig(),
        model: 'different-model'
      })
    ).toBe(false)
    expect(JSON.stringify(record)).not.toContain('provider-secret')
    expect(JSON.stringify(record)).not.toContain('header-secret')
    expect(JSON.stringify(record)).not.toContain('body-secret')
    expect(JSON.stringify(record)).not.toContain('nested-secret')

    messages[0].content = 'mutated after capture'
    tools[0].function.description = 'mutated after capture'
    expect(record.payload?.messages[0].content).toBe('hello')
    expect(record.payload?.tools?.[0].function.description).toBe('Read a file')
  })

  it('detects payload tampering and records response settlement separately', () => {
    const record = createModelRequestRecord({
      runId: 'run-1',
      sessionId: 'session-1',
      contextEpoch: 0,
      step: 1,
      stepId: 'step-1',
      modelConfig: modelConfig(),
      messages: [{ role: 'user', content: 'hello' }],
      requestedReasoningPreference: 'auto',
      effectiveReasoningPreference: 'auto',
      contextPolicy
    })
    const settled = settleModelRequestRecord(record, { role: 'assistant', content: 'done' }, 456)

    expect(settled).toMatchObject({ state: 'settled', settledAt: 456 })
    expect(settled.responseHash).toMatch(/^[a-f0-9]{64}$/)
    expect(record.state).toBe('prepared')

    record.payload!.messages[0].content = 'tampered'
    expect(verifyModelRequestRecord(record)).toBe(false)
  })

  it('keeps fingerprints but refuses to claim reconstruction when UTF-8 bytes exceed the limit', () => {
    const record = createModelRequestRecord({
      runId: 'run-large',
      sessionId: 'session-1',
      contextEpoch: 0,
      step: 1,
      stepId: 'step-1',
      modelConfig: modelConfig(),
      messages: [{ role: 'user', content: '中文' }],
      requestedReasoningPreference: 'auto',
      effectiveReasoningPreference: 'auto',
      contextPolicy,
      // The serialized payload has relatively few UTF-16 code units but more UTF-8 bytes.
      maxPayloadBytes: 40
    })

    expect(record.reconstructable).toBe(false)
    expect(record.payload).toBeUndefined()
    expect(record.omissionReason).toContain('40-byte UTF-8')
    expect(verifyModelRequestRecord(record)).toBe(false)
  })

  it('rejects malformed persisted records without throwing during recovery', () => {
    const malformed = {
      version: 1,
      reconstructable: true,
      payload: {}
    }

    expect(() =>
      verifyModelRequestRecord(
        malformed as unknown as Parameters<typeof verifyModelRequestRecord>[0]
      )
    ).not.toThrow()
    expect(
      verifyModelRequestRecord(
        malformed as unknown as Parameters<typeof verifyModelRequestRecord>[0]
      )
    ).toBe(false)
  })
})
