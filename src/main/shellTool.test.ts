import { describe, it, expect, afterEach } from 'vitest'
import { ToolRegistry, getWorkspaceRoot } from './toolRegistry'
import { decodeShellOutputForDisplay } from './tools/shell'
import { clearBackgroundShellProcessesForTests } from './tools/backgroundShell'

describe('Shell Tool Execution', () => {
  const workspaceRoot = getWorkspaceRoot()
  const nodeEvalCommand = (script: string): string =>
    `"${process.execPath}" -e ${JSON.stringify(script)}`
  afterEach(async () => {
    await clearBackgroundShellProcessesForTests()
  })

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

  it('starts long-running commands in the background and reads output later', async () => {
    const context = { reqId: 'test-req', signal: new AbortController().signal }
    const startedAt = Date.now()

    const start = await ToolRegistry.shell.execute(
      {
        command: nodeEvalCommand("console.log('background ready'); setTimeout(() => {}, 5000)"),
        background: true,
        waitMs: 200,
        maxChars: 2000
      },
      context
    )

    expect(Date.now() - startedAt).toBeLessThan(2000)
    expect(start.resultForModel).toContain('background ready')
    const processId = start.resultForModel.match(/Background ID: (\S+)/)?.[1]
    expect(processId).toBeDefined()

    const list = await ToolRegistry.shell_background_list.execute({}, context)
    expect(list.resultForModel).toContain(processId!)

    const read = await ToolRegistry.shell_background_read.execute(
      { processId, maxChars: 2000 },
      context
    )
    expect(read.resultForModel).toContain('background ready')

    const stop = await ToolRegistry.shell_background_stop.execute(
      { processId, maxChars: 2000 },
      context
    )
    expect(stop.resultForModel).toContain(`Background ID: ${processId}`)
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
