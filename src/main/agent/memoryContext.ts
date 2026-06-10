import { buildMemoryContextPrompt } from './memoryPrompts'
import { readAlways, readSummaryIndex } from '../memory/memoryStore'

/** Plain-chat memory context (always.md + on-demand index). */
export function loadMemoryContextPrompt(): string {
  try {
    return buildMemoryContextPrompt()
  } catch (error) {
    console.warn('Failed to load memory context:', (error as Error).message)
    return ''
  }
}

/**
 * Agent system-prompt memory segment: full `always.md` injected as constant rules,
 * plus the on-demand index telling the model to call `read_memory` for details.
 */
export function buildMemoryInjection(): string {
  try {
    const always = readAlways().trim()
    const summary = readSummaryIndex().trim()
    const sections: string[] = []

    if (hasSignal(always)) {
      sections.push(
        '\n### Permanent Memory (Always)',
        'These durable notes apply to every task. Honor them unless the user overrides:',
        always,
        ''
      )
    }

    sections.push(
      '\n### On-Demand Memory',
      'A durable memory library lives on disk. The index below lists available Task Groups.',
      'At the start of the task, judge whether any group is relevant; if so, call `read_memory` with its name before proceeding.',
      'When the task finishes and produced durable, reusable knowledge or a stable user preference, use `write_memory` to record it.',
      ''
    )
    if (hasSignal(summary)) {
      sections.push(summary)
    } else {
      sections.push('_(memory index is currently empty)_')
    }
    return sections.join('\n')
  } catch (error) {
    console.warn('Failed to build memory injection:', (error as Error).message)
    return ''
  }
}

function hasSignal(content: string): boolean {
  const meaningful = content
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#') && !l.startsWith('>') && !l.startsWith('<!--'))
  return meaningful.length > 0
}
