const DEFAULT_FETCH_PAGE_CHARS = 10000
const MAX_FETCH_PAGE_CHARS = 16000

export interface FetchUrlOptions {
  offset?: number
  maxChars?: number
  /** Force JS rendering via the injected headless renderer (when available). */
  render?: boolean
}

export const normalizeFetchUrlOptions = (
  options: FetchUrlOptions = {}
): { offset: number; maxChars: number } => {
  const rawOffset = typeof options.offset === 'number' ? options.offset : 0
  const rawMaxChars =
    typeof options.maxChars === 'number' ? options.maxChars : DEFAULT_FETCH_PAGE_CHARS

  const offset = Number.isFinite(rawOffset) ? Math.max(0, Math.floor(rawOffset)) : 0
  const maxChars = Number.isFinite(rawMaxChars)
    ? Math.min(MAX_FETCH_PAGE_CHARS, Math.max(1000, Math.floor(rawMaxChars)))
    : DEFAULT_FETCH_PAGE_CHARS

  return { offset, maxChars }
}

export const isPrivateIPv4 = (address: string): boolean => {
  const parts = address.split('.').map((part) => Number(part))
  if (parts.length !== 4 || parts.some((part) => Number.isNaN(part))) return true
  const [a, b] = parts

  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168)
  )
}

export const isPrivateIPv6 = (address: string): boolean => {
  const normalized = address.toLowerCase()
  return (
    normalized === '::1' ||
    normalized.startsWith('fc') ||
    normalized.startsWith('fd') ||
    normalized.startsWith('fe80') ||
    normalized.startsWith('::ffff:127.') ||
    normalized.startsWith('::ffff:10.') ||
    normalized.startsWith('::ffff:192.168.')
  )
}
