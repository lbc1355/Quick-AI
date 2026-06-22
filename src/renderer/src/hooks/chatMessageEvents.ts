import { SessionResource } from '../../../shared/types'
export {
  applyAgentEventToMessage,
  isRuntimeErrorAssistantMessage,
  mergeAgentEvents,
  prepareMessageForInlineResume
} from '../../../shared/agentEventReducer'

const mergeResourceRanges = (
  ranges: Array<{ start: number; end: number }>
): Array<{ start: number; end: number }> => {
  if (ranges.length <= 1) return ranges
  const sorted = [...ranges].sort((a, b) => a.start - b.start)
  const merged: Array<{ start: number; end: number }> = [sorted[0]]

  for (let i = 1; i < sorted.length; i++) {
    const last = merged[merged.length - 1]
    const current = sorted[i]
    if (current.start <= last.end) {
      last.end = Math.max(last.end, current.end)
    } else {
      merged.push(current)
    }
  }

  return merged
}

export const mergeResourceUpdate = (
  existing: SessionResource | undefined,
  incoming: SessionResource,
  reqId: string
): SessionResource => {
  if (!existing) {
    return { ...incoming, runIds: [reqId] }
  }

  const chunkMap = new Map(existing.chunks.map((chunk) => [chunk.id, chunk]))
  incoming.chunks.forEach((chunk) => {
    chunkMap.set(chunk.id, chunk)
  })
  const newChunks = Array.from(chunkMap.values()).sort((a, b) => (a.offset ?? 0) - (b.offset ?? 0))

  const fetchedRanges = mergeResourceRanges([
    ...(existing.fetchedRanges || []),
    ...(incoming.fetchedRanges || [])
  ])

  const runIds = Array.from(new Set([...(existing.runIds ?? []), reqId]))

  return {
    ...existing,
    title: incoming.title || existing.title,
    totalChars: incoming.totalChars ?? existing.totalChars,
    nextOffset: incoming.nextOffset,
    status: incoming.status,
    summary: incoming.summary ?? existing.summary,
    fetchedRanges,
    runIds,
    chunks: newChunks,
    updatedAt: incoming.updatedAt || Date.now()
  }
}
