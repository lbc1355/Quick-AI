/**
 * Circular-reference- and bigint-safe JSON serialization, shared by the tool-result formatters
 * (result.ts, mcpResult.ts) and the runtime tool executor (toolRuntime.ts). Falls back to
 * String(value) if serialization still throws.
 */
export const safeJsonStringify = (value: unknown): string => {
  const seen = new WeakSet<object>()
  try {
    return JSON.stringify(
      value,
      (_key, nestedValue: unknown) => {
        if (typeof nestedValue === 'bigint') return nestedValue.toString()
        if (typeof nestedValue !== 'object' || nestedValue === null) return nestedValue
        if (seen.has(nestedValue)) return '[Circular]'
        seen.add(nestedValue)
        return nestedValue
      },
      2
    )
  } catch {
    return String(value)
  }
}
