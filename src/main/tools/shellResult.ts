const SHELL_LIVE_PREVIEW_CHARS = 64 * 1024

export function trimLivePreview(details: string): string {
  if (details.length <= SHELL_LIVE_PREVIEW_CHARS) return details
  return `[Live output preview truncated to last ${SHELL_LIVE_PREVIEW_CHARS} chars]\n${details.slice(-SHELL_LIVE_PREVIEW_CHARS)}`
}

export function buildShellDetails(args: {
  root: string
  code?: number
  durationMs?: number
  status?: string
  stdoutText?: string
  stderrText?: string
  executionError?: string
}): string {
  const lines = [
    `Cwd: ${args.root}`,
    args.code !== undefined ? `Exit Code: ${args.code}` : '',
    args.durationMs !== undefined ? `Duration: ${args.durationMs}ms` : '',
    args.status ? `Status: ${args.status}` : ''
  ].filter(Boolean)

  if (args.stdoutText) {
    lines.push('', `Stdout:\n${args.stdoutText.trimEnd()}`)
  }
  if (args.stderrText) {
    lines.push('', `Stderr:\n${args.stderrText.trimEnd()}`)
  }
  if (args.executionError) {
    lines.push('', `Execution Error:\n${args.executionError}`)
  }

  return lines.join('\n')
}
