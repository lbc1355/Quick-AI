import { describe, it, expect } from 'vitest'
import {
  computeOrphanResourceIds,
  computeResourcePrune,
  moveSessionInSnapshot,
  renameSessionInSnapshot
} from './useSessions'
import { Session, SessionResource } from '../../../shared/types'

function res(id: string, runIds?: string[]): SessionResource {
  return {
    id,
    kind: 'web',
    source: `https://example.com/${id}`,
    status: 'complete',
    ...(runIds ? { runIds } : {}),
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
    resources: resourceIds.map((rid) => res(rid))
  }
}

/** Session whose resources carry runIds, for prune tests. */
function sessionWith(id: string, resources: SessionResource[]): Session {
  return { id, title: id, messages: [], resources }
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

describe('computeResourcePrune', () => {
  it('keeps a resource still touched by a surviving run (multi-run)', () => {
    const target = sessionWith('A', [res('r1', ['runX', 'runY'])])
    const { keptResources, prunedIds, deletableIds } = computeResourcePrune(target, [], ['runX'])
    // Only runX removed; runY survives → r1 kept.
    expect(keptResources.map((r) => r.id)).toEqual(['r1'])
    expect(prunedIds).toEqual([])
    expect(deletableIds).toEqual([])
  })

  it('prunes and deletes a resource whose every run was removed', () => {
    const target = sessionWith('A', [res('r1', ['runX'])])
    const { keptResources, prunedIds, deletableIds } = computeResourcePrune(target, [], ['runX'])
    expect(keptResources).toEqual([])
    expect(prunedIds).toEqual(['r1'])
    expect(deletableIds).toEqual(['r1'])
  })

  it('prunes from the session but does NOT delete a resource another session references', () => {
    const target = sessionWith('A', [res('shared', ['runX'])])
    const other = sessionWith('B', [res('shared', ['runZ'])])
    const { prunedIds, deletableIds } = computeResourcePrune(target, [other], ['runX'])
    expect(prunedIds).toEqual(['shared'])
    expect(deletableIds).toEqual([]) // B still uses it
  })

  it('never prunes a legacy resource without runIds', () => {
    const target = sessionWith('A', [res('legacy')])
    const { keptResources, prunedIds, deletableIds } = computeResourcePrune(target, [], ['runX'])
    expect(keptResources.map((r) => r.id)).toEqual(['legacy'])
    expect(prunedIds).toEqual([])
    expect(deletableIds).toEqual([])
  })

  it('prunes nothing when no runs were removed', () => {
    const target = sessionWith('A', [res('r1', ['runX'])])
    const { keptResources, prunedIds } = computeResourcePrune(target, [], [])
    expect(keptResources.map((r) => r.id)).toEqual(['r1'])
    expect(prunedIds).toEqual([])
  })

  it('handles a target with undefined resources', () => {
    const target: Session = { id: 'A', title: 'A', messages: [] }
    const out = computeResourcePrune(target, [], ['runX'])
    expect(out.keptResources).toEqual([])
    expect(out.prunedIds).toEqual([])
    expect(out.deletableIds).toEqual([])
  })
})

describe('session organization snapshots', () => {
  it('renames from the latest snapshot without dropping streamed message data', () => {
    const latest: Session[] = [
      {
        id: 'A',
        title: 'Chat',
        messages: [{ id: 'm1', role: 'assistant', content: 'latest streamed text' }]
      },
      { id: 'B', title: 'B', messages: [] }
    ]

    const updated = renameSessionInSnapshot(latest, 'A', 'Renamed')

    expect(updated?.[0]).toMatchObject({
      title: 'Renamed',
      titleManuallyEdited: true,
      messages: [{ content: 'latest streamed text' }]
    })
    expect(updated?.[1]).toBe(latest[1])
  })

  it('moves only the target in the supplied latest snapshot', () => {
    const latest = [
      session('A', ['resource-from-stream']),
      { ...session('B', []), projectId: 'old-folder' }
    ]

    const updated = moveSessionInSnapshot(latest, 'B', 'new-folder')

    expect(updated?.[0]).toBe(latest[0])
    expect(updated?.[1].projectId).toBe('new-folder')
  })
})
