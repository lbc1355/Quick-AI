import { describe, it, expect } from 'vitest'
import { formatEnvironmentReport, EnvironmentSnapshot } from './environmentProbe'

function makeSnapshot(overrides: Partial<EnvironmentSnapshot> = {}): EnvironmentSnapshot {
  return {
    os: {
      platform: 'win32',
      release: '10.0.22631',
      shell: 'cmd.exe',
      homedir: 'C:\\Users\\tester',
      workspaceRoot: 'C:\\Users\\tester\\quickai'
    },
    tools: [
      { name: 'git', found: true, version: 'git version 2.43.0' },
      { name: 'python', found: true, version: 'Python 3.12.1' },
      { name: 'docker', found: false },
      { name: 'go', found: false }
    ],
    defaultPython: 'C:\\Python312\\python.exe',
    condaEnvs: 'base    *  C:\\miniconda3\nml         C:\\miniconda3\\envs\\ml',
    dirs: [
      { name: 'Desktop', path: 'C:\\Users\\tester\\Desktop', exists: true },
      { name: 'Documents', path: 'C:\\Users\\tester\\Documents', exists: true },
      { name: 'Downloads', path: 'C:\\Users\\tester\\Downloads', exists: false }
    ],
    ...overrides
  }
}

describe('formatEnvironmentReport', () => {
  it('renders all sections by default', () => {
    const report = formatEnvironmentReport(makeSnapshot())
    expect(report).toContain('platform: win32 (10.0.22631)')
    expect(report).toContain('home: C:\\Users\\tester')
    expect(report).toContain('git: git version 2.43.0')
    expect(report).toContain('python: Python 3.12.1')
    expect(report).toContain('default python: C:\\Python312\\python.exe')
    expect(report).toContain('conda env list:')
    expect(report).toContain('Desktop: C:\\Users\\tester\\Desktop')
  })

  it('groups uninstalled tools under "Not found"', () => {
    const report = formatEnvironmentReport(makeSnapshot())
    expect(report).toMatch(/Not found: .*docker/)
    expect(report).toMatch(/Not found: .*go/)
    // Missing tools must not appear in the installed list with a version.
    expect(report).not.toContain('docker:')
  })

  it('reports folder existence and path, never contents', () => {
    const report = formatEnvironmentReport(makeSnapshot())
    expect(report).toContain('Documents: C:\\Users\\tester\\Documents')
    // A non-existent dir shows "(not present)" rather than a path.
    expect(report).toContain('Downloads: (not present)')
    // The section header makes the privacy boundary explicit.
    expect(report).toContain('contents not listed')
  })

  it('honors the include filter (tools only)', () => {
    const report = formatEnvironmentReport(makeSnapshot(), ['tools'])
    expect(report).toContain('Installed tools:')
    expect(report).not.toContain('OS:')
    expect(report).not.toContain('Standard folders')
    expect(report).not.toContain('Package environments:')
  })

  it('handles a machine with no probed tools and no conda', () => {
    const report = formatEnvironmentReport(
      makeSnapshot({
        tools: [
          { name: 'git', found: false },
          { name: 'node', found: false }
        ],
        defaultPython: undefined,
        condaEnvs: undefined
      })
    )
    expect(report).toContain('(none of the probed tools were found)')
    expect(report).toContain('default python: n/a')
    expect(report).toContain('conda: not available')
  })
})
