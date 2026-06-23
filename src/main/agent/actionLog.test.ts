import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { existsSync, rmSync, mkdtempSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { ActionLog, ActionRecord } from './actionLog'

function makeRecord(overrides: Partial<ActionRecord> = {}): ActionRecord {
  return {
    callId: 'call-1',
    reqId: 'run-1',
    turnIndex: 1,
    timestamp: 1000,
    toolName: 'fetch_url',
    args: { url: 'https://example.com' },
    resultStatus: 'success',
    resultSummary: 'fetched ok',
    resultSize: 10,
    resultInOutputStore: false,
    permission: 'allow',
    durationMs: 42,
    ...overrides
  }
}

describe('ActionLog (in-memory)', () => {
  it('appends and lists records newest-first', () => {
    const log = new ActionLog()
    log.append(makeRecord({ callId: 'a', turnIndex: 1 }))
    log.append(makeRecord({ callId: 'b', turnIndex: 2 }))

    const list = log.list()
    expect(list).toHaveLength(2)
    expect(list[0].callId).toBe('b') // newest first
    expect(list[1].callId).toBe('a')
  })

  it('filters by toolName', () => {
    const log = new ActionLog()
    log.append(makeRecord({ callId: 'a', toolName: 'fetch_url' }))
    log.append(makeRecord({ callId: 'b', toolName: 'web_search' }))

    const list = log.list({ toolName: 'web_search' })
    expect(list).toHaveLength(1)
    expect(list[0].callId).toBe('b')
  })
  it('filters by fuzzy query across MCP tool names and summaries', () => {
    const log = new ActionLog()
    log.append(makeRecord({ callId: 'a', toolName: 'file_read', resultSummary: 'readme' }))
    log.append(
      makeRecord({
        callId: 'b',
        toolName: 'mcp_codebase-memory-mcp_list_projects',
        resultSummary: 'indexed project list'
      })
    )

    expect(log.list({ query: 'mcp' }).map((r) => r.callId)).toEqual(['b'])
    expect(log.list({ query: 'indexed' }).map((r) => r.callId)).toEqual(['b'])
  })

  it('filters by turn range', () => {
    const log = new ActionLog()
    log.append(makeRecord({ callId: 'a', turnIndex: 1 }))
    log.append(makeRecord({ callId: 'b', turnIndex: 3 }))
    log.append(makeRecord({ callId: 'c', turnIndex: 5 }))

    expect(log.list({ fromTurn: 3 }).map((r) => r.callId)).toEqual(['c', 'b'])
    expect(log.list({ toTurn: 3 }).map((r) => r.callId)).toEqual(['b', 'a'])
    expect(log.list({ fromTurn: 2, toTurn: 4 }).map((r) => r.callId)).toEqual(['b'])
  })

  it('respects the limit (capped at 50)', () => {
    const log = new ActionLog()
    for (let i = 0; i < 60; i++) {
      log.append(makeRecord({ callId: `c${i}`, turnIndex: i }))
    }
    expect(log.list({ limit: 5 })).toHaveLength(5)
    expect(log.list({ limit: 1000 })).toHaveLength(50) // hard cap
  })

  it('gets a full record by callId', () => {
    const log = new ActionLog()
    log.append(makeRecord({ callId: 'a', args: { url: 'https://x.com' } }))
    const rec = log.get('a')
    expect(rec).toBeDefined()
    expect(rec!.args.url).toBe('https://x.com')
    expect(log.get('missing')).toBeUndefined()
  })

  it('redacts sensitive argument keys', () => {
    const log = new ActionLog()
    log.append(makeRecord({ callId: 'a', args: { url: 'https://x.com', apiKey: 'secret123' } }))
    const rec = log.get('a')
    expect(rec!.args.url).toBe('https://x.com')
    expect(rec!.args.apiKey).toBe('[redacted]')
  })

  it('redacts nested sensitive keys', () => {
    const log = new ActionLog()
    log.append(makeRecord({ callId: 'a', args: { config: { token: 'abc', name: 'ok' } } }))
    const rec = log.get('a')
    const config = rec!.args.config as Record<string, unknown>
    expect(config.token).toBe('[redacted]')
    expect(config.name).toBe('ok')
  })

  it('evicts oldest records past the 500 cap', () => {
    const log = new ActionLog()
    for (let i = 0; i < 510; i++) {
      log.append(makeRecord({ callId: `c${i}`, turnIndex: i }))
    }
    expect(log.size).toBe(500)
    // Oldest (c0..c9) evicted
    expect(log.get('c0')).toBeUndefined()
    expect(log.get('c9')).toBeUndefined()
    expect(log.get('c10')).toBeDefined()
  })
})

describe('ActionLog.deleteByRunIds', () => {
  it('removes only records of the given runs and returns the count', () => {
    const log = new ActionLog()
    log.append(makeRecord({ callId: 'a', reqId: 'A' }))
    log.append(makeRecord({ callId: 'b', reqId: 'B' }))
    log.append(makeRecord({ callId: 'c', reqId: 'C' }))

    const removed = log.deleteByRunIds(['B'])
    expect(removed).toBe(1)
    expect(log.get('a')).toBeDefined()
    expect(log.get('b')).toBeUndefined()
    expect(log.get('c')).toBeDefined()
  })

  it('removes every record sharing a run id', () => {
    const log = new ActionLog()
    log.append(makeRecord({ callId: 'a', reqId: 'X' }))
    log.append(makeRecord({ callId: 'b', reqId: 'X' }))
    log.append(makeRecord({ callId: 'c', reqId: 'Y' }))

    expect(log.deleteByRunIds(['X'])).toBe(2)
    expect(log.size).toBe(1)
    expect(log.get('c')).toBeDefined()
  })

  it('returns 0 for empty input or unknown runs without removing anything', () => {
    const log = new ActionLog()
    log.append(makeRecord({ callId: 'a', reqId: 'A' }))
    expect(log.deleteByRunIds([])).toBe(0)
    expect(log.deleteByRunIds(['nope'])).toBe(0)
    expect(log.size).toBe(1)
  })
})

describe('ActionLog.copyByRunIdsTo', () => {
  it('copies only records from selected runs', () => {
    const source = new ActionLog()
    const target = new ActionLog()
    source.append(makeRecord({ callId: 'a', reqId: 'A' }))
    source.append(makeRecord({ callId: 'b', reqId: 'B' }))
    source.append(makeRecord({ callId: 'c', reqId: 'A' }))

    expect(source.copyByRunIdsTo(target, ['A'])).toBe(2)
    expect(target.size).toBe(2)
    expect(target.get('a')).toBeDefined()
    expect(target.get('b')).toBeUndefined()
    expect(target.get('c')).toBeDefined()
  })

  it('returns 0 for empty run ids', () => {
    const source = new ActionLog()
    const target = new ActionLog()
    source.append(makeRecord({ callId: 'a', reqId: 'A' }))

    expect(source.copyByRunIdsTo(target, [])).toBe(0)
    expect(target.size).toBe(0)
  })
})

describe('ActionLog (persistence)', () => {
  let dir: string
  let filePath: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'actionlog-'))
    filePath = join(dir, 'sub', 'session.jsonl')
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('persists records to disk and reloads them', () => {
    const log = new ActionLog(filePath)
    log.append(makeRecord({ callId: 'a', turnIndex: 1 }))
    log.append(makeRecord({ callId: 'b', turnIndex: 2 }))
    expect(existsSync(filePath)).toBe(true)

    // A new instance loads the persisted history
    const reloaded = new ActionLog(filePath)
    expect(reloaded.size).toBe(2)
    expect(reloaded.get('a')).toBeDefined()
    expect(reloaded.get('b')).toBeDefined()
  })

  it('deleteByRunIds rewrites the file so removed runs are gone on reload', () => {
    const log = new ActionLog(filePath)
    log.append(makeRecord({ callId: 'a', reqId: 'A' }))
    log.append(makeRecord({ callId: 'b', reqId: 'B' }))
    log.deleteByRunIds(['A'])

    const reloaded = new ActionLog(filePath)
    expect(reloaded.size).toBe(1)
    expect(reloaded.get('a')).toBeUndefined()
    expect(reloaded.get('b')).toBeDefined()
  })

  it('persists redacted args (secrets never hit disk)', () => {
    const log = new ActionLog(filePath)
    log.append(makeRecord({ callId: 'a', args: { password: 'hunter2' } }))

    const reloaded = new ActionLog(filePath)
    expect((reloaded.get('a')!.args as Record<string, unknown>).password).toBe('[redacted]')
  })

  it('survives across two sessions (append continues)', () => {
    const log1 = new ActionLog(filePath)
    log1.append(makeRecord({ callId: 'turn1', turnIndex: 1 }))
    log1.save()

    const log2 = new ActionLog(filePath)
    log2.append(makeRecord({ callId: 'turn2', turnIndex: 1 }))

    const reloaded = new ActionLog(filePath)
    expect(reloaded.size).toBe(2)
    expect(reloaded.get('turn1')).toBeDefined()
    expect(reloaded.get('turn2')).toBeDefined()
  })
})
