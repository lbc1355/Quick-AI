import { describe, it, expect } from 'vitest'
import { isRuntimeErrorPayload, classifyRuntimeError, normalizeRuntimeError } from './runtimeErrors'

describe('runtimeErrors', () => {
  describe('isRuntimeErrorPayload', () => {
    it('returns true for valid RuntimeErrorPayload', () => {
      const valid = {
        message: 'Something went wrong',
        category: 'timeout',
        source: 'mcp',
        timestamp: Date.now()
      }
      expect(isRuntimeErrorPayload(valid)).toBe(true)
    })

    it('returns false for invalid objects', () => {
      expect(isRuntimeErrorPayload(null)).toBe(false)
      expect(isRuntimeErrorPayload({})).toBe(false)
      expect(isRuntimeErrorPayload({ message: 'only message' })).toBe(false)
      expect(
        isRuntimeErrorPayload({
          message: 'msg',
          category: 'invalid_category',
          source: 'mcp',
          timestamp: 123
        })
      ).toBe(false)
    })
  })

  describe('classifyRuntimeError', () => {
    it('classifies timeout errors', () => {
      expect(classifyRuntimeError('大模型连接超时中断 (terminated)').category).toBe('timeout')
      expect(classifyRuntimeError('Connection was terminated').category).toBe('timeout')
      expect(
        classifyRuntimeError('Execution of tool "x" on server "git" timed out after 30000ms')
          .category
      ).toBe('timeout')
      expect(
        classifyRuntimeError('Connection to server "git" timed out after 10000ms').category
      ).toBe('timeout')
      expect(classifyRuntimeError('connect ETIMEDOUT').category).toBe('timeout')
    })

    it('classifies rate limit errors', () => {
      expect(classifyRuntimeError('Rate limit exceeded').category).toBe('rate_limit')
      expect(classifyRuntimeError('API Error: 429 too many requests').category).toBe('rate_limit')
    })

    it('classifies unauthorized errors', () => {
      expect(classifyRuntimeError('Unauthorized access').category).toBe('unauthorized')
      expect(classifyRuntimeError('401 invalid key').category).toBe('unauthorized')
      expect(classifyRuntimeError('api key issue').category).toBe('unauthorized')
    })

    it('classifies network errors', () => {
      expect(classifyRuntimeError('DNS lookup failed').category).toBe('network')
      expect(classifyRuntimeError('fetch failed').category).toBe('network')
      expect(classifyRuntimeError('network error occurred').category).toBe('network')
      expect(classifyRuntimeError('ENOENT: no such file or directory').category).toBe('network')
    })

    it('classifies unknown errors as unknown', () => {
      expect(classifyRuntimeError('Some arbitrary runtime crash').category).toBe('unknown')
    })
  })

  describe('normalizeRuntimeError', () => {
    it('returns the same payload if it is already a RuntimeErrorPayload', () => {
      const existing = {
        message: 'timeout error',
        category: 'timeout' as const,
        source: 'agent' as const,
        timestamp: 12345
      }
      expect(normalizeRuntimeError(existing)).toBe(existing)
    })

    it('converts Error instances to payload', () => {
      const err = new Error('fetch failed')
      const payload = normalizeRuntimeError(err, 'model_api')
      expect(payload.message).toBe('fetch failed')
      expect(payload.category).toBe('network')
      expect(payload.source).toBe('model_api')
      expect(payload.rawError).toContain('Error: fetch failed')
      expect(payload.timestamp).toBeGreaterThan(0)
    })

    it('converts string errors to payload', () => {
      const payload = normalizeRuntimeError('Rate limit exceeded', 'mcp')
      expect(payload.message).toBe('Rate limit exceeded')
      expect(payload.category).toBe('rate_limit')
      expect(payload.source).toBe('mcp')
      expect(payload.timestamp).toBeGreaterThan(0)
    })

    it('converts object errors to payload', () => {
      const payload = normalizeRuntimeError({ message: '401 Unauthorized' }, 'unknown')
      expect(payload.message).toBe('401 Unauthorized')
      expect(payload.category).toBe('unauthorized')
      expect(payload.source).toBe('unknown')
    })
  })
})
