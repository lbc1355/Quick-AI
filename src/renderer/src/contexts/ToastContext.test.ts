/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unsafe-function-type */
/* eslint-disable @typescript-eslint/explicit-function-return-type */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ToastProvider } from './ToastContext'

// React hooks simulator for testing custom hooks/providers in node environment
class HookSimulator {
  states: any[] = []
  stateIndex = 0
  setStates: any[] = []
  callbacks: any[] = []

  reset() {
    this.stateIndex = 0
  }

  clear() {
    this.states = []
    this.stateIndex = 0
    this.setStates = []
    this.callbacks = []
  }

  useState<T>(initialValue: T | (() => T)): [T, (val: T | ((prev: T) => T)) => void] {
    const idx = this.stateIndex
    if (this.states.length <= idx) {
      const resolvedValue =
        typeof initialValue === 'function' ? (initialValue as Function)() : initialValue
      this.states.push(resolvedValue)
      this.setStates.push((next: T | ((prev: T) => T)) => {
        if (typeof next === 'function') {
          this.states[idx] = (next as Function)(this.states[idx])
        } else {
          this.states[idx] = next
        }
      })
    }
    const state = this.states[idx]
    const setState = this.setStates[idx]
    this.stateIndex++
    return [state, setState]
  }

  useCallback<T extends Function>(fn: T, _deps: any[]): T {
    return fn
  }
}

const sim = new HookSimulator()

vi.mock('react', async () => {
  const actual = await vi.importActual<any>('react')
  return {
    ...actual,
    useState: (init: any) => sim.useState(init),
    useCallback: (fn: any, deps: any) => sim.useCallback(fn, deps),
    createContext: actual.createContext,
    useContext: actual.useContext
  }
})

describe('ToastContext & ToastProvider', () => {
  beforeEach(() => {
    sim.clear()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  const getContextValue = () => {
    sim.reset()
    const element = ToastProvider({ children: null })
    return element.props.value
  }

  it('initializes with empty toasts', () => {
    const value = getContextValue()
    expect(value.toasts).toEqual([])
  })

  it('adds toasts with default durations and supports type shortcuts', () => {
    let value = getContextValue()

    value.info('info message')
    value = getContextValue()
    expect(value.toasts).toHaveLength(1)
    expect(value.toasts[0].type).toBe('info')
    expect(value.toasts[0].text).toBe('info message')
    expect(value.toasts[0].duration).toBe(3000)

    value.success('success message')
    value = getContextValue()
    expect(value.toasts).toHaveLength(2)
    expect(value.toasts[1].type).toBe('success')
    expect(value.toasts[1].duration).toBe(3000)

    value.warning('warning message')
    value = getContextValue()
    expect(value.toasts).toHaveLength(3)
    expect(value.toasts[2].type).toBe('warning')
    expect(value.toasts[2].duration).toBe(4000)
  })

  it('enforces maxVisible = 3 by dropping the oldest toasts', () => {
    let value = getContextValue()

    value.info('msg 1')
    value.info('msg 2')
    value.info('msg 3')
    value.info('msg 4')

    value = getContextValue()
    expect(value.toasts).toHaveLength(3)
    expect(value.toasts.map((t: any) => t.text)).toEqual(['msg 2', 'msg 3', 'msg 4'])
  })

  it('deduplicates identical messages in the list', () => {
    let value = getContextValue()

    value.info('duplicate message')
    value.info('duplicate message')

    value = getContextValue()
    expect(value.toasts).toHaveLength(1)
  })

  it('manually closes a toast', () => {
    let value = getContextValue()

    value.info('msg 1')
    value = getContextValue()
    const id = value.toasts[0].id

    value.removeToast(id)
    value = getContextValue()
    expect(value.toasts).toHaveLength(0)
  })

  it('automatically removes toast after its duration', () => {
    let value = getContextValue()

    value.info('msg 1')
    value = getContextValue()
    expect(value.toasts).toHaveLength(1)

    vi.advanceTimersByTime(3000)
    value = getContextValue()
    expect(value.toasts).toHaveLength(0)
  })
})
