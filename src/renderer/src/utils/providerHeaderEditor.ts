export interface ProviderHeaderItem {
  id: string
  name: string
  value: string
}

export interface ProviderHeadersResult {
  headers?: Record<string, string>
  error?: string
}

const HEADER_NAME_PATTERN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/

export function providerHeadersToItems(
  headers: Record<string, string> | undefined
): ProviderHeaderItem[] {
  return Object.entries(headers || {}).map(([name, value], index) => ({
    id: `header-${index}-${name}`,
    name,
    value
  }))
}

export function providerHeaderItemsToRecord(items: ProviderHeaderItem[]): ProviderHeadersResult {
  const headers: Record<string, string> = {}
  const normalizedNames = new Set<string>()

  for (const item of items) {
    const name = item.name.trim()
    const value = item.value.trim()
    if (!name && !value) continue
    if (!name) return { error: 'Header 名称不能为空。' }
    if (!HEADER_NAME_PATTERN.test(name)) return { error: `Header 名称无效：${name}` }
    if (/\r|\n/.test(value)) return { error: `Header ${name} 的值不能包含换行。` }

    const normalizedName = name.toLowerCase()
    if (normalizedNames.has(normalizedName)) return { error: `Header 重复：${name}` }
    normalizedNames.add(normalizedName)
    headers[name] = value
  }

  return { headers }
}

export function isValidProviderAuthHeader(name: string): boolean {
  return HEADER_NAME_PATTERN.test(name.trim())
}
