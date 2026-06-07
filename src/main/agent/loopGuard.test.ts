import { describe, it, expect } from 'vitest'
import { LoopGuard, stableStringify, DEFAULT_LOOP_GUARD_THRESHOLDS } from './loopGuard'

describe('stableStringify', () => {
  it('produces identical output regardless of key order', () => {
    expect(stableStringify({ a: 1, b: 2 })).toBe(stableStringify({ b: 2, a: 1 }))
  })

  it('sorts keys recursively and preserves array order', () => {
    expect(stableStringify({ z: { y: 1, x: 2 }, a: [3, 1, 2] })).toBe(
      '{"a":[3,1,2],"z":{"x":2,"y":1}}'
    )
  })

  it('handles primitives and null', () => {
    expect(stableStringify(null)).toBe('null')
    expect(stableStringify('x')).toBe('"x"')
    expect(stableStringify(42)).toBe('42')
  })

  it('does not throw on circular references', () => {
    const obj: Record<string, unknown> = { a: 1 }
    obj.self = obj
    expect(() => stableStringify(obj)).not.toThrow()
  })
})

describe('LoopGuard identical-call blocking', () => {
  it('blocks the Nth identical call (default threshold 3)', () => {
    const guard = new LoopGuard()
    const sig = guard.signature('web_search', { query: 'test' })
    expect(guard.recordCall(sig)).toEqual({ blocked: false, count: 1 })
    expect(guard.recordCall(sig)).toEqual({ blocked: false, count: 2 })
    expect(guard.recordCall(sig)).toEqual({ blocked: true, count: 3 })
    expect(guard.recordCall(sig)).toEqual({ blocked: true, count: 4 })
  })

  it('treats different arguments as separate signatures', () => {
    const guard = new LoopGuard()
    const a = guard.signature('fetch_url', { url: 'a', offset: 0 })
    const b = guard.signature('fetch_url', { url: 'a', offset: 100 })
    guard.recordCall(a)
    guard.recordCall(a)
    expect(guard.recordCall(b)).toEqual({ blocked: false, count: 1 })
  })

  it('treats key order as the same signature', () => {
    const guard = new LoopGuard()
    const s1 = guard.signature('t', { a: 1, b: 2 })
    const s2 = guard.signature('t', { b: 2, a: 1 })
    guard.recordCall(s1)
    guard.recordCall(s2)
    expect(guard.recordCall(s1)).toEqual({ blocked: true, count: 3 })
  })
})

describe('LoopGuard consecutive-failure escalation', () => {
  it('escalates ok -> warn -> halt at the configured thresholds', () => {
    const guard = new LoopGuard({ identicalCallBlock: 3, failureWarn: 3, failureHalt: 5 })
    expect(guard.recordFailure('file_read').level).toBe('ok')
    expect(guard.recordFailure('file_read').level).toBe('ok')
    expect(guard.recordFailure('file_read').level).toBe('warn')
    expect(guard.recordFailure('file_read').level).toBe('warn')
    expect(guard.recordFailure('file_read')).toEqual({ level: 'halt', count: 5 })
  })

  it('resets the streak on success', () => {
    const guard = new LoopGuard()
    guard.recordFailure('file_read')
    guard.recordFailure('file_read')
    guard.recordSuccess('file_read')
    expect(guard.recordFailure('file_read')).toEqual({ level: 'ok', count: 1 })
  })

  it('tracks failure streaks per tool independently', () => {
    const guard = new LoopGuard()
    guard.recordFailure('file_read')
    guard.recordFailure('file_read')
    expect(guard.recordFailure('web_search')).toEqual({ level: 'ok', count: 1 })
    expect(guard.recordFailure('file_read')).toEqual({ level: 'warn', count: 3 })
  })

  it('exposes sane defaults', () => {
    expect(DEFAULT_LOOP_GUARD_THRESHOLDS).toEqual({
      identicalCallBlock: 3,
      failureWarn: 3,
      failureHalt: 8
    })
  })
})
