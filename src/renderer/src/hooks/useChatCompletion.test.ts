import { describe, it, expect } from 'vitest'
import { isRuntimeErrorAssistantMessage, mergeResourceUpdate } from './useChatCompletion'
import { Message, SessionResource } from '../../../shared/types'

function res(over: Partial<SessionResource> = {}): SessionResource {
  return {
    id: 'r1',
    kind: 'web',
    source: 'https://example.com/r1',
    status: 'partial',
    chunks: [],
    createdAt: 1,
    updatedAt: 1,
    ...over
  }
}

describe('mergeResourceUpdate', () => {
  it('stamps the run id on a brand-new resource', () => {
    const out = mergeResourceUpdate(undefined, res({ id: 'r1' }), 'runA')
    expect(out.id).toBe('r1')
    expect(out.runIds).toEqual(['runA'])
  })

  it('does not duplicate a run id already present', () => {
    const existing = res({ runIds: ['runA'] })
    const out = mergeResourceUpdate(existing, res(), 'runA')
    expect(out.runIds).toEqual(['runA'])
  })

  it('accumulates run ids across turns', () => {
    const existing = res({ runIds: ['runA'] })
    const out = mergeResourceUpdate(existing, res(), 'runB')
    expect(out.runIds).toEqual(['runA', 'runB'])
  })

  it('merges chunks and fetched ranges while stamping the run', () => {
    const existing = res({
      runIds: ['runA'],
      fetchedRanges: [{ start: 0, end: 100 }],
      chunks: [{ id: 'c0', offset: 0, endOffset: 100, createdAt: 1 }]
    })
    const incoming = res({
      fetchedRanges: [{ start: 100, end: 200 }],
      chunks: [{ id: 'c1', offset: 100, endOffset: 200, createdAt: 2 }],
      nextOffset: 200,
      updatedAt: 5
    })
    const out = mergeResourceUpdate(existing, incoming, 'runB')

    expect(out.chunks.map((c) => c.id)).toEqual(['c0', 'c1'])
    // Adjacent ranges merge into one.
    expect(out.fetchedRanges).toEqual([{ start: 0, end: 200 }])
    expect(out.nextOffset).toBe(200)
    expect(out.runIds).toEqual(['runA', 'runB'])
  })
})

describe('isRuntimeErrorAssistantMessage', () => {
  it('recognizes explicitly-marked runtime errors', () => {
    const msg: Message = {
      id: 'm1',
      role: 'assistant',
      content: 'temporary provider error',
      isRuntimeError: true
    }

    expect(isRuntimeErrorAssistantMessage(msg)).toBe(true)
  })

  it('recognizes older API error messages by prefix', () => {
    const msg: Message = {
      id: 'm1',
      role: 'assistant',
      content: 'Agent resume failed: API Error: 429 - insufficient quota'
    }

    expect(isRuntimeErrorAssistantMessage(msg)).toBe(true)
  })

  it('does not hide normal assistant content', () => {
    const msg: Message = {
      id: 'm1',
      role: 'assistant',
      content: 'Here is the result of the task.'
    }

    expect(isRuntimeErrorAssistantMessage(msg)).toBe(false)
  })
})
