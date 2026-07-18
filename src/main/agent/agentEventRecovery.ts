import { compactAgentEvents } from '../../shared/agentEventCompactor'
import { replayAgentEvents } from '../../shared/agentEventReplay'
import type { Message, Session } from '../../shared/types'
import type { AgentEventJournalSnapshot } from './agentEventJournal'

const mergeJournalIntoMessage = (message: Message, journal: AgentEventJournalSnapshot): Message => {
  const historicalEvents = (message.agentEvents || []).filter(
    (event) => event.runId !== journal.runId
  )
  const events = compactAgentEvents([...historicalEvents, ...journal.events])
  const replayed = replayAgentEvents(journal.events, {
    message: {
      id: message.id,
      role: 'assistant',
      content: '',
      reasoning_content: '',
      agentRunId: journal.runId,
      agentRunIds: message.agentRunIds
    }
  })
  const hasFinal = journal.events.some((event) => event.type === 'final')
  const agentRunIds = Array.from(
    new Set([...(message.agentRunIds || []), message.agentRunId, journal.runId].filter(Boolean))
  ) as string[]

  return {
    ...message,
    agentRunId: journal.runId,
    agentRunIds,
    agentEvents: events,
    content: hasFinal ? replayed.content : message.content,
    reasoning_content: replayed.reasoning_content || message.reasoning_content
  }
}

export function mergeAgentEventJournalsIntoSessions(
  sessions: Session[],
  journals: AgentEventJournalSnapshot[]
): Session[] {
  const journalsByMessage = new Map<string, AgentEventJournalSnapshot[]>()
  for (const journal of journals) {
    if (!journal.assistantMessageId) continue
    const key = `${journal.sessionId}\u0000${journal.assistantMessageId}`
    const existing = journalsByMessage.get(key)
    if (existing) existing.push(journal)
    else journalsByMessage.set(key, [journal])
  }
  for (const messageJournals of journalsByMessage.values()) {
    messageJournals.sort((a, b) => a.startedAt - b.startedAt || a.runId.localeCompare(b.runId))
  }

  return sessions.map((session) => {
    let changed = false
    const messages = session.messages.map((message) => {
      const messageJournals = journalsByMessage.get(`${session.id}\u0000${message.id}`)
      if (!messageJournals || messageJournals.length === 0) return message
      changed = true
      return messageJournals.reduce(mergeJournalIntoMessage, message)
    })
    return changed ? { ...session, messages } : session
  })
}
