export interface Utf8Slice {
  text: string
  startOffset: number
  endOffset: number
  bytes: number
}

export const utf8ByteLength = (text: string): number => Buffer.byteLength(text, 'utf8')

const codePointWidthAt = (text: string, offset: number): { units: number; bytes: number } => {
  const first = text.charCodeAt(offset)
  if (first <= 0x7f) return { units: 1, bytes: 1 }
  if (first <= 0x7ff) return { units: 1, bytes: 2 }
  if (first >= 0xd800 && first <= 0xdbff && offset + 1 < text.length) {
    const second = text.charCodeAt(offset + 1)
    if (second >= 0xdc00 && second <= 0xdfff) return { units: 2, bytes: 4 }
  }
  return { units: 1, bytes: 3 }
}

/** Take a prefix by UTF-8 bytes while returning UTF-16 offsets used by resource-cache reads. */
export function sliceUtf8Prefix(text: string, maxBytes: number, startOffset = 0): Utf8Slice {
  const budget = Math.max(0, Math.floor(maxBytes))
  let start = Math.max(0, Math.min(text.length, Math.floor(startOffset)))
  if (start > 0 && start < text.length) {
    const current = text.charCodeAt(start)
    const previous = text.charCodeAt(start - 1)
    if (current >= 0xdc00 && current <= 0xdfff && previous >= 0xd800 && previous <= 0xdbff) {
      start += 1
    }
  }
  let endOffset = start
  let bytes = 0

  while (endOffset < text.length) {
    const width = codePointWidthAt(text, endOffset)
    if (bytes + width.bytes > budget) break
    bytes += width.bytes
    endOffset += width.units
  }

  return {
    text: text.slice(start, endOffset),
    startOffset: start,
    endOffset,
    bytes
  }
}

/** Take a suffix by UTF-8 bytes without splitting a surrogate pair. */
export function sliceUtf8Suffix(
  text: string,
  maxBytes: number,
  endOffset = text.length
): Utf8Slice {
  const budget = Math.max(0, Math.floor(maxBytes))
  let end = Math.max(0, Math.min(text.length, Math.floor(endOffset)))
  if (end > 0 && end < text.length) {
    const previous = text.charCodeAt(end - 1)
    const current = text.charCodeAt(end)
    if (previous >= 0xd800 && previous <= 0xdbff && current >= 0xdc00 && current <= 0xdfff) {
      end -= 1
    }
  }
  let startOffset = end
  let bytes = 0

  while (startOffset > 0) {
    let candidate = startOffset - 1
    const last = text.charCodeAt(candidate)
    if (last >= 0xdc00 && last <= 0xdfff && candidate > 0) {
      const previous = text.charCodeAt(candidate - 1)
      if (previous >= 0xd800 && previous <= 0xdbff) candidate--
    }
    const widthBytes = utf8ByteLength(text.slice(candidate, startOffset))
    if (bytes + widthBytes > budget) break
    bytes += widthBytes
    startOffset = candidate
  }

  return {
    text: text.slice(startOffset, end),
    startOffset,
    endOffset: end,
    bytes
  }
}
