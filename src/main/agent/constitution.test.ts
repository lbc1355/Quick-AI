import { describe, it, expect } from 'vitest'
import { evaluateToolGuard, DEFAULT_CONSTITUTION } from './constitution'

describe('evaluateToolGuard', () => {
  it('leaves a benign call at its base permission', () => {
    expect(evaluateToolGuard('web_search', { query: 'hi' }, 'allow', 'low')).toEqual({
      action: 'allow',
      reason: undefined
    })
    expect(evaluateToolGuard('file_read', { path: 'src/a.ts' }, 'ask', 'low').action).toBe('ask')
  })

  it('denies a file path outside the workspace and project roots', () => {
    const v = evaluateToolGuard('file_write', { path: '../../etc/passwd' }, 'allow', 'medium')
    expect(v.action).toBe('deny')
    expect(v.reason).toContain('outside the global workspace and current project root')
  })

  it('asks for permission when a mutation targets the project root', () => {
    const v = evaluateToolGuard(
      'file_write',
      { path: 'src/a.ts' },
      'allow',
      'medium',
      DEFAULT_CONSTITUTION,
      false,
      { projectRoot: 'D:/example/project' }
    )
    expect(v.action).toBe('ask')
    expect(v.reason).toContain('modify the project root')
  })

  it('escalates allow -> ask for a sensitive file target', () => {
    const v = evaluateToolGuard('file_write', { path: 'config/.env' }, 'allow', 'medium')
    expect(v.action).toBe('ask')
    expect(v.reason).toContain('sensitive')
  })

  it('never weakens a stricter base permission', () => {
    // Base 'deny' is not passed through escalation (caller skips), but if asked, never downgrades.
    expect(evaluateToolGuard('file_read', { path: 'src/a.ts' }, 'ask', 'low').action).toBe('ask')
    // A sensitive file under base 'ask' stays 'ask' (not downgraded to allow).
    expect(evaluateToolGuard('file_read', { path: '.env' }, 'ask', 'low').action).toBe('ask')
  })

  it('classifies shell commands by danger level', () => {
    expect(evaluateToolGuard('shell', { command: 'ls -la' }, 'allow', 'high').action).toBe('ask') // high-risk -> ask
    expect(evaluateToolGuard('shell', { command: 'npm install' }, 'allow', 'high').action).toBe(
      'ask'
    )
    const danger = evaluateToolGuard('shell', { command: 'rm -rf /' }, 'allow', 'high')
    expect(danger.action).toBe('deny')
    expect(danger.reason).toContain('guardrail')
  })

  it('asks for ordinary multi-line shell commands but denies a dangerous segment', () => {
    expect(
      evaluateToolGuard('shell', { command: 'ls\ncat package.json' }, 'allow', 'high').action
    ).toBe('ask')
    expect(
      evaluateToolGuard('shell', { command: 'ls\nrm -rf /' }, 'allow', 'high').action
    ).toBe('deny')
  })

  it('escalates any high-risk tool to at least ask', () => {
    const v = evaluateToolGuard('some_high_risk_tool', {}, 'allow', 'high')
    expect(v.action).toBe('ask')
    expect(v.reason).toContain('high-risk')
  })

  it('skips the high-risk escalation when the tool is run-approved', () => {
    const v = evaluateToolGuard('shell', {}, 'allow', 'high', DEFAULT_CONSTITUTION, true)
    expect(v.action).toBe('allow')
    expect(v.reason).toBeUndefined()
  })

  it('exposes a default constitution with the expected arg keys', () => {
    expect(DEFAULT_CONSTITUTION.pathArgKeys).toContain('path')
    expect(DEFAULT_CONSTITUTION.pathArgKeys).toContain('sourcePath')
    expect(DEFAULT_CONSTITUTION.pathArgKeys).toContain('destinationPath')
    expect(DEFAULT_CONSTITUTION.pathArgKeys).toContain('targetPath')
    expect(DEFAULT_CONSTITUTION.commandArgKeys).toContain('command')
    expect(DEFAULT_CONSTITUTION.escalateHighRiskToAsk).toBe(true)
  })
})
