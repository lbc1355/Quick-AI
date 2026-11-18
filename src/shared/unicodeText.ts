const isHighSurrogate = (unit: number): boolean => unit >= 0xd800 && unit <= 0xdbff
const isLowSurrogate = (unit: number): boolean => unit >= 0xdc00 && unit <= 0xdfff

const normalizeSliceOffset = (offset: number, length: number): number => {
  const integer = Number.isNaN(offset) ? 0 : Math.trunc(offset)
  return integer < 0 ? Math.max(0, length + integer) : Math.min(length, integer)
}

/** String.slice semantics with UTF-16 offsets, excluding code points split by either boundary. */
export function sliceUnicode(text: string, start = 0, end = text.length): string {
  let from = normalizeSliceOffset(start, text.length)
  let to = normalizeSliceOffset(end, text.length)
  if (to <= from) return ''

  if (isLowSurrogate(text.charCodeAt(from)) && isHighSurrogate(text.charCodeAt(from - 1))) {
    from += 1
  }
  if (isHighSurrogate(text.charCodeAt(to - 1)) && isLowSurrogate(text.charCodeAt(to))) {
    to -= 1
  }
  return text.slice(from, Math.max(from, to))
}

/** Repair only lone UTF-16 surrogates; valid emoji, CJK and literal JSON escape text stay intact. */
export function toWellFormedText(text: string): string {
  return text.replace(
    /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g,
    '\uFFFD'
  )
}
