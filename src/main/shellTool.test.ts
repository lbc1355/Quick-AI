import { describe, it, expect } from 'vitest'
import { ToolRegistry, getWorkspaceRoot } from './toolRegistry'
import { decodeShellOutputForDisplay } from './tools/shell'

describe('Shell Tool Execution', () => {
  const workspaceRoot = getWorkspaceRoot()

  it('decodes legacy Windows code page output for display', () => {
    const gbkBytes = Buffer.from([0xd6, 0xd0, 0xce, 0xc4])
    expect(decodeShellOutputForDisplay(gbkBytes, 'gbk')).toBe('中文')
  })

  it('runs a simple command and captures stdout', async () => {
    const context = { reqId: 'test-req', signal: new AbortController().signal }
    const res = await ToolRegistry.shell.execute(
      { command: 'node -e "console.log(\'hello from shell\')"' },
      context
    )

    expect(res.resultForModel).toContain('Exit Code: 0')
    expect(res.resultForModel).toContain('Stdout:\nhello from shell')
    expect(res.resultForUi.title).toContain('Execute Command')
    expect(res.resultForUi.summary).toContain('exited with code 0')
    expect(res.resultForUi.details).toContain('Stdout:\nhello from shell')
  })

  it('captures stderr and reports non-zero exit codes', async () => {
    const context = { reqId: 'test-req', signal: new AbortController().signal }
    const res = await ToolRegistry.shell.execute(
      { command: 'node -e "console.error(\'err msg\'); process.exit(42)"' },
      context
    )

    expect(res.resultForModel).toContain('Exit Code: 42')
    expect(res.resultForModel).toContain('Stderr:\nerr msg')
    expect(res.resultForUi.summary).toContain('exited with code 42')
    expect(res.resultForUi.details).toContain('Stderr:\nerr msg')
  })

  it('streams shell output while the command is still running', async () => {
    const outputEvents: string[] = []
    const context = {
      reqId: 'test-req',
      signal: new AbortController().signal,
      emitOutput: ({ content }: { content: string }) => outputEvents.push(content)
    }

    const res = await ToolRegistry.shell.execute(
      { command: "node -e \"console.log('first'); setTimeout(() => console.log('second'), 250)\"" },
      context
    )

    expect(outputEvents.some((content) => content.includes('first'))).toBe(true)
    expect(res.resultForUi.details).toContain('Stdout:\nfirst')
    expect(res.resultForUi.details).toContain('second')
  })

  it('executes in the workspace root directory', async () => {
    const context = { reqId: 'test-req', signal: new AbortController().signal }
    const res = await ToolRegistry.shell.execute(
      { command: 'node -e "console.log(process.cwd())"' },
      context
    )

    // Normalize paths for comparison (especially for Windows case/slashes differences)
    const returnedCwd = res.resultForModel.match(/Stdout:\s*([^\r\n]+)/)?.[1]?.trim() || ''
    expect(returnedCwd.toLowerCase().replace(/\\/g, '/')).toBe(
      workspaceRoot.toLowerCase().replace(/\\/g, '/')
    )
  })

  it('handles cancellation via AbortSignal', async () => {
    const controller = new AbortController()
    const context = { reqId: 'test-req', signal: controller.signal }

    // Start a long-running process and cancel it quickly
    const executePromise = ToolRegistry.shell.execute(
      { command: 'node -e "setTimeout(() => {}, 10000)"' },
      context
    )

    setTimeout(() => {
      controller.abort()
    }, 150)

    const res = await executePromise
    expect(res.resultForUi.summary).toContain('cancelled')
    expect(res.resultForModel).toContain('cancelled')
  })
})
