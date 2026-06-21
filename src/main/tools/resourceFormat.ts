import { ToolExecutionContext } from './types'

export function formatResourceRanges(
  ranges: Array<{ start: number; end: number }> | undefined
): string {
  if (!ranges || ranges.length === 0) return ''
  return ranges
    .slice(0, 6)
    .map((range) => `${range.start}-${range.end}`)
    .join(', ')
}

export function formatResourceOffsets(
  chunks: NonNullable<ToolExecutionContext['resources']>[number]['chunks']
): string {
  const offsets = chunks
    .map((chunk) =>
      chunk.offset !== undefined && chunk.endOffset !== undefined
        ? `${chunk.offset}-${chunk.endOffset}`
        : undefined
    )
    .filter((value): value is string => Boolean(value))

  if (offsets.length === 0) return ''
  const preview = offsets.slice(0, 8).join(', ')
  return offsets.length > 8 ? `${preview}, +${offsets.length - 8} more` : preview
}
