import type { Session } from '../../../../shared/types'

type PersistSessions = (snapshot: Session[]) => Promise<void>

export function createSessionPersistenceQueue(
  writeSnapshot: PersistSessions,
  cloneSnapshot: (snapshot: Session[]) => Session[]
): PersistSessions {
  let tail = Promise.resolve()

  return async (snapshot) => {
    // The renderer can edit its state while this write is waiting in the queue.
    const captured = cloneSnapshot(snapshot)
    const write = tail.then(() => writeSnapshot(captured))
    // Report the failure to this caller and let later writes proceed.
    tail = write.catch(() => undefined)
    return write
  }
}
