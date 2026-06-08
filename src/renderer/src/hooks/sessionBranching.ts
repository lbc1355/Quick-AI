import { Message, SessionResource } from '../../../shared/types'

export const getRunIdsThroughMessage = (messages: Message[], throughIdx: number): string[] => {
  return Array.from(
    new Set(
      messages
        .slice(0, throughIdx + 1)
        .filter((m) => m.role === 'assistant' && m.agentRunId)
        .map((m) => m.agentRunId as string)
    )
  )
}

export const forkResourcesForRuns = (
  resources: SessionResource[] | undefined,
  keptRunIds: string[]
): SessionResource[] => {
  if (!resources || resources.length === 0) return []
  const kept = new Set(keptRunIds)

  return resources
    .map((resource) => {
      const runIds = resource.runIds ?? []
      if (runIds.length === 0) return resource
      const retainedRunIds = runIds.filter((id) => kept.has(id))
      if (retainedRunIds.length === 0) return undefined
      return {
        ...resource,
        runIds: retainedRunIds
      }
    })
    .filter((resource): resource is SessionResource => !!resource)
}
