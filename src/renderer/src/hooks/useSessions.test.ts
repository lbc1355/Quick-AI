import { describe, it, expect } from 'vitest'
import { computeOrphanResourceIds } from './useSessions'
import { Session, SessionResource } from '../../../shared/types'

function res(id: string): SessionResource {
  return {
    id,
    kind: 'web',
    source: `https://example.com/${id}`,
    status: 'complete',
    chunks: [],
    createdAt: 1,
    updatedAt: 1
  }
}

function session(id: string, resourceIds: string[]): Session {
  return {
    id,
    title: id,
    messages: [],
    resources: resourceIds.map(res)
  }
}

describe('computeOrphanResourceIds', () => {
  it('returns all of the target resources when no survivor references them', () => {
    const target = session('A', ['r1', 'r2'])
    const survivors = [session('B', ['r3'])]
    expect(computeOrphanResourceIds(target, survivors).sort()).toEqual(['r1', 'r2'])
  })

  it('does NOT delete a resource shared with a surviving session', () => {
    const target = session('A', ['shared', 'onlyA'])
    const survivors = [session('B', ['shared'])]
    // "shared" is still referenced by B, so only "onlyA" is an orphan.
    expect(computeOrphanResourceIds(target, survivors)).toEqual(['onlyA'])
  })

  it('returns an empty array when every target resource is shared', () => {
    const target = session('A', ['r1', 'r2'])
    const survivors = [session('B', ['r1']), session('C', ['r2'])]
    expect(computeOrphanResourceIds(target, survivors)).toEqual([])
  })

  it('handles a target with undefined resources', () => {
    const target: Session = { id: 'A', title: 'A', messages: [] }
    const survivors = [session('B', ['r1'])]
    expect(computeOrphanResourceIds(target, survivors)).toEqual([])
  })

  it('handles survivors with undefined resources', () => {
    const target = session('A', ['r1'])
    const survivors: Session[] = [{ id: 'B', title: 'B', messages: [] }]
    expect(computeOrphanResourceIds(target, survivors)).toEqual(['r1'])
  })

  it('treats an empty survivor list as all-orphaned', () => {
    const target = session('A', ['r1', 'r2'])
    expect(computeOrphanResourceIds(target, []).sort()).toEqual(['r1', 'r2'])
  })
})
