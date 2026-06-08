import { describe, it, expect } from 'vitest'
import { AgentRunContext } from './AgentRunContext'
import { globalPermissionManager } from './permissionManager'
import { ActionLog } from './actionLog'

function makeRun(): AgentRunContext {
  return new AgentRunContext('req-test', [], 'all', globalPermissionManager, new ActionLog())
}

describe('AgentRunContext command-prefix approval', () => {
  it('matches an approved prefix for a plain command', () => {
    const run = makeRun()
    run.approveCommandPrefix('git')
    expect(run.isCommandPrefixApproved('git')).toBe(true)
    expect(run.isCommandPrefixApproved('git log --oneline')).toBe(true)
    expect(run.isCommandPrefixApproved('gitfoo')).toBe(false) // not a word boundary
  })

  it('refuses to cover chained or substituted commands even when the prefix matches', () => {
    const run = makeRun()
    run.approveCommandPrefix('git')
    // The dangerous tail must trigger a fresh confirmation, not ride the approved prefix.
    expect(run.isCommandPrefixApproved('git log && rm -rf ~')).toBe(false)
    expect(run.isCommandPrefixApproved('git log; rm -rf /')).toBe(false)
    expect(run.isCommandPrefixApproved('git log | sh')).toBe(false)
    expect(run.isCommandPrefixApproved('git log & sleep 1')).toBe(false)
    expect(run.isCommandPrefixApproved('git $(rm -rf ~)')).toBe(false)
    expect(run.isCommandPrefixApproved('git `rm -rf ~`')).toBe(false)
  })

  it('does not approve a command whose prefix was never approved', () => {
    const run = makeRun()
    run.approveCommandPrefix('git')
    expect(run.isCommandPrefixApproved('npm install')).toBe(false)
  })

  it('tracks tool-level approval independently', () => {
    const run = makeRun()
    expect(run.isToolApproved('shell')).toBe(false)
    run.approveTool('shell')
    expect(run.isToolApproved('shell')).toBe(true)
  })
})

describe('AgentRunContext sessionId', () => {
  it('defaults to undefined and carries a provided sessionId', () => {
    const noSession = new AgentRunContext('r1', [], 'all', globalPermissionManager, new ActionLog())
    expect(noSession.sessionId).toBeUndefined()

    const withSession = new AgentRunContext(
      'r2',
      [],
      'all',
      globalPermissionManager,
      new ActionLog(),
      undefined,
      'sess-A'
    )
    expect(withSession.sessionId).toBe('sess-A')
  })
})
