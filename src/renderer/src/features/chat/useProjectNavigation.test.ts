import { describe, expect, it } from 'vitest'
import type { Session } from '../../../../shared/types'
import { countSessionsByProject, getUnpersistedActiveSession } from './useProjectNavigation'

const session = (id: string, projectId?: string): Session => ({
  id,
  title: id,
  messages: [],
  projectId
})

describe('project navigation session organization', () => {
  it('recognizes an active draft that is absent from the persisted snapshot', () => {
    const persisted = [session('saved', 'folder-a')]
    const draft = session('draft', 'folder-b')

    expect(getUnpersistedActiveSession(persisted, draft)).toBe(draft)
    expect(getUnpersistedActiveSession(persisted, persisted[0])).toBeUndefined()
  })

  it('includes an unpersisted draft in project counts used by deletion', () => {
    const counts = countSessionsByProject(
      [session('saved', 'folder-a')],
      session('draft', 'folder-b')
    )

    expect(counts.get('folder-a')).toBe(1)
    expect(counts.get('folder-b')).toBe(1)
  })
})
