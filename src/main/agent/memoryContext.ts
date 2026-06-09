import { listMemories } from '../database'
import { buildMemoryContextPrompt } from './memoryPrompts'

export function loadMemoryContextPrompt(sessionId?: string): string {
  try {
    return buildMemoryContextPrompt(listMemories({ sessionId, limit: 12 }))
  } catch (error) {
    console.warn('Failed to load memory context:', (error as Error).message)
    return ''
  }
}
