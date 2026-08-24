import { describe, expect, it, vi } from 'vitest'
import type { ToolDefinition } from '../tools/types'
import {
  DEFAULT_TOOL_TIMEOUT_MS,
  ToolExecutionLifecycleError,
  resolveToolTimeoutMs,
  runWithToolExecutionLifecycle
} from './toolExecutionLifecycle'

const tool = (overrides: Partial<ToolDefinition> = {}): ToolDefinition => ({
  name: 'test_tool',
  title: 'Test Tool',
  description: 'Test tool',
  tags: [],
  category: 'system',
  risk: 'low',
  implemented: true,
  discoverable: true,
  parameters: { type: 'object', properties: {} },
  execute: vi.fn(),
  ...overrides
})

describe('tool execution lifecycle', () => {
  it('uses the default deadline, but leaves progress-aware MCP deadlines to MCP', () => {
    expect(resolveToolTimeoutMs(tool(), {})).toBe(DEFAULT_TOOL_TIMEOUT_MS)
    expect(resolveToolTimeoutMs(tool({ source: 'mcp' }), {})).toBeUndefined()
    expect(resolveToolTimeoutMs(tool({ source: 'mcp', timeoutMs: 1234 }), {})).toBe(1234)
    expect(
      resolveToolTimeoutMs(tool({ timeoutMs: (args) => Number(args.waitMs) }), { waitMs: 42 })
    ).toBe(42)
    expect(resolveToolTimeoutMs(tool({ timeoutMs: () => undefined }), {})).toBeUndefined()
  })

  it('does not start a tool when the caller is already cancelled', async () => {
    const controller = new AbortController()
    controller.abort()
    const execute = vi.fn(async () => 'late')

    await expect(
      runWithToolExecutionLifecycle({
        toolName: 'test_tool',
        callerSignal: controller.signal,
        execute
      })
    ).rejects.toMatchObject({ kind: 'cancelled', executionStarted: false })
    expect(execute).not.toHaveBeenCalled()
  })

  it('bounds cancellation drain time and ignores an uncooperative late result', async () => {
    let settleLate: ((value: string) => void) | undefined
    const pendingTool = new Promise<string>((resolve) => {
      settleLate = resolve
    })
    const controller = new AbortController()
    const pending = runWithToolExecutionLifecycle({
      toolName: 'stuck_tool',
      callerSignal: controller.signal,
      drainGraceMs: 10,
      execute: () => pendingTool
    })

    controller.abort()
    await expect(pending).rejects.toEqual(
      expect.objectContaining({
        kind: 'cancelled',
        drainTimedOut: true
      })
    )

    settleLate?.('late result')
    await new Promise((resolve) => setTimeout(resolve, 0))
  })

  it('exposes a typed error for structured classification', () => {
    const error = new ToolExecutionLifecycleError({
      toolName: 'test_tool',
      kind: 'timed_out',
      timeoutMs: 25
    })
    expect(error).toMatchObject({ kind: 'timed_out', timeoutMs: 25, drainTimedOut: false })
  })
})
