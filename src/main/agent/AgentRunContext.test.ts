import { resolve } from 'path'
import { describe, it, expect } from 'vitest'
import {
  AgentRunContext,
  clearSessionApprovals,
  clearSessionSeenFiles,
  getSessionAdditionalRoots
} from './AgentRunContext'
import { globalPermissionManager } from './permissionManager'
import { ActionLog } from './actionLog'

function makeRun(): AgentRunContext {
  return new AgentRunContext('req-test', [], 'all', globalPermissionManager, new ActionLog())
}

function makeSessionRun(reqId: string, sessionId: string): AgentRunContext {
  return new AgentRunContext(
    reqId,
    [],
    'all',
    globalPermissionManager,
    new ActionLog(),
    undefined,
    sessionId
  )
}

describe('AgentRunContext command-prefix approval', () => {
  it('matches an approved prefix for a plain command', () => {
    const run = makeRun()
    run.approveCommandPrefix('git')
    expect(run.isCommandPrefixApproved('git')).toBe(true)
    expect(run.isCommandPrefixApproved('git log --oneline')).toBe(true)
    expect(run.isCommandPrefixApproved('gitfoo')).toBe(false) // not a word boundary
  })

  it('refuses to cover chained commands when any segment prefix is unapproved', () => {
    const run = makeRun()
    run.approveCommandPrefix('git')
    // The unapproved tail must trigger a fresh confirmation, not ride the approved `git` prefix.
    expect(run.isCommandPrefixApproved('git log && rm -rf ~')).toBe(false)
    expect(run.isCommandPrefixApproved('git log; rm -rf /')).toBe(false)
    expect(run.isCommandPrefixApproved('git log | sh')).toBe(false)
    expect(run.isCommandPrefixApproved('git log & sleep 1')).toBe(false)
  })

  it('always refuses command substitution regardless of approved prefixes', () => {
    const run = makeRun()
    run.approveCommandPrefix('git')
    run.approveCommandPrefix('rm')
    expect(run.isCommandPrefixApproved('git $(rm -rf ~)')).toBe(false)
    expect(run.isCommandPrefixApproved('git `rm -rf ~`')).toBe(false)
  })

  it('approves a chained command when EVERY segment prefix was approved (Windows cd idiom)', () => {
    const run = makeRun()
    run.approveCommandPrefix('cd')
    // Only `cd` approved → the `npm` segment still forces a prompt.
    expect(run.isCommandPrefixApproved('cd "C:\\proj" && npm install')).toBe(false)
    run.approveCommandPrefix('npm')
    // Now both segments are covered.
    expect(run.isCommandPrefixApproved('cd "C:\\proj" && npm install')).toBe(true)
    expect(run.isCommandPrefixApproved('cd "C:\\proj\\sub" && npm run dev')).toBe(true)
    // A different unapproved command in the chain still prompts.
    expect(run.isCommandPrefixApproved('cd "C:\\proj" && del "a.md"')).toBe(false)
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

describe('AgentRunContext session-scoped approval inheritance', () => {
  it('carries tool and prefix approvals to a later run of the same session', () => {
    clearSessionApprovals('sess-inherit')
    const run1 = makeSessionRun('req-1', 'sess-inherit')
    run1.approveTool('shell')
    run1.approveCommandPrefix('cd')

    // A new user message starts a fresh run with a new reqId, same session.
    const run2 = makeSessionRun('req-2', 'sess-inherit')
    expect(run2.isToolApproved('shell')).toBe(true)
    expect(run2.isCommandPrefixApproved('cd src')).toBe(true)
  })

  it('does not leak approvals across different sessions', () => {
    clearSessionApprovals('sess-x')
    clearSessionApprovals('sess-y')
    const runX = makeSessionRun('req-x', 'sess-x')
    runX.approveTool('shell')
    runX.approveCommandPrefix('git')

    const runY = makeSessionRun('req-y', 'sess-y')
    expect(runY.isToolApproved('shell')).toBe(false)
    expect(runY.isCommandPrefixApproved('git log')).toBe(false)
  })

  it('clearSessionApprovals resets a session so new runs start clean', () => {
    clearSessionApprovals('sess-reset')
    makeSessionRun('req-a', 'sess-reset').approveCommandPrefix('npm')
    clearSessionApprovals('sess-reset')

    const after = makeSessionRun('req-b', 'sess-reset')
    expect(after.isCommandPrefixApproved('npm install')).toBe(false)
  })

  it('carries additional roots to a later run of the same session', () => {
    clearSessionApprovals('sess-roots')
    const rootPath = resolve('D:/reference-project')
    const run1 = makeSessionRun('req-root-1', 'sess-roots')
    run1.addAdditionalRoot(rootPath, 'Reference')

    expect(getSessionAdditionalRoots('sess-roots')).toMatchObject([
      { path: rootPath, label: 'Reference' }
    ])

    const run2 = makeSessionRun('req-root-2', 'sess-roots')
    expect(run2.getAdditionalRootPaths()).toEqual([rootPath])

    clearSessionApprovals('sess-roots')
    expect(getSessionAdditionalRoots('sess-roots')).toEqual([])
  })

  it('runs without a sessionId do not share approvals', () => {
    const a = makeRun()
    a.approveCommandPrefix('rm')
    const b = makeRun()
    expect(b.isCommandPrefixApproved('rm -rf')).toBe(false)
  })
})

describe('AgentRunContext session-scoped seen-file inheritance', () => {
  it('carries seen files to a later run of the same session', () => {
    clearSessionApprovals('sess-seen')
    const run1 = makeSessionRun('req-seen-1', 'sess-seen')
    run1.markFileSeen('C:/project/src/a.ts')

    // A new user message starts a fresh run with a new reqId, same session.
    const run2 = makeSessionRun('req-seen-2', 'sess-seen')
    expect(run2.hasSeenFile('C:\\project\\src\\a.ts')).toBe(true)
  })

  it('does not leak seen files across different sessions', () => {
    clearSessionApprovals('sess-seen-x')
    clearSessionApprovals('sess-seen-y')
    const runX = makeSessionRun('req-seen-x', 'sess-seen-x')
    runX.markFileSeen('C:/project/src/x.ts')

    const runY = makeSessionRun('req-seen-y', 'sess-seen-y')
    expect(runY.hasSeenFile('C:/project/src/x.ts')).toBe(false)
  })

  it('clearSessionApprovals resets seen files so new runs start clean', () => {
    clearSessionApprovals('sess-seen-reset')
    makeSessionRun('req-seen-a', 'sess-seen-reset').markFileSeen('C:/project/src/r.ts')
    clearSessionApprovals('sess-seen-reset')

    const after = makeSessionRun('req-seen-b', 'sess-seen-reset')
    expect(after.hasSeenFile('C:/project/src/r.ts')).toBe(false)
  })

  it('runs without a sessionId do not share seen files', () => {
    const a = makeRun()
    a.markFileSeen('C:/project/src/solo.ts')
    const b = makeRun()
    expect(b.hasSeenFile('C:/project/src/solo.ts')).toBe(false)
  })

  it('clearSessionSeenFiles drops a session seen set so new runs re-demand a read', () => {
    clearSessionApprovals('sess-seen-clear')
    makeSessionRun('req-seen-a', 'sess-seen-clear').markFileSeen('C:/project/src/seen.ts')
    clearSessionSeenFiles('sess-seen-clear')

    const after = makeSessionRun('req-seen-b', 'sess-seen-clear')
    expect(after.hasSeenFile('C:/project/src/seen.ts')).toBe(false)
  })
})
