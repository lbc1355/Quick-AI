/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unsafe-function-type */
/* eslint-disable @typescript-eslint/explicit-function-return-type */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Message, AgentEvent } from '../../../../shared/types'

// Setup lightweight React hooks mock simulator before importing the hook
class HookSimulator {
  states: any[] = []
  stateIndex = 0
  effects: { fn: Function; deps: any[] }[] = []

  reset() {
    this.stateIndex = 0
    this.effects = []
  }

  useState<T>(initialValue: T | (() => T)): [T, (val: T | ((prev: T) => T)) => void] {
    const idx = this.stateIndex
    if (this.states.length <= idx) {
      this.states.push(
        typeof initialValue === 'function' ? (initialValue as Function)() : initialValue
      )
    }
    const state = this.states[idx]
    const setState = (next: T | ((prev: T) => T)) => {
      if (typeof next === 'function') {
        this.states[idx] = (next as Function)(this.states[idx])
      } else {
        this.states[idx] = next
      }
    }
    this.stateIndex++
    return [state, setState]
  }

  useMemo<T>(fn: () => T): T {
    return fn()
  }

  useEffect(fn: Function, deps: any[]) {
    this.effects.push({ fn, deps })
  }
}

const sim = new HookSimulator()

vi.mock('react', () => ({
  useState: (init: any) => sim.useState(init),
  useMemo: (fn: any) => sim.useMemo(fn),
  useEffect: (fn: any, deps: any) => sim.useEffect(fn, deps)
}))

// Mock window.api or clipboard since they might run in electron environment
Object.defineProperty(global, 'navigator', {
  value: {
    clipboard: {
      writeText: vi.fn().mockResolvedValue(undefined)
    }
  },
  configurable: true,
  writable: true
})

import { useAgentMessageViewModel } from './useAgentMessageViewModel'

describe('useAgentMessageViewModel hook', () => {
  beforeEach(() => {
    sim.reset()
    vi.clearAllMocks()
  })

  it('handles legacy standard log path (legacy log fallback)', () => {
    const msg: Message = {
      id: '1710000000000',
      role: 'assistant',
      agentRunId: 'run-legacy',
      content:
        'Some raw analysis text\n[tool: file_read path="index.ts"]\noutput content\n[tool_status: success]\nFinal result is ready.'
    }

    const vm = useAgentMessageViewModel({
      msg,
      isGenerating: false
    })

    expect(vm.hasStructuredEvents).toBe(false)
    expect(vm.agentStatus).toBe('completed')
    expect(vm.cleanContent).toContain('Some raw analysis text')
    expect(vm.cleanContent).toContain('Final result is ready.')
    expect(vm.finalReplyText).toBe(vm.cleanContent)
  })

  it('handles structured agentEvents path correctly', () => {
    const events: AgentEvent[] = [
      { type: 'agent_start', skillName: 'shell', timestamp: 1000, runId: 'run-1', sequence: 1 },
      {
        type: 'agent_step',
        stepId: 'step-2',
        step: 2,
        maxSteps: 30,
        title: 'Reading configurations',
        message: 'Reading configs...',
        status: 'running',
        timestamp: 1100,
        runId: 'run-1',
        sequence: 2
      },
      {
        type: 'tool_call',
        callId: 'call-1',
        toolName: 'file_read',
        args: { path: 'config.json' },
        permissionState: 'pending',
        stepId: 'step-2',
        timestamp: 1150,
        runId: 'run-1',
        sequence: 3
      }
    ]

    const msg: Message = {
      id: '1710000000000',
      role: 'assistant',
      content: 'Answer content',
      agentEvents: events
    }

    const vm = useAgentMessageViewModel({
      msg,
      isGenerating: true
    })

    expect(vm.hasStructuredEvents).toBe(true)
    expect(vm.agentStatus).toBe('running')
    expect(vm.currentStep).toBe(1) // agent_progress event was not in the timeline, defaults to step 1
    expect(vm.maxSteps).toBe(30)
    expect(vm.activeStepTitle).toBe('Reading configurations')
    expect(vm.pendingToolCall).toBeDefined()
    expect(vm.pendingToolCall?.toolName).toBe('file_read')
  })

  it('supports copying final answer to clipboard', () => {
    const msg: Message = {
      id: '1710000000000',
      role: 'assistant',
      content: 'Final reply content'
    }

    const vm = useAgentMessageViewModel({
      msg,
      isGenerating: false
    })

    vm.handleCopy()
    expect(global.navigator.clipboard.writeText).toHaveBeenCalledWith('Final reply content')
  })

  it('can skip rich content rendering for streaming hot paths', () => {
    const msg: Message = {
      id: '1710000000000',
      role: 'assistant',
      content: 'Final reply content'
    }

    const vm = useAgentMessageViewModel({
      msg,
      isGenerating: true,
      renderRichContent: false
    })

    expect(vm.cleanContent).toBe('Final reply content')
    expect(vm.finalReplyText).toBe('Final reply content')
    expect(vm.renderedCleanContent).toBeNull()
  })
})
