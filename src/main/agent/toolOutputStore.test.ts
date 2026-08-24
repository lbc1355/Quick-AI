import { describe, it, expect, afterEach } from 'vitest'
import { ToolRegistry } from '../toolRegistry'
import { createRun, destroyRun, getRun } from './AgentRunContext'
import { ActionLog } from './actionLog'

const ctxFor = (reqId: string): { reqId: string; signal: AbortSignal } => ({
  reqId,
  signal: new AbortController().signal
})

const newRun = (reqId: string): ReturnType<typeof createRun> =>
  createRun(reqId, [], 'all', new ActionLog())

describe('AgentRunContext tool-output store', () => {
  afterEach(() => {
    destroyRun('tos-req')
  })

  it('stores and retrieves a tool output by call id', () => {
    const run = newRun('tos-req')
    run.storeToolOutput('call-1', 'hello world')
    expect(run.getToolOutput('call-1')).toBe('hello world')
    expect(run.getToolOutput('missing')).toBeUndefined()
  })

  it('evicts the oldest entry once the byte cap is exceeded', () => {
    const run = newRun('tos-req')
    const twoMB = 'x'.repeat(2 * 1024 * 1024)
    run.storeToolOutput('a', twoMB)
    run.storeToolOutput('b', twoMB)
    run.storeToolOutput('c', twoMB) // total 6MB > 5MB cap -> 'a' evicted

    expect(run.getToolOutput('a')).toBeUndefined()
    expect(run.getToolOutput('b')).toBeDefined()
    expect(run.getToolOutput('c')).toBeDefined()
  })

  it('counts multibyte output against the byte cap', () => {
    const run = newRun('tos-req')
    const almostThreeMB = '中'.repeat(900_000)
    run.storeToolOutput('a', almostThreeMB)
    run.storeToolOutput('b', almostThreeMB)

    expect(run.getToolOutput('a')).toBeUndefined()
    expect(run.getToolOutput('b')).toBeDefined()
  })
})

describe('read_tool_output tool', () => {
  afterEach(() => {
    destroyRun('rto-req')
  })

  it('returns a windowed slice with a nextOffset hint for long output', async () => {
    const run = newRun('rto-req')
    const full = 'A'.repeat(20000)
    run.storeToolOutput('big', full)

    const { resultForModel } = await ToolRegistry.read_tool_output.execute(
      { output_id: 'big', offset: 0, maxChars: 8000 },
      ctxFor('rto-req')
    )

    expect(resultForModel).toContain('chars 0-8000 of 20000')
    expect(resultForModel).toContain('offset=8000')
    // Body carries exactly the requested window.
    expect(resultForModel.endsWith('A'.repeat(8000))).toBe(true)
  })

  it('reads a later window and omits nextOffset at the end', async () => {
    newRun('rto-req')
    getRun('rto-req')!.storeToolOutput('big', 'B'.repeat(10000))

    const { resultForModel } = await ToolRegistry.read_tool_output.execute(
      { output_id: 'big', offset: 9000, maxChars: 8000 },
      ctxFor('rto-req')
    )

    expect(resultForModel).toContain('chars 9000-10000 of 10000')
    expect(resultForModel).not.toContain('More available')
  })

  it('reports gracefully when the output id is unknown', async () => {
    newRun('rto-req')
    const { resultForModel } = await ToolRegistry.read_tool_output.execute(
      { output_id: 'nope' },
      ctxFor('rto-req')
    )
    expect(resultForModel).toContain('No stored tool output found')
  })

  it('throws on a missing output_id', async () => {
    newRun('rto-req')
    await expect(ToolRegistry.read_tool_output.execute({}, ctxFor('rto-req'))).rejects.toThrow(
      'Missing or invalid output_id'
    )
  })
})
