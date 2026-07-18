import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { existsSync, promises as fs } from 'fs'
import { join } from 'path'
import type { AdmitSessionPromptInput } from '../../shared/types'
import { closeDb } from './connection'
import {
  admitSessionPrompt,
  cancelSessionPrompt,
  claimNextSessionPrompt,
  completeSessionPrompt,
  getSessionPrompt,
  listSessionPrompts,
  markSessionPromptRunning,
  recoverRunningSessionPrompts,
  requeueSessionPrompts
} from './sessionPromptStore'
import { describeWithSqlite } from '../testSupport/nativeSqlite'

const testDir = join(__dirname, '../../../temp-session-prompt-store-test')

vi.mock('electron', () => ({
  app: {
    getPath: () => testDir
  }
}))

const makeInput = (id: string, mode: 'steer' | 'queue' = 'queue'): AdmitSessionPromptInput => ({
  id,
  sessionId: 'session-1',
  mode,
  runMode: 'agent' as const,
  sourceMessageId: `message-${id}`,
  assistantMessageId: `assistant-${id}`,
  messages: [{ role: 'user', content: `prompt ${id}` }]
})

describeWithSqlite('sessionPromptStore', () => {
  beforeEach(async () => {
    closeDb()
    if (existsSync(testDir)) await fs.rm(testDir, { recursive: true, force: true })
    await fs.mkdir(testDir, { recursive: true })
  })

  afterEach(async () => {
    closeDb()
    if (existsSync(testDir)) await fs.rm(testDir, { recursive: true, force: true })
  })

  it('admits prompts idempotently without storing provider secrets', () => {
    const first = admitSessionPrompt(makeInput('prompt-1', 'steer'))
    const duplicate = admitSessionPrompt(makeInput('prompt-1', 'steer'))

    expect(first.inserted).toBe(true)
    expect(duplicate.inserted).toBe(false)
    expect(duplicate.prompt).toMatchObject({
      id: 'prompt-1',
      status: 'pending',
      mode: 'steer',
      messages: [{ role: 'user', content: 'prompt prompt-1' }]
    })
    expect(JSON.stringify(duplicate.prompt)).not.toContain('apiKey')
  })

  it('claims pending prompts in stable FIFO order', () => {
    admitSessionPrompt(makeInput('prompt-a'))
    admitSessionPrompt(makeInput('prompt-b'))

    expect(claimNextSessionPrompt('session-1')?.id).toBe('prompt-a')
    expect(claimNextSessionPrompt('session-1')?.id).toBe('prompt-b')
    expect(claimNextSessionPrompt('session-1')).toBeUndefined()
    expect(listSessionPrompts('session-1').map((prompt) => prompt.status)).toEqual([
      'running',
      'running'
    ])
  })

  it('supports consume, requeue, complete, and pending cancellation transitions', () => {
    admitSessionPrompt(makeInput('prompt-a', 'steer'))
    admitSessionPrompt(makeInput('prompt-b'))
    expect(markSessionPromptRunning('prompt-a')).toBe(true)
    expect(requeueSessionPrompts(['prompt-a'])).toBe(1)
    expect(markSessionPromptRunning('prompt-a')).toBe(true)
    expect(completeSessionPrompt('prompt-a')).toBe(true)
    expect(cancelSessionPrompt('prompt-b')).toBe(true)
    expect(listSessionPrompts('session-1')).toEqual([])
    expect(getSessionPrompt('prompt-a')?.status).toBe('completed')
    expect(getSessionPrompt('prompt-b')?.status).toBe('cancelled')
  })

  it('recovers running prompts after process restart', () => {
    admitSessionPrompt(makeInput('prompt-a'))
    claimNextSessionPrompt('session-1')
    expect(getSessionPrompt('prompt-a')?.status).toBe('running')

    expect(recoverRunningSessionPrompts()).toBe(1)
    expect(getSessionPrompt('prompt-a')?.status).toBe('pending')
  })

  it('rejects admission id collisions across distinct prompts', () => {
    admitSessionPrompt(makeInput('prompt-a'))
    expect(() =>
      admitSessionPrompt({
        ...makeInput('prompt-a'),
        sessionId: 'different-session'
      })
    ).toThrow('already used by another prompt')
  })
})
