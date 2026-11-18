import { describe, expect, it, vi, type Mock } from 'vitest'
import type { Session, SessionPromptAdmission } from '../../../../shared/types'
import { createQueuedPromptRunner } from './queuedPromptRunner'

const sessionId = 'session-1'
const admission: SessionPromptAdmission = {
  id: 'admission-1',
  sessionId,
  contextEpoch: 3,
  mode: 'queue',
  status: 'running',
  runMode: 'agent',
  sourceMessageId: 'user-1',
  assistantMessageId: 'assistant-1',
  messages: [{ role: 'user', content: 'Queued request' }],
  createdAt: 1,
  updatedAt: 1
}

type Runner = ReturnType<typeof createQueuedPromptRunner>
type Dependencies = Parameters<Runner['drainNext']>[1]

interface Fixture {
  runner: Runner
  dependencies: Dependencies & {
    inbox: {
      claimNextSessionPrompt: Mock<Dependencies['inbox']['claimNextSessionPrompt']>
      cancelClaimedSessionPrompt: Mock<Dependencies['inbox']['cancelClaimedSessionPrompt']>
      requeueSessionPrompt: Mock<Dependencies['inbox']['requeueSessionPrompt']>
    }
    isRunActive: Mock<Dependencies['isRunActive']>
    beginRun: Mock<Dependencies['beginRun']>
    finishRun: Mock<Dependencies['finishRun']>
    persistSessions: Mock<Dependencies['persistSessions']>
    launchRun: Mock<Dependencies['launchRun']>
  }
  advanceContext: () => void
}

function setup(): Fixture {
  let session: Session = {
    id: sessionId,
    title: 'Session',
    contextEpoch: admission.contextEpoch,
    messages: [
      { id: 'user-1', role: 'user', content: 'Queued request' },
      { id: 'assistant-1', role: 'assistant', content: 'Waiting' }
    ]
  }
  const dependencies: Fixture['dependencies'] = {
    inbox: {
      claimNextSessionPrompt: vi
        .fn<Dependencies['inbox']['claimNextSessionPrompt']>()
        .mockResolvedValue(admission),
      cancelClaimedSessionPrompt: vi
        .fn<Dependencies['inbox']['cancelClaimedSessionPrompt']>()
        .mockResolvedValue(true),
      requeueSessionPrompt: vi
        .fn<Dependencies['inbox']['requeueSessionPrompt']>()
        .mockResolvedValue(true)
    },
    getSession: (id: string): Session | undefined => (id === sessionId ? session : undefined),
    updateSession: (next: Session): Session[] => {
      session = next
      return [session]
    },
    isRunActive: vi.fn(() => false),
    beginRun: vi.fn(),
    finishRun: vi.fn(),
    persistSessions: vi.fn<Dependencies['persistSessions']>().mockResolvedValue(undefined),
    launchRun: vi.fn()
  }
  return {
    runner: createQueuedPromptRunner(),
    dependencies,
    advanceContext: (): void => {
      session = { ...session, contextEpoch: admission.contextEpoch + 1 }
    }
  }
}

describe('queued prompt runner', () => {
  it('launches once and waits for the prepared conversation to be saved', async () => {
    const { runner, dependencies } = setup()
    const saving = Promise.withResolvers<void>()
    const finishSave = Promise.withResolvers<void>()
    dependencies.persistSessions.mockImplementationOnce(() => {
      saving.resolve()
      return finishSave.promise
    })

    const draining = runner.drainNext(sessionId, dependencies)
    await saving.promise
    try {
      await runner.drainNext(sessionId, dependencies)
      expect(dependencies.inbox.claimNextSessionPrompt).toHaveBeenCalledExactlyOnceWith(
        sessionId,
        3
      )
      expect(dependencies.persistSessions).toHaveBeenCalledExactlyOnceWith([
        expect.objectContaining({
          id: sessionId,
          messages: [
            expect.objectContaining({ id: 'user-1' }),
            expect.objectContaining({ id: 'assistant-1', content: '' })
          ]
        })
      ])
      expect(dependencies.launchRun).not.toHaveBeenCalled()
    } finally {
      finishSave.resolve()
      await draining
    }

    expect(dependencies.launchRun).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        admission,
        contextEpoch: 3,
        assistantMessageId: 'assistant-1',
        messagesBeforeAssistant: [{ id: 'user-1', role: 'user', content: 'Queued request' }]
      })
    )
    expect(runner.isDraining(sessionId)).toBe(false)
  })

  it.each(['claim', 'save'])(
    'cancels a claimed prompt when context advances during %s',
    async (step) => {
      const { runner, dependencies, advanceContext } = setup()
      if (step === 'claim') {
        dependencies.inbox.claimNextSessionPrompt.mockImplementationOnce(async () => {
          advanceContext()
          return admission
        })
      } else {
        dependencies.persistSessions.mockImplementationOnce(async () => {
          advanceContext()
        })
      }

      await runner.drainNext(sessionId, dependencies)

      expect(dependencies.inbox.cancelClaimedSessionPrompt).toHaveBeenCalledExactlyOnceWith(
        admission.id
      )
      expect(dependencies.launchRun).not.toHaveBeenCalled()
      expect(dependencies.inbox.requeueSessionPrompt).not.toHaveBeenCalled()
      expect(dependencies.finishRun).toHaveBeenCalledTimes(step === 'save' ? 1 : 0)
      expect(runner.isDraining(sessionId)).toBe(false)
    }
  )

  it('requeues an admission if a different run starts while claiming it', async () => {
    const { runner, dependencies } = setup()
    dependencies.isRunActive.mockReturnValueOnce(false).mockReturnValue(true)

    await runner.drainNext(sessionId, dependencies)

    expect(dependencies.inbox.requeueSessionPrompt).toHaveBeenCalledExactlyOnceWith(admission.id)
    expect(dependencies.persistSessions).not.toHaveBeenCalled()
    expect(dependencies.launchRun).not.toHaveBeenCalled()
  })

  it('requeues a failed save and releases its local run registration', async () => {
    const { runner, dependencies } = setup()
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    dependencies.persistSessions.mockRejectedValueOnce(new Error('Disk write failed'))

    try {
      await runner.drainNext(sessionId, dependencies)
    } finally {
      warning.mockRestore()
    }

    expect(dependencies.inbox.requeueSessionPrompt).toHaveBeenCalledExactlyOnceWith(admission.id)
    const [, requestId] = dependencies.beginRun.mock.calls[0]
    expect(dependencies.finishRun).toHaveBeenCalledExactlyOnceWith(sessionId, requestId)
    expect(dependencies.launchRun).not.toHaveBeenCalled()
    expect(runner.isDraining(sessionId)).toBe(false)
  })
})
