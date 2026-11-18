import { describe, expect, it, vi } from 'vitest'
import { createModelTimingReporter } from './modelTiming'

describe('model timing markers', () => {
  it('distinguishes headers, first byte, and first output and emits only bounded markers', () => {
    let clock = 0
    const emit = vi.fn()
    const reporter = createModelTimingReporter(emit, () => clock)
    clock = 25 // Request preparation before fetch.
    const attempt = reporter.startAttempt()
    clock = 225
    attempt.headers(200)
    clock = 250 // A heartbeat can arrive before model output.
    attempt.bodyChunk()
    attempt.bodyChunk()
    clock = 400
    attempt.output('reasoning')
    attempt.output('text')
    clock = 500
    attempt.complete('success')
    attempt.complete('error')

    expect(emit.mock.calls.map(([event]) => event.phase)).toEqual([
      'http_request',
      'response_headers',
      'first_body_chunk',
      'first_model_output',
      'model_complete'
    ])
    expect(emit.mock.calls[3][0]).toMatchObject({
      attempt: 1,
      attemptElapsedMs: 375,
      callElapsedMs: 400,
      outputKind: 'reasoning'
    })
  })

  it('separates retry attempts and includes backoff only in total call time', () => {
    let clock = 0
    const emit = vi.fn()
    const reporter = createModelTimingReporter(emit, () => clock)
    const failed = reporter.startAttempt()
    clock = 100
    failed.headers(503)
    failed.complete('error')
    clock = 1100
    const retry = reporter.startAttempt()
    clock = 1250
    retry.output('tool-call')
    retry.complete('success')
    expect(emit.mock.calls.find(([e]) => e.phase === 'first_model_output')?.[0]).toMatchObject({
      attempt: 2,
      attemptElapsedMs: 150,
      callElapsedMs: 1250,
      outputKind: 'tool-call'
    })
  })

  it('ignores a broken diagnostics observer', () => {
    const reporter = createModelTimingReporter(() => {
      throw new Error('logger unavailable')
    })
    expect(() => {
      const attempt = reporter.startAttempt()
      attempt.headers(200)
      attempt.bodyChunk()
      attempt.output('text')
      attempt.complete('success')
    }).not.toThrow()
  })
})
