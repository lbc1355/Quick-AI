import { describe, expect, it } from 'vitest'
import { buildShellDetails, trimLivePreview } from './shellResult'

describe('shellResult', () => {
  it('builds shell details with cwd, exit metadata, stdout, and stderr', () => {
    const details = buildShellDetails({
      root: 'D:\\Git\\Quick Ai',
      code: 0,
      durationMs: 12,
      stdoutText: 'hello\n',
      stderrText: 'warn\n'
    })

    expect(details).toContain('Cwd: D:\\Git\\Quick Ai')
    expect(details).toContain('Exit Code: 0')
    expect(details).toContain('Duration: 12ms')
    expect(details).toContain('Stdout:\nhello')
    expect(details).toContain('Stderr:\nwarn')
  })

  it('trims long live previews to the configured tail window', () => {
    const result = trimLivePreview('x'.repeat(70 * 1024))

    expect(result).toContain('[Live output preview truncated')
    expect(result.length).toBeLessThan(66 * 1024)
  })
})
