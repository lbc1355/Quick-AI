import { listMemories, listMemoryDocs } from '../database'
import { buildMemoryContextPrompt, buildMemoryDocContextPrompt } from './memoryPrompts'

export function loadMemoryContextPrompt(sessionId?: string): string {
  try {
    const docs = listMemoryDocs({ sessionId, includeSession: true, status: 'current', limit: 6 })
    if (docs.length > 0) return buildMemoryDocContextPrompt(docs)
    return buildMemoryContextPrompt(listMemories({ sessionId, limit: 12 }))
  } catch (error) {
    console.warn('Failed to load memory context:', (error as Error).message)
    return ''
  }
}
