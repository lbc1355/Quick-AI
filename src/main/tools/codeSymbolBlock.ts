const MAX_BLOCK_SCAN_LINE_CHARS = 8000
const MAX_SYMBOL_BLOCK_CHARS = 60000
const MAX_SYMBOL_BLOCK_LINE_CHARS = 1200

function countIndent(line: string): number {
  let count = 0
  for (const ch of line) {
    if (ch === ' ') count += 1
    else if (ch === '\t') count += 2
    else break
  }
  return count
}

function includeLeadingDecorators(lines: string[], start: number): number {
  let current = start
  while (current > 0) {
    const previous = lines[current - 1].trim()
    if (!previous.startsWith('@')) break
    current--
  }
  return current
}

function stripQuotedText(line: string): string {
  const bounded =
    line.length > MAX_BLOCK_SCAN_LINE_CHARS ? line.slice(0, MAX_BLOCK_SCAN_LINE_CHARS) : line
  return bounded
    .replace(/"(?:\\.|[^"\\])*"/g, '""')
    .replace(/'(?:\\.|[^'\\])*'/g, "''")
    .replace(/`(?:\\.|[^`\\])*`/g, '``')
}

export function inferSymbolBlockRange(
  lines: string[],
  matchLineIndex: number,
  maxLines: number,
  contextLines: number
): { startIndex: number; endIndex: number; truncated: boolean } {
  const definitionLine = lines[matchLineIndex]
  const trimmed = definitionLine.trim()
  const scanLimit = Math.min(lines.length, matchLineIndex + maxLines)
  let blockStart = includeLeadingDecorators(lines, matchLineIndex)
  let blockEnd = matchLineIndex
  let truncated = false

  if (/^(?:async\s+)?def\s+|^class\s+/.test(trimmed)) {
    const baseIndent = countIndent(definitionLine)
    blockEnd = lines.length - 1
    for (let i = matchLineIndex + 1; i < scanLimit; i++) {
      const line = lines[i]
      const clean = line.trim()
      if (!clean) continue
      if (countIndent(line) <= baseIndent && !clean.startsWith('#')) {
        blockEnd = i - 1
        break
      }
    }
    if (blockEnd >= scanLimit - 1 && scanLimit < lines.length) truncated = true
  } else {
    let sawBrace = false
    let depth = 0
    for (let i = matchLineIndex; i < scanLimit; i++) {
      const line = stripQuotedText(lines[i])
      for (const ch of line) {
        if (ch === '{') {
          sawBrace = true
          depth++
        } else if (ch === '}') {
          depth--
        }
      }
      blockEnd = i
      if (sawBrace && depth <= 0) break
      if (!sawBrace && /;\s*$/.test(line)) break
    }
    if (blockEnd >= scanLimit - 1 && scanLimit < lines.length) truncated = true
  }

  blockStart = Math.max(0, blockStart - contextLines)
  blockEnd = Math.min(lines.length - 1, blockEnd + contextLines)
  return { startIndex: blockStart, endIndex: blockEnd, truncated }
}

export function buildBoundedSymbolBlock(lines: string[]): { block: string; truncated: boolean } {
  const out: string[] = []
  let totalChars = 0
  let truncated = false

  for (const rawLine of lines) {
    const line =
      rawLine.length > MAX_SYMBOL_BLOCK_LINE_CHARS
        ? `${rawLine.slice(0, MAX_SYMBOL_BLOCK_LINE_CHARS)}...[line truncated]`
        : rawLine
    const nextTotal = totalChars + line.length + 1
    if (nextTotal > MAX_SYMBOL_BLOCK_CHARS) {
      truncated = true
      break
    }
    out.push(line)
    totalChars = nextTotal
    if (rawLine.length > MAX_SYMBOL_BLOCK_LINE_CHARS) {
      truncated = true
    }
  }

  return { block: out.join('\n'), truncated }
}
