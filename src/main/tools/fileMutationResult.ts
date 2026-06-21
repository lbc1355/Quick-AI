import { generateUnifiedDiff } from './fileDiff'

function getLineNumberAtPosition(text: string, position: number): number {
  return text.slice(0, Math.max(0, position)).split(/\r?\n/).length
}

function getLineEndForNeedle(startLine: number, needle: string): number {
  return startLine + needle.split(/\r?\n/).length - 1
}

function formatLineContext(lines: string[], centerLine: number, radius = 2): string {
  const start = Math.max(1, centerLine - radius)
  const end = Math.min(lines.length, centerLine + radius)
  const width = String(end).length
  const formatted: string[] = []

  for (let lineNumber = start; lineNumber <= end; lineNumber++) {
    const marker = lineNumber === centerLine ? '>' : ' '
    formatted.push(
      `${marker} ${String(lineNumber).padStart(width, ' ')} | ${lines[lineNumber - 1] ?? ''}`
    )
  }

  return formatted.join('\n')
}

export function formatOccurrenceContexts(
  content: string,
  needle: string,
  occurrences: number[]
): string {
  const lines = content.split(/\r?\n/)
  return occurrences
    .slice(0, 8)
    .map((position, index) => {
      const startLine = getLineNumberAtPosition(content, position)
      const endLine = getLineEndForNeedle(startLine, needle)
      return [
        `Match ${index + 1}: lines ${startLine}-${endLine}`,
        formatLineContext(lines, startLine, 2)
      ].join('\n')
    })
    .join('\n\n')
}

function getNeedlePreviewLine(needle: string): string {
  const lines = needle
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
  return (lines[0] || needle.trim()).slice(0, 80)
}

function formatClosestLineContexts(content: string, needle: string): string {
  const lines = content.split(/\r?\n/)
  const preview = getNeedlePreviewLine(needle)
  const probe = preview.slice(0, 30)
  if (!probe) return ''

  const contexts: string[] = []
  for (let i = 0; i < lines.length && contexts.length < 5; i++) {
    if (lines[i].includes(probe) || lines[i].trim().includes(probe.trim())) {
      contexts.push(
        `Candidate ${contexts.length + 1}: around line ${i + 1}\n${formatLineContext(lines, i + 1, 2)}`
      )
    }
  }

  return contexts.join('\n\n')
}

export function formatEditLookupFailure(content: string, oldString: string): string {
  const lines = content.split(/\r?\n/)
  const oldLines = oldString.split(/\r?\n/).length
  const preview = getNeedlePreviewLine(oldString)
  const closest = formatClosestLineContexts(content, oldString)

  const details = [
    `Target preview: ${preview || '(empty after trimming)'}`,
    `Target length: ${oldString.length} chars across ${oldLines} line(s).`,
    `File length: ${lines.length} line(s).`,
    closest ? `Closest candidate contexts:\n${closest}` : '',
    'Tip: call file_read with around/lineNumbers near a candidate line, then retry with exact whitespace and surrounding context.'
  ]

  return details.filter(Boolean).join('\n')
}

export function buildShortUnifiedDiff(before: string, after: string, maxChars = 12000): string {
  const diff = generateUnifiedDiff(before.split(/\r?\n/), after.split(/\r?\n/), 2)
  if (diff.length <= maxChars) return diff
  return `${diff.slice(0, maxChars)}\n\n[Diff truncated. Use file_diff or file_read around changed lines for more context.]`
}
