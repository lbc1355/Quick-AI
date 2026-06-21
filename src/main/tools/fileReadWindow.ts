import { ToolArgs } from '../../shared/types'

export interface FileReadWindow {
  startLine: number
  endLine: number
  mode: string
  note?: string
}

function normalizeLineNumberArg(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(1, Math.floor(value))
    : fallback
}

function normalizeNonNegativeLineArg(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, Math.floor(value))
    : fallback
}

function normalizeSignedIntegerArg(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.floor(value) : fallback
}

export function buildNumberedLines(lines: string[], startLine: number): string {
  const width = String(startLine + lines.length - 1).length
  return lines
    .map((line, index) => `${String(startLine + index).padStart(width, ' ')} | ${line}`)
    .join('\n')
}

export function calculateReadWindow(args: ToolArgs, totalLines: number): FileReadWindow {
  const requestedLimit = Math.min(normalizeLineNumberArg(args.limit, 1000), 2000)

  if (typeof args.tail === 'number' && Number.isFinite(args.tail)) {
    const tailLines = Math.min(Math.max(1, Math.floor(args.tail)), 2000)
    const startLine = Math.max(1, totalLines - tailLines + 1)
    return {
      startLine,
      endLine: totalLines,
      mode: 'tail',
      ...(tailLines !== Math.floor(args.tail)
        ? { note: `tail was clamped to ${tailLines} lines.` }
        : {})
    }
  }

  if (typeof args.around === 'number' && Number.isFinite(args.around)) {
    const aroundLine = Math.min(Math.max(1, Math.floor(args.around)), totalLines)
    const contextLines = Math.min(
      normalizeNonNegativeLineArg(args.context, normalizeNonNegativeLineArg(args.contextLines, 20)),
      500
    )
    const startLine = Math.max(1, aroundLine - contextLines)
    const endLine = Math.min(totalLines, aroundLine + contextLines)
    return {
      startLine,
      endLine,
      mode: 'around',
      ...(aroundLine !== Math.floor(args.around)
        ? { note: `around was clamped to line ${aroundLine}.` }
        : {})
    }
  }

  const rawOffset = normalizeSignedIntegerArg(args.offset, 1)
  const startLine =
    rawOffset < 0
      ? Math.max(1, totalLines + rawOffset + 1)
      : Math.min(Math.max(1, rawOffset), totalLines)
  const endLine = Math.min(totalLines, startLine + requestedLimit - 1)
  return {
    startLine,
    endLine,
    mode: rawOffset < 0 ? 'negative_offset' : 'offset'
  }
}
